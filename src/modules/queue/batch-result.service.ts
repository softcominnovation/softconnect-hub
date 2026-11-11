import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaService } from '../../prisma/prisma.service';
import { parseRedisConnection } from '../../common/redis.util';
import { BatchWebhookJobPayload } from './batch-webhook.worker';
import { BATCH_RESULT_QUEUE, BATCH_WEBHOOK_QUEUE } from './queue.constants';

export interface BatchResult {
  finalized?: true;
  batchJobId: string;
  jobId: string;
  success: boolean;
  processedAt: string;
  deliveryError: string | null;
  notification: BatchWebhookJobPayload | null;
}

// The marker and counters change together: a lost Redis reply must not count twice.
export const RECORD_BATCH_RESULT = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then
  redis.call('INCR', KEYS[2])
  redis.call('INCR', KEYS[3])
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
end
return redis.call('GET', KEYS[3])
`;

@Injectable()
export class BatchResultService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BatchResultService.name);
  private worker!: Worker<BatchResult>;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(BATCH_RESULT_QUEUE) private readonly queue: Queue<BatchResult>,
    @Inject(BATCH_WEBHOOK_QUEUE) private readonly webhookQueue: Queue,
  ) {}

  onModuleInit() {
    this.worker = new Worker<BatchResult>(
      'batch-result',
      async (job) => {
        if (job.data.finalized) return;
        await this.complete(job.data, async () => {
          await job.updateData({ ...job.data, notification: null });
        });
        // Retained completion jobs must not keep a second copy of large media.
        await job.updateData({
          ...job.data,
          notification: null,
          finalized: true,
        });
      },
      { connection: parseRedisConnection(this.config), concurrency: 2 },
    );
    this.worker.on('error', (error) =>
      this.logger.error(`Batch result worker: ${String(error)}`),
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(
        `Batch ${job?.data.batchJobId} result registration failed; provider result unchanged; no message resend: ${error.message}`,
      ),
    );
  }

  async publish(result: BatchResult): Promise<void> {
    let failure: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.queue.add('complete', result, {
          jobId: this.id(result),
          attempts: 10,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { count: 100 },
          removeOnFail: false,
        });
        return;
      } catch (error) {
        failure = error;
        if (attempt < 2) await delay(250 * (attempt + 1));
      }
    }
    throw failure;
  }

  async complete(
    result: BatchResult,
    notificationQueued?: () => Promise<void>,
  ): Promise<void> {
    const client = await this.queue.client;
    await client.eval(
      RECORD_BATCH_RESULT,
      3,
      `batch:results:${result.batchJobId}`,
      `batch:${result.success ? 'sent' : 'failed'}:${result.batchJobId}`,
      `batch:done:${result.batchJobId}`,
      result.jobId,
      result.success ? 'sent' : 'failed',
    );

    if (result.notification) {
      await this.webhookQueue.add('notify', result.notification, {
        jobId: this.id(result),
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 100 },
        removeOnFail: false,
      });
      await notificationQueued?.();
    }

    const counts = await client.mget(
      `batch:sent:${result.batchJobId}`,
      `batch:failed:${result.batchJobId}`,
      `batch:done:${result.batchJobId}`,
      `batch:total:${result.batchJobId}`,
    );
    const [sent, failed, done] = counts.map((value) => Number(value ?? 0));
    const total =
      counts[3] === null
        ? (
            await this.prisma.batchJob.findUnique({
              where: { id: result.batchJobId },
              select: { totalMessages: true },
            })
          )?.totalMessages
        : Number(counts[3]);
    if (total === undefined || done !== total || sent + failed !== done) return;
    // Never recreate a deleted batch or overwrite a previously completed result.
    await this.prisma.batchJob.updateMany({
      where: { id: result.batchJobId, status: 'processing' },
      data: {
        sentCount: sent,
        failedCount: failed,
        status: 'completed',
        completedAt: new Date(),
      },
    });
    // Only completed batches can expire their deduplication/counting records.
    // Failed/pending results remain recoverable without losing their counters.
    for (const name of ['results', 'sent', 'failed', 'done', 'total']) {
      await client.expire(`batch:${name}:${result.batchJobId}`, 7 * 86400);
    }
  }

  private id(result: BatchResult): string {
    return createHash('sha256')
      .update(`${result.batchJobId}:${result.jobId}`)
      .digest('hex');
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue.close();
  }
}
