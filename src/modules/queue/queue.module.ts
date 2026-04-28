import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { AuthModule } from '../../auth/auth.module';
import { CacheModule } from '../../cache/cache.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProviderModule } from '../../providers/provider.module';
import { BatchProducer } from './batch.producer';
import { BatchWorker } from './batch.worker';
import { InternalWebhookController } from './internal-webhook.controller';
import { RelayWorker } from './relay.worker';
import { BATCH_QUEUE, RELAY_QUEUE } from './queue.constants';

export { BATCH_QUEUE, RELAY_QUEUE };

function parseRedisConnection(config: ConfigService): {
  host: string;
  port: number;
  password?: string;
  db?: number;
} {
  const raw = config.getOrThrow<string>('REDIS_URL');
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379'),
    password: url.password || undefined,
    db:
      url.pathname && url.pathname !== '/'
        ? parseInt(url.pathname.slice(1))
        : 0,
  };
}

@Module({
  imports: [PrismaModule, CacheModule, ProviderModule, AuthModule],
  controllers: [InternalWebhookController],
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
    BatchWorker,
    RelayWorker,
  ],
  exports: [BatchProducer],
})
export class QueueModule {}
