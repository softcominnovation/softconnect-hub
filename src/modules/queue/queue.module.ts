import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { CacheModule } from '../../cache/cache.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProviderModule } from '../../providers/provider.module';
import { parseRedisConnection } from '../../common/redis.util';
import { BatchProducer } from './batch.producer';
import { RelayWorker } from './relay.worker';
import { BATCH_QUEUE, RELAY_QUEUE } from './queue.constants';

export { BATCH_QUEUE, RELAY_QUEUE };

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
      provide: RELAY_QUEUE,
      useFactory: (config: ConfigService) =>
        new Queue('relay', { connection: parseRedisConnection(config) }),
      inject: [ConfigService],
    },
    BatchProducer,
    RelayWorker,
  ],
  exports: [BatchProducer, RELAY_QUEUE],
})
export class QueueModule {}
