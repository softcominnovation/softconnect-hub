import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { parseRedisConnection } from '../../common/redis.util';
import { CacheService } from '../../cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import type { ProviderContext } from '../../providers/whatsapp-provider.interface';
import type { BatchJobPayload } from './batch.producer';
import type { BatchWebhookJobPayload } from './batch-webhook.worker';
import { BATCH_WEBHOOK_QUEUE } from './queue.constants';

@Injectable()
export class BatchWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BatchWorker.name);
  private worker!: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly adapterResolver: AdapterResolverService,
    @Inject(BATCH_WEBHOOK_QUEUE) private readonly batchWebhookQueue: Queue,
  ) {}

  onModuleInit() {
    const connection = parseRedisConnection(this.config);
    const concurrency = this.config.get<number>('WORKER_CONCURRENCY') ?? 10;

    this.worker = new Worker(
      'batch',
      async (job) => {
        const payload = job.data as BatchJobPayload;
        const ctx: ProviderContext = {
          providerUrl: payload.providerUrl,
          providerApiKey: payload.providerApiKey,
        };
        const adapter = this.adapterResolver.resolve(payload.adapterType);

        let success = true;
        let deliveryError: string | null = null;
        const processedAt = new Date().toISOString();

        try {
          await adapter.sendText(
            ctx,
            payload.instanceName,
            payload.message as Parameters<typeof adapter.sendText>[2],
          );
          await this.cache.increment(`batch:sent:${payload.batchJobId}`);
        } catch (err) {
          success = false;
          deliveryError =
            err instanceof Error
              ? err.message || 'Unknown delivery error'
              : 'Unknown delivery error';
          await this.cache.increment(`batch:failed:${payload.batchJobId}`);
          this.logger.error(
            `Batch job ${payload.batchJobId} failed: ${String(err)}`,
          );
          throw err;
        } finally {
          if (payload.batchWebhookEnabled && payload.batchWebhookUrl) {
            try {
              await this.batchWebhookQueue.add(
                'notify',
                {
                  batchWebhookUrl: payload.batchWebhookUrl,
                  apiKeyHash: payload.apiKeyHash,
                  batchJobId: payload.batchJobId,
                  productId: payload.productId,
                  instanceId: payload.instanceId,
                  success,
                  processedAt,
                  deliveryError,
                  messagePayload: payload.message as Record<string, unknown>,
                } satisfies BatchWebhookJobPayload,
                {
                  attempts: 3,
                  backoff: { type: 'exponential', delay: 1000 },
                  removeOnComplete: { count: 100 },
                  removeOnFail: false,
                },
              );
            } catch (webhookErr) {
              this.logger.error(
                `[BatchWorker] failed to enqueue webhook notification for batch ${payload.batchJobId}: ${String(webhookErr)}`,
              );
            }
          }
          try {
            await this.finalizeBatchIfDone(payload.batchJobId);
          } catch (finalizeErr) {
            this.logger.error(
              `[BatchWorker] failed to finalize batch ${payload.batchJobId}: ${String(finalizeErr)}`,
            );
          }
        }
      },
      { connection, concurrency },
    );

    this.worker.on('error', (err) => {
      this.logger.error(`BatchWorker error: ${String(err)}`);
    });

    this.worker.on('active', (job) => {
      this.logger.log(`Job ${job.id} | batch ${job.data.batchJobId} → started`);
    });

    this.worker.on('completed', (job) => {
      this.logger.log(
        `Job ${job.id} | batch ${job.data.batchJobId} → completed`,
      );
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Job ${job?.id} | batch ${job?.data?.batchJobId} → failed — ${err.message}`,
      );
    });

    this.worker.on('stalled', (jobId) => {
      this.logger.warn(`Job ${jobId} → stalled — will be reprocessed`);
    });
  }

  private async finalizeBatchIfDone(batchJobId: string): Promise<void> {
    const done = await this.cache.increment(`batch:done:${batchJobId}`);
    const total = await this.cache.get<number>(`batch:total:${batchJobId}`);

    if (total === null || done !== total) return;

    const sent =
      (await this.cache.get<number>(`batch:sent:${batchJobId}`)) ?? 0;
    const failed =
      (await this.cache.get<number>(`batch:failed:${batchJobId}`)) ?? 0;

    await this.prisma.batchJob.update({
      where: { id: batchJobId },
      data: {
        sentCount: sent,
        failedCount: failed,
        status: 'completed',
        completedAt: new Date(),
      },
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
