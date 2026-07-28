import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { CacheService } from '../../cache/cache.service';
import { BATCH_QUEUE } from './queue.constants';

export type BatchMessageType = 'text' | 'media' | 'document';

export interface BatchMessageWebhook {
  url: string;
  headers?: Record<string, string>;
}

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
  /** Payload limpo para a Evolution (sem `webhook`) */
  message: unknown;
  /** Destino efetivo do callback Hub; null = não notificar */
  webhook: BatchMessageWebhook | null;
}

function stripWebhook(raw: unknown): {
  message: unknown;
  override: BatchMessageWebhook | null;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { message: raw, override: null };
  }

  const record = raw as Record<string, unknown>;
  const { webhook: webhookRaw, ...rest } = record;

  let override: BatchMessageWebhook | null = null;
  if (webhookRaw && typeof webhookRaw === 'object' && !Array.isArray(webhookRaw)) {
    const wh = webhookRaw as Record<string, unknown>;
    const url = typeof wh.url === 'string' ? wh.url.trim() : '';
    if (url) {
      const headers =
        wh.headers &&
        typeof wh.headers === 'object' &&
        !Array.isArray(wh.headers)
          ? Object.fromEntries(
              Object.entries(wh.headers as Record<string, unknown>)
                .filter(([, v]) => typeof v === 'string')
                .map(([k, v]) => [k, v as string]),
            )
          : undefined;
      override = {
        url,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      };
    }
  }

  return { message: rest, override };
}

function resolveWebhook(
  override: BatchMessageWebhook | null,
  productEnabled: boolean,
  productUrl: string | null,
): BatchMessageWebhook | null {
  if (override) return override;
  if (productEnabled && productUrl?.trim()) {
    return { url: productUrl.trim() };
  }
  return null;
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

    const jobs = messages.map((raw, index) => {
      const { message, override } = stripWebhook(raw);
      const webhook = resolveWebhook(
        override,
        batchWebhookEnabled,
        batchWebhookUrl,
      );

      return {
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
          webhook,
        } satisfies BatchJobPayload,
        opts: {
          delay: delayMs ? index * delayMs : undefined,
          attempts: 1,
          removeOnComplete: { count: 0 },
          removeOnFail: { count: 100 },
        },
      };
    });

    await this.queue.addBulk(jobs);
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
