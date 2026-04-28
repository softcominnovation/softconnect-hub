import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { CacheService } from '../../cache/cache.service';
import { BATCH_QUEUE } from './queue.constants';

export interface BatchJobPayload {
  batchJobId: string;
  productId: string;
  adapterType: string;
  instanceName: string;
  providerUrl: string;
  providerApiKey: string;
  message: unknown;
}

@Injectable()
export class BatchProducer implements OnModuleDestroy {
  constructor(
    @Inject(BATCH_QUEUE) private readonly queue: Queue,
    private readonly cache: CacheService,
  ) {}

  async addJobs(
    batchJobId: string,
    productId: string,
    adapterType: string,
    instanceName: string,
    providerUrl: string,
    providerApiKey: string,
    messages: unknown[],
    delayMs?: number,
  ): Promise<void> {
    await this.cache.setWithTTL(
      `batch:total:${batchJobId}`,
      messages.length,
      86400,
    );

    const jobs = messages.map((message, index) => ({
      name: 'sendText',
      data: {
        batchJobId,
        productId,
        adapterType,
        instanceName,
        providerUrl,
        providerApiKey,
        message,
      } satisfies BatchJobPayload,
      opts: {
        delay: delayMs ? index * delayMs : undefined,
        attempts: 1,
        removeOnComplete: { count: 0 },
        removeOnFail: { count: 100 },
      },
    }));

    await this.queue.addBulk(jobs);
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
