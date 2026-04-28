import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Worker } from 'bullmq';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdapterResolverService } from '../providers/adapter-resolver.service';
import { BatchWorker } from './batch.worker';

jest.mock('bullmq', () => {
  const processorMap = new Map<string, (job: unknown) => Promise<unknown>>();
  const WorkerMock = jest.fn().mockImplementation(
    (name: string, processor: (job: unknown) => Promise<unknown>) => {
      processorMap.set(name, processor);
      return {
        on: jest.fn(),
        close: jest.fn(),
        __processorMap: processorMap,
      };
    },
  );
  return { Worker: WorkerMock };
});

describe('BatchWorker', () => {
  let batchWorker: BatchWorker;
  let prisma: jest.Mocked<Pick<PrismaService, 'batchJob'>>;
  let cache: jest.Mocked<Pick<CacheService, 'increment' | 'get'>>;
  let adapterResolver: { resolve: jest.Mock };

  const mockAdapter = { sendText: jest.fn() };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    prisma = {
      batchJob: {
        update: jest.fn().mockResolvedValue({}),
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
          useValue: { getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379') },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
        { provide: AdapterResolverService, useValue: adapterResolver },
      ],
    }).compile();

    batchWorker = module.get(BatchWorker);
    batchWorker.onModuleInit();
    jest.clearAllMocks();
    mockAdapter.sendText.mockResolvedValue({ key: { id: 'msg-1', remoteJid: '5511@s.whatsapp.net', fromMe: true } });
  });

  afterEach(async () => {
    await batchWorker.onModuleDestroy();
  });

  it('deve incrementar batch:sent quando sendText tem sucesso', async () => {
    cache.increment.mockResolvedValue(1);
    cache.get.mockResolvedValue(null);

    const worker = batchWorker['worker'] as unknown as {
      __processorMap: Map<string, (job: unknown) => Promise<unknown>>;
    };
    const processor = worker.__processorMap.get('batch');
    expect(processor).toBeDefined();

    await processor!({
      data: {
        batchJobId: 'job-1',
        productId: 'prod-1',
        adapterType: 'evolution',
        instanceName: 'my-instance',
        providerUrl: 'http://evolution.local:8080',
        providerApiKey: 'key',
        message: { number: '5511999990001', text: 'Olá' },
      },
    });

    expect(cache.increment).toHaveBeenCalledWith('batch:sent:job-1');
  });

  it('deve incrementar batch:failed e relançar erro quando sendText falha', async () => {
    cache.increment.mockResolvedValue(1);
    cache.get.mockResolvedValue(null);
    mockAdapter.sendText.mockRejectedValue(new Error('timeout'));

    const worker = batchWorker['worker'] as unknown as {
      __processorMap: Map<string, (job: unknown) => Promise<unknown>>;
    };
    const processor = worker.__processorMap.get('batch');

    await expect(
      processor!({
        data: {
          batchJobId: 'job-1',
          productId: 'prod-1',
          adapterType: 'evolution',
          instanceName: 'my-instance',
          providerUrl: 'http://evolution.local:8080',
          providerApiKey: 'key',
          message: { number: '5511999990001', text: 'Olá' },
        },
      }),
    ).rejects.toThrow('timeout');

    expect(cache.increment).toHaveBeenCalledWith('batch:failed:job-1');
  });

  it('deve atualizar BatchJob no Postgres quando done === total', async () => {
    cache.increment
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    cache.get
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const worker = batchWorker['worker'] as unknown as {
      __processorMap: Map<string, (job: unknown) => Promise<unknown>>;
    };
    const processor = worker.__processorMap.get('batch');

    await processor!({
      data: {
        batchJobId: 'job-1',
        productId: 'prod-1',
        adapterType: 'evolution',
        instanceName: 'my-instance',
        providerUrl: 'http://evolution.local:8080',
        providerApiKey: 'key',
        message: { number: '5511999990001', text: 'Olá' },
      },
    });

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

    const worker = batchWorker['worker'] as unknown as {
      __processorMap: Map<string, (job: unknown) => Promise<unknown>>;
    };
    const processor = worker.__processorMap.get('batch');

    await processor!({
      data: {
        batchJobId: 'job-1',
        productId: 'prod-1',
        adapterType: 'evolution',
        instanceName: 'my-instance',
        providerUrl: 'http://evolution.local:8080',
        providerApiKey: 'key',
        message: { number: '5511999990001', text: 'Olá' },
      },
    });

    expect(prisma.batchJob.update).not.toHaveBeenCalled();
  });
});
