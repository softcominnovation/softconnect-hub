import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../src/prisma/prisma.service';
import { AdapterResolverService } from '../src/providers/adapter-resolver.service';
import {
  BatchResult,
  BatchResultService,
  RECORD_BATCH_RESULT,
} from '../src/modules/queue/batch-result.service';
import { BatchWorker } from '../src/modules/queue/batch.worker';

let mockPrefix: string;
jest.mock('bullmq', () => {
  const actual = jest.requireActual<typeof import('bullmq')>('bullmq');
  return {
    ...actual,
    Worker: class extends actual.Worker {
      constructor(
        name: string,
        processor: import('bullmq').Processor,
        options: import('bullmq').WorkerOptions,
      ) {
        super(name, processor, { ...options, prefix: mockPrefix });
      }
    },
  };
});

describe('batch result recovery with real local Redis and simulated provider/database', () => {
  let redis: Redis;
  let results: Queue<BatchResult>;
  let batch: Queue;
  let notifications: Queue;
  let service: BatchResultService;
  let worker: BatchWorker;
  let batchId: string;
  let sendText: jest.Mock;
  let updateMany: jest.Mock;
  let startedResults: boolean;
  const connection = { host: '127.0.0.1', port: 6379 };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    mockPrefix = `test-batch-result-${randomUUID()}`;
    batchId = randomUUID();
    redis = new Redis({
      ...connection,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    await redis.ping();
    results = new Queue<BatchResult>('batch-result', {
      connection,
      prefix: mockPrefix,
    });
    batch = new Queue('batch', { connection, prefix: mockPrefix });
    notifications = new Queue('batch-webhook', {
      connection,
      prefix: mockPrefix,
    });
    const config = new ConfigService({
      REDIS_URL: 'redis://127.0.0.1:6379',
      WORKER_CONCURRENCY: 2,
    });
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      batchJob: {
        findUnique: jest.fn().mockResolvedValue({ totalMessages: 1 }),
        updateMany,
      },
    };
    service = new BatchResultService(
      config,
      prisma as unknown as PrismaService,
      results,
      notifications,
    );
    sendText = jest
      .fn()
      .mockResolvedValue({ key: { id: 'confirmed-provider-response' } });
    worker = new BatchWorker(
      config,
      { resolve: () => ({ sendText }) } as unknown as AdapterResolverService,
      service,
    );
    startedResults = false;
  });

  afterEach(async () => {
    await worker.onModuleDestroy();
    if (startedResults) await service.onModuleDestroy();
    // Each queue and key belongs to this test's random prefix/UUID only.
    const cleanup = new Queue('batch-result', {
      connection,
      prefix: mockPrefix,
    });
    for (const queue of [batch, notifications, cleanup]) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
    if (!startedResults) await results.close();
    await redis.del(
      ...['results', 'sent', 'failed', 'done', 'total'].map(
        (name) => `batch:${name}:${batchId}`,
      ),
    );
    redis.disconnect();
    jest.restoreAllMocks();
  });

  async function until(check: () => Promise<boolean>) {
    const deadline = Date.now() + 15000;
    while (!(await check())) {
      if (Date.now() > deadline)
        throw new Error('Timed out waiting for isolated queue');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  function outcome(): BatchResult {
    return {
      batchJobId: batchId,
      jobId: 'message-1',
      success: true,
      deliveryError: null,
      processedAt: new Date().toISOString(),
      notification: {
        batchJobId: batchId,
        productId: 'fixture',
        instanceId: 'fixture',
        apiKeyHash: 'fixture',
        batchWebhookUrl: 'https://not-called.invalid',
        success: true,
        deliveryError: null,
        processedAt: new Date().toISOString(),
        messagePayload: { text: 'fixture' },
      },
    };
  }

  it('counts each result once under concurrent duplicate attempts', async () => {
    const record = (id: number) =>
      redis.eval(
        RECORD_BATCH_RESULT,
        3,
        `batch:results:${batchId}`,
        `batch:${id % 2 ? 'failed' : 'sent'}:${batchId}`,
        `batch:done:${batchId}`,
        String(id),
        id % 2 ? 'failed' : 'sent',
      );
    await Promise.all(
      Array.from({ length: 200 }, (_, id) =>
        Promise.all([record(id), record(id), record(id)]),
      ),
    );
    expect(
      await redis.mget(
        `batch:sent:${batchId}`,
        `batch:failed:${batchId}`,
        `batch:done:${batchId}`,
      ),
    ).toEqual(['100', '100', '200']);
    expect(await redis.hlen(`batch:results:${batchId}`)).toBe(200);
  });

  it('recovers a lost Redis reply after counting without double counting', async () => {
    const client = await results.client;
    const original = client.eval.bind(client);
    jest
      .spyOn(client, 'eval')
      .mockImplementationOnce(
        async (...args: Parameters<typeof client.eval>) => {
          await original(...args);
          throw new Error('reply lost after commit');
        },
      );
    await expect(service.complete(outcome())).rejects.toThrow(
      'reply lost after commit',
    );
    await service.complete(outcome());
    expect(
      await redis.mget(`batch:sent:${batchId}`, `batch:done:${batchId}`),
    ).toEqual(['1', '1']);
    expect(await notifications.getWaitingCount()).toBe(1);
  });

  it('retries finalization after PostgreSQL failure without replaying a provider call', async () => {
    updateMany.mockRejectedValueOnce(new Error('temporary database outage'));
    service.onModuleInit();
    startedResults = true;
    await service.publish(outcome());
    await until(async () => (await results.getCompletedCount()) === 1);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(
      await redis.mget(`batch:sent:${batchId}`, `batch:done:${batchId}`),
    ).toEqual(['1', '1']);
    expect(await notifications.getWaitingCount()).toBe(1);
    expect(sendText).not.toHaveBeenCalled();
    const completed = await results.getJobs(['completed']);
    expect(completed[0].data.notification).toBeNull();
    expect(completed[0].data.finalized).toBe(true);
    expect(await redis.ttl(`batch:results:${batchId}`)).toBeGreaterThan(86400);
  });

  it('delays only the result handoff and reuses the confirmed outcome on recovery', async () => {
    jest
      .spyOn(service, 'publish')
      .mockRejectedValueOnce(new Error('result handoff unavailable'));
    service.onModuleInit();
    startedResults = true;
    worker.onModuleInit();
    await batch.add(
      'sendText',
      {
        batchJobId: batchId,
        productId: 'fixture',
        instanceId: 'fixture',
        apiKeyHash: 'fixture',
        adapterType: 'evolution',
        providerUrl: 'https://original-provider.invalid',
        providerApiKey: 'fixture',
        instanceName: 'fixture',
        messageType: 'text',
        message: { text: 'test' },
        webhook: null,
      },
      { attempts: 1 },
    );
    await until(
      async () =>
        (await batch.getCompletedCount()) === 1 &&
        (await results.getCompletedCount()) === 1,
    );
    expect(sendText).toHaveBeenCalledTimes(1);
    expect((sendText.mock.calls[0] as [unknown])[0]).toEqual({
      providerUrl: 'https://original-provider.invalid',
      providerApiKey: 'fixture',
    });
    expect(
      await redis.mget(
        `batch:sent:${batchId}`,
        `batch:failed:${batchId}`,
        `batch:done:${batchId}`,
      ),
    ).toEqual(['1', null, '1']);
  });
});
