import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdapterResolverService } from '../providers/adapter-resolver.service';
import type { ProviderContext } from '../providers/whatsapp-provider.interface';
import type { BatchJobPayload } from './batch.producer';

@Injectable()
export class BatchWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BatchWorker.name);
  private worker!: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly adapterResolver: AdapterResolverService,
  ) {}

  onModuleInit() {
    const raw = this.config.getOrThrow<string>('REDIS_URL');
    const url = new URL(raw);
    const connection = {
      host: url.hostname,
      port: parseInt(url.port || '6379'),
      password: url.password || undefined,
      db:
        url.pathname && url.pathname !== '/'
          ? parseInt(url.pathname.slice(1))
          : 0,
    };

    this.worker = new Worker(
      'batch',
      async (job) => {
        const payload = job.data as BatchJobPayload;
        const ctx: ProviderContext = {
          providerUrl: payload.providerUrl,
          providerApiKey: payload.providerApiKey,
        };
        const adapter = this.adapterResolver.resolve(payload.adapterType);

        try {
          await adapter.sendText(
            ctx,
            payload.instanceName,
            payload.message as Parameters<typeof adapter.sendText>[2],
          );
          await this.cache.increment(`batch:sent:${payload.batchJobId}`);
        } catch (err) {
          await this.cache.increment(`batch:failed:${payload.batchJobId}`);
          this.logger.error(
            `Batch job ${payload.batchJobId} failed: ${String(err)}`,
          );
          throw err;
        } finally {
          await this.finalizeBatchIfDone(payload.batchJobId);
        }
      },
      { connection },
    );

    this.worker.on('error', (err) => {
      this.logger.error(`BatchWorker error: ${String(err)}`);
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
