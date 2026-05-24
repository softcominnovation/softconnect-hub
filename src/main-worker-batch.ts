import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { BatchWorkerAppModule } from './batch-worker.module';

async function bootstrapWorker(): Promise<void> {
  const logger = new Logger('WorkerBatch');

  const app = await NestFactory.createApplicationContext(BatchWorkerAppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.enableShutdownHooks();

  logger.log('Worker running — waiting for jobs [queues: batch, batch-webhook]');
}

void bootstrapWorker();
