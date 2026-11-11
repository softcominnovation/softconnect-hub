import { BatchWebhookJobPayload } from './batch-webhook.worker';
const notificationContaining = (
  value: Partial<BatchWebhookJobPayload>,
): BatchWebhookJobPayload =>
  expect.objectContaining(value) as BatchWebhookJobPayload;
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvolutionAdapter } from '../../adapters/evolution/evolution.adapter';
import { EvolutionHttpService } from '../../adapters/evolution/evolution.http';
import { EvolutionMediaService } from '../../adapters/evolution/evolution.media';
import { MediaPreparationService } from '../media/media-preparation.service';
import { MediaSourceClient } from '../media/media-source.client';
import { MediaSourcePolicy } from '../media/media-source-policy';
import { MediaTempStore } from '../media/media-temp-store';
import { AppConfig, configSchema } from '../../config/config.schema';
import { MediaTimeoutException } from '../../common/media-request-context';
import { ProviderResponseException } from '../../common/provider-response.exception';
import {
  SEND_SAFETY_TIMEOUT_MESSAGE,
  SendSafetyTimeoutException,
} from '../../common/send-safety-timeout';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import { BatchWorker } from './batch.worker';
import { BatchResultService } from './batch-result.service';
import { DelayedError } from 'bullmq';
import { BatchJobPayload } from './batch.producer';

jest.mock('bullmq', () => {
  const processorMap = new Map<string, (job: unknown) => Promise<unknown>>();
  const WorkerMock = jest
    .fn()
    .mockImplementation(
      (name: string, processor: (job: unknown) => Promise<unknown>) => {
        processorMap.set(name, processor);
        return {
          on: jest.fn(),
          close: jest.fn(),
          __processorMap: processorMap,
        };
      },
    );
  return {
    Queue: jest.fn(),
    Worker: WorkerMock,
    DelayedError: class extends Error {},
  };
});

describe('BatchWorker', () => {
  let batchWorker: BatchWorker;
  let adapterResolver: { resolve: jest.Mock };
  let results: { publish: jest.Mock };

  const mockAdapter = {
    sendText: jest.fn(),
    sendMedia: jest.fn(),
    sendDocument: jest.fn(),
  };

  const basePayload = {
    batchJobId: 'job-1',
    productId: 'prod-1',
    apiKeyHash: 'hash-abc',
    instanceId: 'inst-1',
    adapterType: 'evolution',
    instanceName: 'my-instance',
    providerUrl: 'http://evolution.local:8080',
    providerApiKey: 'key',
    messageType: 'text' as const,
    message: { number: '5511999990001', text: 'Olá' },
    webhook: null as { url: string; headers?: Record<string, string> } | null,
  };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    results = { publish: jest.fn().mockResolvedValue(undefined) };

    adapterResolver = { resolve: jest.fn().mockReturnValue(mockAdapter) };

    const module = await Test.createTestingModule({
      providers: [
        BatchWorker,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
            get: jest.fn().mockReturnValue(10),
          },
        },
        { provide: AdapterResolverService, useValue: adapterResolver },
        { provide: BatchResultService, useValue: results },
      ],
    }).compile();

    batchWorker = module.get(BatchWorker);
    batchWorker.onModuleInit();
    jest.clearAllMocks();

    mockAdapter.sendText.mockResolvedValue({
      key: { id: 'msg-1', remoteJid: '5511@s.whatsapp.net', fromMe: true },
    });
    mockAdapter.sendMedia.mockResolvedValue({
      key: { id: 'msg-2', remoteJid: '5511@s.whatsapp.net', fromMe: true },
    });
    mockAdapter.sendDocument.mockResolvedValue({
      key: { id: 'msg-3', remoteJid: '5511@s.whatsapp.net', fromMe: true },
    });
  });

  afterEach(async () => {
    await batchWorker.onModuleDestroy();
  });

  function getProcessor() {
    const worker = batchWorker['worker'] as unknown as {
      __processorMap: Map<string, (job: unknown) => Promise<unknown>>;
    };
    const process = worker.__processorMap.get('batch')!;
    return (job: {
      data: unknown;
      id?: string;
      updateData?: jest.Mock;
      moveToDelayed?: jest.Mock;
    }) =>
      process({
        id: 'message-job-1',
        updateData: jest.fn().mockResolvedValue(undefined),
        moveToDelayed: jest.fn().mockResolvedValue(undefined),
        ...job,
      });
  }

  it('recovers a failed result handoff without sending a confirmed message again', async () => {
    const updateData = jest.fn().mockResolvedValue(undefined);
    const moveToDelayed = jest.fn().mockResolvedValue(undefined);
    results.publish.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(
      getProcessor()({ data: basePayload, updateData, moveToDelayed }),
    ).rejects.toBeInstanceOf(DelayedError);
    const saved = (updateData.mock.calls.at(-1) as [BatchJobPayload])[0];
    expect(saved.batchExecution?.result).toMatchObject({
      success: true,
      deliveryError: null,
    });
    expect(moveToDelayed).toHaveBeenCalledTimes(1);
    await getProcessor()({ data: saved });
    expect(mockAdapter.sendText).toHaveBeenCalledTimes(1);
    expect(mockAdapter.sendText).toHaveBeenCalledWith(
      {
        providerUrl: basePayload.providerUrl,
        providerApiKey: basePayload.providerApiKey,
      },
      basePayload.instanceName,
      basePayload.message,
    );
    expect(results.publish.mock.calls[0]).toEqual(
      results.publish.mock.calls[1],
    );
  });

  it('preserves the provider error when internal registration is retried', async () => {
    const error = new ProviderResponseException(
      { message: 'Erro real do provider' },
      422,
    );
    mockAdapter.sendText.mockRejectedValue(error);
    results.publish.mockRejectedValueOnce(new Error('Redis unavailable'));
    const updateData = jest.fn().mockResolvedValue(undefined);
    await expect(
      getProcessor()({
        data: { ...basePayload, webhook: { url: 'https://callback.invalid' } },
        updateData,
      }),
    ).rejects.toBeInstanceOf(DelayedError);
    const saved = (updateData.mock.calls.at(-1) as [BatchJobPayload])[0];
    await expect(getProcessor()({ data: saved })).rejects.toThrow(
      'Erro real do provider',
    );
    expect(mockAdapter.sendText).toHaveBeenCalledTimes(1);
    expect(results.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        success: false,
        deliveryError: 'Erro real do provider',
        notification: notificationContaining({
          success: false,
          deliveryError: 'Erro real do provider',
        }),
      }),
    );
  });

  it('does not dispatch if the initial execution checkpoint cannot be saved', async () => {
    await expect(
      getProcessor()({
        data: basePayload,
        updateData: jest.fn().mockRejectedValue(new Error('Redis down')),
      }),
    ).rejects.toThrow('Redis down');
    expect(mockAdapter.sendText).not.toHaveBeenCalled();
    expect(results.publish).not.toHaveBeenCalled();
  });

  it('keeps the real success when saving the outcome checkpoint fails', async () => {
    const updateData = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('Redis down'));
    await getProcessor()({ data: basePayload, updateData });
    expect(mockAdapter.sendText).toHaveBeenCalledTimes(1);
    expect(results.publish).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, deliveryError: null }),
    );
  });

  it('does not defer an unpersisted known outcome when Redis remains unavailable', async () => {
    const updateData = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('Redis down'));
    const moveToDelayed = jest.fn();
    results.publish.mockRejectedValue(new Error('Redis down'));
    await expect(
      getProcessor()({ data: basePayload, updateData, moveToDelayed }),
    ).rejects.toThrow('Redis down');
    expect(mockAdapter.sendText).toHaveBeenCalledTimes(1);
    expect(results.publish).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, deliveryError: null }),
    );
    expect(moveToDelayed).not.toHaveBeenCalled();
  });

  it('does not prematurely settle or resend a recovered execution inside its safety window', async () => {
    const moveToDelayed = jest.fn().mockResolvedValue(undefined);
    await expect(
      getProcessor()({
        data: {
          ...basePayload,
          batchExecution: { started: true, settleAfter: Date.now() + 600000 },
        },
        moveToDelayed,
      }),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(mockAdapter.sendText).not.toHaveBeenCalled();
    expect(results.publish).not.toHaveBeenCalled();
    expect(moveToDelayed).toHaveBeenCalledTimes(1);
  });

  it('reports an interrupted execution as unconfirmed without resending', async () => {
    await expect(
      getProcessor()({
        data: {
          ...basePayload,
          batchExecution: { started: true, settleAfter: Date.now() - 1 },
        },
      }),
    ).rejects.toThrow('Resultado do envio não confirmado');
    expect(mockAdapter.sendText).not.toHaveBeenCalled();
    expect(results.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        deliveryError: expect.stringContaining('não foi reenviada') as string,
      }),
    );
  });

  it('preserves jobs created before messageType and webhook overrides existed', async () => {
    await getProcessor()({
      data: {
        ...basePayload,
        messageType: undefined,
        webhook: undefined,
        batchWebhookEnabled: true,
        batchWebhookUrl: 'https://legacy.invalid',
      },
    });
    expect(mockAdapter.sendText).toHaveBeenCalledTimes(1);
    expect(results.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: notificationContaining({
          batchWebhookUrl: 'https://legacy.invalid',
          success: true,
        }),
      }),
    );
  });

  it('deve enfileirar webhook por mensagem com success=true quando webhook está definido', async () => {
    const payload = {
      ...basePayload,
      webhook: {
        url: 'https://cliente.example.com/callback',
        headers: { authorization: 'Bearer x' },
      },
    };

    await getProcessor()({ data: payload });

    expect(results.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: notificationContaining({
          batchWebhookUrl: 'https://cliente.example.com/callback',
          batchWebhookHeaders: { authorization: 'Bearer x' },
          apiKeyHash: 'hash-abc',
          batchJobId: 'job-1',
          productId: 'prod-1',
          instanceId: 'inst-1',
          success: true,
          deliveryError: null,
          messagePayload: basePayload.message,
        }),
      }),
    );
  });

  it('deve enfileirar webhook por mensagem com success=false quando sendText falha', async () => {
    const payload = {
      ...basePayload,
      webhook: { url: 'https://cliente.example.com/callback' },
    };
    mockAdapter.sendText.mockRejectedValue(new Error('timeout'));

    await expect(getProcessor()({ data: payload })).rejects.toThrow('timeout');

    expect(results.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: notificationContaining({
          success: false,
          deliveryError: 'timeout',
        }),
      }),
    );
  });

  it('não deve enfileirar webhook quando webhook é null', async () => {
    await getProcessor()({ data: basePayload });

    expect(results.publish).toHaveBeenCalledWith(
      expect.objectContaining({ notification: null }),
    );
  });

  it('deve chamar sendDocument quando messageType=document', async () => {
    const docMessage = {
      number: '5511999990001',
      media: 'https://example.com/file.pdf',
      fileName: 'file.pdf',
    };

    await getProcessor()({
      data: {
        ...basePayload,
        messageType: 'document',
        message: docMessage,
      },
    });

    expect(mockAdapter.sendDocument).toHaveBeenCalledWith(
      expect.objectContaining({ providerUrl: basePayload.providerUrl }),
      'my-instance',
      docMessage,
    );
    expect(mockAdapter.sendText).not.toHaveBeenCalled();
    expect(mockAdapter.sendMedia).not.toHaveBeenCalled();
  });

  it('deve chamar sendMedia quando messageType=media', async () => {
    const mediaMessage = {
      number: '5511999990001',
      mediatype: 'image' as const,
      media: 'https://example.com/img.jpg',
    };

    await getProcessor()({
      data: {
        ...basePayload,
        messageType: 'media',
        message: mediaMessage,
      },
    });

    expect(mockAdapter.sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({ providerUrl: basePayload.providerUrl }),
      'my-instance',
      mediaMessage,
    );
    expect(mockAdapter.sendText).not.toHaveBeenCalled();
    expect(mockAdapter.sendDocument).not.toHaveBeenCalled();
  });
  it.each([
    ['media', false],
    ['document', false],
    ['text', false],
    ['media', true],
    ['document', true],
    ['text', true],
  ] as const)(
    'batch %s settles only after response or safety expiry (%s)',
    async (messageType, expires) => {
      const root = await mkdtemp(join(tmpdir(), 'mid03-batch-'));
      let server: Server | undefined;
      let store: MediaTempStore | undefined;
      let respond: (() => void) | undefined;
      let markReceived!: () => void;
      const received = new Promise<void>((resolve) => {
        markReceived = resolve;
      });
      const bodies: Record<string, unknown>[] = [];
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      try {
        server = createServer((req, res) => {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => {
            bodies.push(
              JSON.parse(Buffer.concat(chunks).toString()) as Record<
                string,
                unknown
              >,
            );
            respond = () => {
              if (res.writableEnded || res.destroyed) return;
              res.writeHead(201, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ key: { id: 'fixture-result' } }));
            };
            markReceived();
          });
        });
        await new Promise<void>((resolve) =>
          server!.listen(0, '127.0.0.1', resolve),
        );
        const config = new ConfigService(
          configSchema.parse({
            DATABASE_URL: 'postgresql://unused.invalid/test',
            REDIS_URL: 'redis://unused.invalid',
            ENCRYPTION_KEY: 'a'.repeat(64),
            JWT_SECRET: 'fixture-unused-secret',
            ADMIN_SECRET: 'fixture-unused-admin',
            PROXY_TIMEOUT_MS: 50,
            SEND_PROVIDER_TIMEOUT_MS: expires ? 70 : 1000,
            MEDIA_TMP_DIR: root,
          }),
        );
        store = new MediaTempStore(config);
        const http = new EvolutionHttpService(
          config as unknown as ConfigService<AppConfig, true>,
        );
        const media = new EvolutionMediaService(
          config,
          new MediaPreparationService(
            config,
            new MediaSourceClient(new MediaSourcePolicy(config)),
            store,
          ),
          http,
        );
        adapterResolver.resolve.mockReturnValue(
          new EvolutionAdapter(http, media),
        );
        const payload = {
          ...basePayload,
          messageType,
          providerUrl:
            'http://127.0.0.1:' + (server.address() as AddressInfo).port,
          message: {
            number: 'fixture',
            text: 'Texto de teste',
            media: 'data:application/pdf;base64,YWJj',
            mediatype: 'video',
            fileName: 'ação.pdf',
            caption: 'Olá',
            extra: true,
          },
          webhook: { url: 'https://callback.invalid' },
        };
        const processing = getProcessor()({ data: payload }).catch(
          (error: unknown) => error,
        );
        await Promise.race([
          received,
          processing.then((error: unknown) => {
            throw error instanceof Error
              ? error
              : new Error('Batch finished before reaching the HTTP fixture');
          }),
        ]);
        expect(results.publish).not.toHaveBeenCalled();
        await new Promise((resolve) => setTimeout(resolve, 120));
        if (expires) {
          expect(await processing).toBeInstanceOf(SendSafetyTimeoutException);
          expect(results.publish).toHaveBeenCalledWith(
            expect.objectContaining({
              notification: notificationContaining({
                success: false,
                deliveryError: SEND_SAFETY_TIMEOUT_MESSAGE,
              }),
            }),
          );
          expect(bodies).toHaveLength(1);
          expect(
            (await readdir(root, { recursive: true })).filter((x) =>
              x.endsWith('.bin'),
            ),
          ).toEqual([]);
          return;
        }
        expect(results.publish).not.toHaveBeenCalled();
        respond!();
        await processing;
        expect(bodies).toEqual([
          expect.objectContaining({
            media: messageType === 'text' ? payload.message.media : 'YWJj',
            mediatype: messageType === 'document' ? 'document' : 'video',
            fileName: 'ação.pdf',
            extra: true,
          }),
        ]);
        expect(results.publish).toHaveBeenCalledWith(
          expect.objectContaining({
            notification: notificationContaining({
              success: true,
              deliveryError: null,
              messagePayload: payload.message,
            }),
          }),
        );
        expect(
          (await readdir(root, { recursive: true })).filter((x) =>
            x.endsWith('.bin'),
          ),
        ).toEqual([]);
      } finally {
        respond?.();
        server?.closeAllConnections();
        if (server?.listening)
          await new Promise<void>((resolve) => server!.close(() => resolve()));
        await store?.onModuleDestroy();
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it('keeps the callback contract while describing a media timeout as unconfirmed delivery', async () => {
    mockAdapter.sendMedia.mockRejectedValue(
      new MediaTimeoutException('provider_timeout'),
    );
    await expect(
      getProcessor()({
        data: {
          ...basePayload,
          messageType: 'media',
          webhook: { url: 'https://callback.invalid' },
        },
      }),
    ).rejects.toBeInstanceOf(MediaTimeoutException);
    expect(results.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: notificationContaining({
          success: false,
          deliveryError:
            'Media request timeout (provider_timeout); delivery not confirmed',
        }),
      }),
    );
  });

  it('keeps text timeout details in the existing batch callback envelope', async () => {
    const error = new ProviderResponseException(
      { message: ['Timeout informado pela Evolution'] },
      408,
    );
    expect(error.message).toBe('["Timeout informado pela Evolution"]');
    mockAdapter.sendText.mockRejectedValue(error);
    await expect(
      getProcessor()({
        data: {
          ...basePayload,
          messageType: 'text',
          webhook: { url: 'https://callback.invalid' },
        },
      }),
    ).rejects.toBe(error);
    expect(results.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: notificationContaining({
          success: false,
          deliveryError: error.message,
        }),
      }),
    );
  });
});
