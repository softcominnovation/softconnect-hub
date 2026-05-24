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

  const mockAdapter = { sendText: jest.fn() };

  const basePayload = {
    batchJobId: 'job-1',
    productId: 'prod-1',
    apiKeyHash: 'hash-abc',
    instanceId: 'inst-1',
    adapterType: 'evolution',
    instanceName: 'my-instance',
    providerUrl: 'http://evolution.local:8080',
    providerApiKey: 'key',
    message: { number: '5511999990001', text: 'Olá' },
    batchWebhookEnabled: false,
    batchWebhookUrl: null,
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
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  it('não deve atualizar o Postgres quando done < total', async () => {
    cache.increment.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    cache.get.mockResolvedValueOnce(5);

    await getProcessor()({ data: basePayload });

    expect(prisma.batchJob.update).not.toHaveBeenCalled();
  });

  it('deve enfileirar webhook por mensagem com success=true quando sendText tem sucesso', async () => {
    const payload = {
      ...basePayload,
      batchWebhookEnabled: true,
      batchWebhookUrl: 'https://cliente.example.com/callback',
    };

    cache.increment.mockResolvedValue(1);
    cache.get.mockResolvedValue(null);

    await getProcessor()({ data: payload });

    expect(batchWebhookQueue.add).toHaveBeenCalledWith(
      'notify',
      expect.objectContaining({
        batchWebhookUrl: 'https://cliente.example.com/callback',
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
      batchWebhookEnabled: true,
      batchWebhookUrl: 'https://cliente.example.com/callback',
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

  it('não deve enfileirar webhook quando batchWebhookEnabled é false', async () => {
    cache.increment.mockResolvedValue(1);
    cache.get.mockResolvedValue(null);

    await getProcessor()({ data: basePayload });

    expect(batchWebhookQueue.add).not.toHaveBeenCalled();
  });
});
