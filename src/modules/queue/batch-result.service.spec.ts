import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BatchResult,
  BatchResultService,
  RECORD_BATCH_RESULT,
} from './batch-result.service';

describe('BatchResultService: internal retries never dispatch messages', () => {
  const result: BatchResult = {
    batchJobId: 'batch-1',
    jobId: 'message-1',
    success: true,
    processedAt: '2026-11-10T12:00:00.000Z',
    deliveryError: null,
    notification: {
      batchJobId: 'batch-1',
      productId: 'product-1',
      instanceId: 'instance-1',
      apiKeyHash: 'test-hash',
      batchWebhookUrl: 'https://callback.invalid',
      success: true,
      processedAt: '2026-11-10T12:00:00.000Z',
      deliveryError: null,
      messagePayload: { text: 'fixture' },
    },
  };
  let redis: { eval: jest.Mock; mget: jest.Mock; expire: jest.Mock };
  let queue: { add: jest.Mock; client: Promise<typeof redis> };
  let webhook: { add: jest.Mock };
  let batchJob: { findUnique: jest.Mock; updateMany: jest.Mock };
  let service: BatchResultService;

  beforeEach(() => {
    redis = {
      expire: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue('1'),
      mget: jest.fn().mockResolvedValue(['1', '0', '1', '1']),
    };
    queue = {
      add: jest.fn().mockResolvedValue({}),
      client: Promise.resolve(redis),
    };
    webhook = { add: jest.fn().mockResolvedValue({}) };
    batchJob = {
      findUnique: jest.fn().mockResolvedValue({ totalMessages: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    service = new BatchResultService(
      new ConfigService(),
      { batchJob } as unknown as PrismaService,
      queue as unknown as Queue<BatchResult>,
      webhook as unknown as Queue,
    );
  });

  it('retries only result publication with a stable ID after an ambiguous Redis response', async () => {
    queue.add.mockRejectedValueOnce(new Error('connection lost after enqueue'));
    await service.publish(result);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add.mock.calls[0]).toEqual(queue.add.mock.calls[1]);
    expect(queue.add).toHaveBeenLastCalledWith(
      'complete',
      result,
      expect.objectContaining({ attempts: 10, removeOnFail: false }),
    );
  });

  it('bounds publication retries and preserves the input outcome', async () => {
    queue.add.mockRejectedValue(new Error('Redis down'));
    await expect(service.publish(result)).rejects.toThrow('Redis down');
    expect(queue.add).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(true);
    expect(result.deliveryError).toBeNull();
  });

  it('records the message identity atomically with sent/done and preserves callback fields', async () => {
    await service.complete(result);
    expect(redis.eval).toHaveBeenCalledWith(
      RECORD_BATCH_RESULT,
      3,
      'batch:results:batch-1',
      'batch:sent:batch-1',
      'batch:done:batch-1',
      'message-1',
      'sent',
    );
    expect(webhook.add).toHaveBeenCalledWith(
      'notify',
      result.notification,
      expect.objectContaining({ attempts: 3 }),
    );
    expect(batchJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'batch-1', status: 'processing' },
        data: expect.objectContaining({
          sentCount: 1,
          failedCount: 0,
          status: 'completed',
        }) as Record<string, unknown>,
      }),
    );
  });

  it('retries PostgreSQL finalization even when done already equals total', async () => {
    batchJob.updateMany.mockRejectedValueOnce(new Error('Postgres down'));
    await expect(service.complete(result)).rejects.toThrow('Postgres down');
    await service.complete(result);
    expect(batchJob.updateMany).toHaveBeenCalledTimes(2);
    expect(webhook.add.mock.calls[0]).toEqual(webhook.add.mock.calls[1]);
    expect(result.success).toBe(true);
  });

  it('does not classify a failed counter write as a provider failure', async () => {
    redis.eval.mockRejectedValueOnce(new Error('Redis down'));
    await expect(service.complete(result)).rejects.toThrow('Redis down');
    expect(webhook.add).not.toHaveBeenCalled();
    await service.complete(result);
    expect(webhook.add).toHaveBeenCalledWith(
      'notify',
      expect.objectContaining({ success: true, deliveryError: null }),
      expect.any(Object),
    );
    expect(
      redis.eval.mock.calls.every(
        (call: unknown[]) => call[3] === 'batch:sent:batch-1',
      ),
    ).toBe(true);
  });

  it('recovers notification scheduling without changing the original failure', async () => {
    const failure = {
      ...result,
      success: false,
      deliveryError: 'Evolution respondeu 408',
      notification: {
        ...result.notification!,
        success: false,
        deliveryError: 'Evolution respondeu 408',
      },
    };
    redis.mget.mockResolvedValue(['0', '1', '1', '1']);
    webhook.add.mockRejectedValueOnce(new Error('Redis reply lost'));
    await expect(service.complete(failure)).rejects.toThrow('Redis reply lost');
    await service.complete(failure);
    expect(webhook.add.mock.calls[0]).toEqual(webhook.add.mock.calls[1]);
    expect(batchJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sentCount: 0,
          failedCount: 1,
        }) as Record<string, unknown>,
      }),
    );
  });

  it('does not complete a batch while other messages are pending', async () => {
    redis.mget.mockResolvedValue(['1', '0', '1', '2']);
    await service.complete(result);
    expect(batchJob.updateMany).not.toHaveBeenCalled();
  });

  it('uses durable totalMessages when the old Redis total key has expired', async () => {
    redis.mget.mockResolvedValue(['1', '0', '1', null]);
    await service.complete(result);
    expect(batchJob.findUnique).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      select: { totalMessages: true },
    });
    expect(batchJob.updateMany).toHaveBeenCalledTimes(1);
  });

  it('does not recreate a batch deleted through the existing API', async () => {
    redis.mget.mockResolvedValue(['1', '0', '1', null]);
    batchJob.findUnique.mockResolvedValue(null);
    await service.complete(result);
    expect(batchJob.updateMany).not.toHaveBeenCalled();
  });

  it('does not emit a callback when disabled', async () => {
    await service.complete({ ...result, notification: null });
    expect(webhook.add).not.toHaveBeenCalled();
  });
});
