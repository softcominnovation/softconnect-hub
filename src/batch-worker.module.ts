import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { BatchWorkerQueueModule } from './modules/batch-worker/batch-worker-queue.module';

@Module({
  imports: [CoreModule, BatchWorkerQueueModule],
})
export class BatchWorkerAppModule {}
