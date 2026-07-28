import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { CacheService } from '../../cache/cache.service';
import { BATCH_QUEUE } from './queue.constants';

export type BatchMessageType = 'text' | 'media' | 'document';

export interface BatchJobPayload {
  batchJobId: string;
  productId: string;
  apiKeyHash: string;
  instanceId: string;
  adapterType: string;
  instanceName: string;
  providerUrl: string;
  providerApiKey: string;
  messageType: BatchMessageType;
  message: unknown;
  batchWebhookEnabled: boolean;
  batchWebhookUrl: string | null;
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
    apiKeyHash: string,
    instanceId: string,
    adapterType: string,
    instanceName: string,
    providerUrl: string,
    providerApiKey: string,
    messages: unknown[],
    messageType: BatchMessageType = 'text',
    delayMs?: number,
    batchWebhookEnabled = false,
    batchWebhookUrl: string | null = null,
  ): Promise<void> {
    await this.cache.setWithTTL(
      `batch:total:${batchJobId}`,
      messages.length,
      86400,
    );

    const jobName =
      messageType === 'media'
        ? 'sendMedia'
        : messageType === 'document'
          ? 'sendDocument'
          : 'sendText';

    const jobs = messages.map((message, index) => ({
      name: jobName,
      data: {
        batchJobId,
        productId,
        apiKeyHash,
        instanceId,
        adapterType,
        instanceName,
        providerUrl,
        providerApiKey,
        messageType,
        message,
        batchWebhookEnabled,
        batchWebhookUrl,
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
