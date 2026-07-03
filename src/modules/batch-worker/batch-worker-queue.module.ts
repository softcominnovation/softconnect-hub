import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { CacheModule } from '../../cache/cache.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProviderModule } from '../../providers/provider.module';
import { parseRedisConnection } from '../../common/redis.util';
import { BatchWebhookWorker } from '../queue/batch-webhook.worker';
import { BatchWorker } from '../queue/batch.worker';
import { BATCH_QUEUE, BATCH_WEBHOOK_QUEUE } from '../queue/queue.constants';

@Module({
  imports: [PrismaModule, CacheModule, ProviderModule],
  providers: [
    {
      provide: BATCH_QUEUE,
      useFactory: (config: ConfigService) =>
        new Queue('batch', { connection: parseRedisConnection(config) }),
      inject: [ConfigService],
    },
    {
      provide: BATCH_WEBHOOK_QUEUE,
      useFactory: (config: ConfigService) =>
        new Queue('batch-webhook', {
          connection: parseRedisConnection(config),
        }),
      inject: [ConfigService],
    },
    BatchWorker,
    BatchWebhookWorker,
  ],
})
export class BatchWorkerQueueModule {}
