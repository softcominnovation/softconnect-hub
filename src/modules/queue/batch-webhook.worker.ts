import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { createHmac } from 'crypto';
import axios from 'axios';

export interface BatchWebhookJobPayload {
  batchWebhookUrl: string;
  apiKeyHash: string;
  batchJobId: string;
  productId: string;
  instanceId: string;
  success: boolean;
  processedAt: string;
  deliveryError: string | null;
  messagePayload: Record<string, unknown>;
}

@Injectable()
export class BatchWebhookWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BatchWebhookWorker.name);
  private worker!: Worker;

  constructor(private readonly config: ConfigService) {}

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
      'batch-webhook',
      async (job) => {
        const payload = job.data as BatchWebhookJobPayload;
        await this.deliver(payload);
      },
      { connection },
    );

    this.worker.on('error', (err) => {
      this.logger.error(`BatchWebhookWorker error: ${String(err)}`);
    });
  }

  private async deliver(payload: BatchWebhookJobPayload): Promise<void> {
    const body = {
      event: 'batch.message.result',
      batchJobId: payload.batchJobId,
      productId: payload.productId,
      instanceId: payload.instanceId,
      success: payload.success,
      processedAt: payload.processedAt,
      deliveryError: payload.deliveryError,
      payload: payload.messagePayload,
    };

    const bodyStr = JSON.stringify(body);
    const signature = createHmac('sha256', payload.apiKeyHash)
      .update(bodyStr)
      .digest('hex');

    try {
      await axios.post(payload.batchWebhookUrl, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature': `sha256=${signature}`,
          'X-Hub-Event': 'batch.message.result',
        },
        timeout: 10000,
        validateStatus: (s) => s >= 200 && s < 300,
      });
    } catch (err) {
      this.logger.warn(
        `BatchWebhookWorker: falha ao entregar webhook para ${payload.batchWebhookUrl} — ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    this.logger.log(
      `[batch-webhook] delivered batchJobId=${payload.batchJobId} success=${payload.success}`,
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
