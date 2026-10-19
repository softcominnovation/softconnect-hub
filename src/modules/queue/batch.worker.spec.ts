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
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import { BatchWorker } from './batch.worker';
import { BATCH_WEBHOOK_QUEUE } from './queue.constants';

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
  return { Queue: jest.fn(), Worker: WorkerMock };
});

describe('BatchWorker', () => {
  let batchWorker: BatchWorker;
  let prisma: jest.Mocked<Pick<PrismaService, 'batchJob'>>;
  let cache: jest.Mocked<Pick<CacheService, 'increment' | 'get'>>;
  let adapterResolver: { resolve: jest.Mock };
  let batchWebhookQueue: { add: jest.Mock; close: jest.Mock };

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

    batchWebhookQueue = { add: jest.fn(), close: jest.fn() };

    prisma = {
      batchJob: {
        update: jest.fn(),
      } as unknown as PrismaService['batchJob'],
    };

    cache = {
      increment: jest.fn(),
      get: jest.fn(),
    };

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
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
        { provide: AdapterResolverService, useValue: adapterResolver },
        { provide: BATCH_WEBHOOK_QUEUE, useValue: batchWebhookQueue },
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
    (prisma.batchJob.update as jest.Mock).mockResolvedValue({});
    batchWebhookQueue.add.mockResolvedValue({});
  });

  afterEach(async () => {
    await batchWorker.onModuleDestroy();
  });

  function getProcessor() {
    const worker = batchWorker['worker'] as unknown as {
      __processorMap: Map<string, (job: unknown) => Promise<unknown>>;
    };
    return worker.__processorMap.get('batch')!;
  }

  it('deve incrementar batch:sent quando sendText tem sucesso', async () => {
    cache.increment.mockResolvedValue(1);
    cache.get.mockResolvedValue(null);

    await getProcessor()({ data: basePayload });

    expect(cache.increment).toHaveBeenCalledWith('batch:sent:job-1');
  });

  it('deve incrementar batch:failed e relançar erro quando sendText falha', async () => {
    cache.increment.mockResolvedValue(1);
    cache.get.mockResolvedValue(null);
    mockAdapter.sendText.mockRejectedValue(new Error('timeout'));

    await expect(getProcessor()({ data: basePayload })).rejects.toThrow(
      'timeout',
    );

    expect(cache.increment).toHaveBeenCalledWith('batch:failed:job-1');
  });

  it('deve atualizar BatchJob no Postgres quando done === total', async () => {
    cache.increment
      .mockResolvedValueOnce(1) // batch:sent
      .mockResolvedValueOnce(1); // batch:done
    cache.get
      .mockResolvedValueOnce(1) // batch:total → done(1) === total(1)
      .mockResolvedValueOnce(1) // batch:sent
      .mockResolvedValueOnce(0); // batch:failed

    await getProcessor()({ data: basePayload });

    expect(prisma.batchJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'completed' }) as {
          status: string;
        },
      }),
    );
  });

  it('não deve atualizar o Postgres quando done < total', async () => {
    cache.increment.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    cache.get.mockResolvedValueOnce(5);

    await getProcessor()({ data: basePayload });

    expect(prisma.batchJob.update).not.toHaveBeenCalled();
  });

  it('deve enfileirar webhook por mensagem com success=true quando webhook está definido', async () => {
    const payload = {
      ...basePayload,
      webhook: {
        url: 'https://cliente.example.com/callback',
        headers: { authorization: 'Bearer x' },
      },
    };

    cache.increment.mockResolvedValue(1);
    cache.get.mockResolvedValue(null);

    await getProcessor()({ data: payload });

    expect(batchWebhookQueue.add).toHaveBeenCalledWith(
      'notify',
      expect.objectContaining({
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
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('deve enfileirar webhook por mensagem com success=false quando sendText falha', async () => {
    const payload = {
      ...basePayload,
      webhook: { url: 'https://cliente.example.com/callback' },
    };

    cache.increment.mockResolvedValue(1);
    cache.get.mockResolvedValue(null);
    mockAdapter.sendText.mockRejectedValue(new Error('timeout'));

    await expect(getProcessor()({ data: payload })).rejects.toThrow('timeout');

    expect(batchWebhookQueue.add).toHaveBeenCalledWith(
      'notify',
      expect.objectContaining({
        success: false,
        deliveryError: 'timeout',
      }),
      expect.any(Object),
    );
  });

  it('não deve enfileirar webhook quando webhook é null', async () => {
    cache.increment.mockResolvedValue(1);
    cache.get.mockResolvedValue(null);

    await getProcessor()({ data: basePayload });

    expect(batchWebhookQueue.add).not.toHaveBeenCalled();
  });

  it('deve chamar sendDocument quando messageType=document', async () => {
    const docMessage = {
      number: '5511999990001',
      media: 'https://example.com/file.pdf',
      fileName: 'file.pdf',
    };
    cache.increment.mockResolvedValue(1);
    cache.get.mockResolvedValue(null);

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
    cache.increment.mockResolvedValue(1);
    cache.get.mockResolvedValue(null);

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
  it.each(['media', 'document'] as const)(
    'batch %s waits for the real prepared provider response before counters and callback',
    async (messageType) => {
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
        cache.increment.mockResolvedValue(1);
        cache.get.mockResolvedValue(null);
        const payload = {
          ...basePayload,
          messageType,
          providerUrl:
            'http://127.0.0.1:' + (server.address() as AddressInfo).port,
          message: {
            number: 'fixture',
            media: 'data:application/pdf;base64,YWJj',
            mediatype: 'video',
            fileName: 'ação.pdf',
            caption: 'Olá',
            extra: true,
          },
          webhook: { url: 'https://callback.invalid' },
        };
        const processing = getProcessor()({ data: payload });
        await received;
        await new Promise((resolve) => setTimeout(resolve, 120));
        expect(cache.increment).not.toHaveBeenCalled();
        expect(batchWebhookQueue.add).not.toHaveBeenCalled();
        respond!();
        await processing;
        expect(bodies).toEqual([
          expect.objectContaining({
            media: 'YWJj',
            mediatype: messageType === 'document' ? 'document' : 'video',
            fileName: 'ação.pdf',
            extra: true,
          }),
        ]);
        expect(cache.increment).toHaveBeenCalledWith('batch:sent:job-1');
        expect(batchWebhookQueue.add).toHaveBeenCalledWith(
          'notify',
          expect.objectContaining({
            success: true,
            deliveryError: null,
            messagePayload: payload.message,
          }),
          expect.any(Object),
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
    cache.increment.mockResolvedValue(1);
    cache.get.mockResolvedValue(null);
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
    expect(batchWebhookQueue.add).toHaveBeenCalledWith(
      'notify',
      expect.objectContaining({
        success: false,
        deliveryError:
          'Media request timeout (provider_timeout); delivery not confirmed',
      }),
      expect.any(Object),
    );
    expect(cache.increment).toHaveBeenCalledWith('batch:failed:job-1');
  });
});
