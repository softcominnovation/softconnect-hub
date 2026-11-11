import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DelayedError, Worker } from 'bullmq';
import { setTimeout as delay } from 'node:timers/promises';
import { parseRedisConnection } from '../../common/redis.util';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import type { ProviderContext } from '../../providers/whatsapp-provider.interface';
import type { BatchJobPayload } from './batch.producer';
import type { BatchWebhookJobPayload } from './batch-webhook.worker';
import { BatchResultService } from './batch-result.service';
import { MediaTimeoutException } from '../../common/media-request-context';

@Injectable()
export class BatchWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BatchWorker.name);
  private worker!: Worker<BatchJobPayload>;

  constructor(
    private readonly config: ConfigService,
    private readonly adapterResolver: AdapterResolverService,
    private readonly results: BatchResultService,
  ) {}

  onModuleInit() {
    const connection = parseRedisConnection(this.config);
    const concurrency = this.config.get<number>('WORKER_CONCURRENCY') ?? 10;

    this.worker = new Worker<BatchJobPayload>(
      'batch',
      async (job, token) => {
        const payload = job.data;
        const ctx: ProviderContext = {
          providerUrl: payload.providerUrl,
          providerApiKey: payload.providerApiKey,
        };

        let success = true;
        let deliveryError: string | null = null;
        let providerError: Error | undefined;
        let processedAt: string;
        const checkpoint = payload.batchExecution;
        if (checkpoint?.result) {
          ({ success, deliveryError, processedAt } = checkpoint.result);
        } else if (checkpoint?.started) {
          if (checkpoint.settleAfter && Date.now() < checkpoint.settleAfter) {
            await job.moveToDelayed(
              Math.min(Date.now() + 5000, checkpoint.settleAfter),
              token,
            );
            throw new DelayedError();
          }
          success = false;
          deliveryError =
            'Processamento interrompido após início da tentativa. Resultado do envio não confirmado; a mensagem não foi reenviada.';
          processedAt = new Date().toISOString();
        } else {
          // Persist before dispatch. A recovered/stalled job must never send again.
          await job.updateData({
            ...payload,
            batchExecution: {
              started: true,
              settleAfter:
                Date.now() +
                (this.config.get<number>('MEDIA_REQUEST_TIMEOUT_MS') ??
                  900000) +
                (this.config.get<number>('SEND_PROVIDER_TIMEOUT_MS') ??
                  600000) +
                30000,
            },
          });

          try {
            const adapter = this.adapterResolver.resolve(payload.adapterType);
            // Jobs antigos na fila podem não ter messageType — default text
            const messageType = payload.messageType ?? 'text';

            if (messageType === 'media') {
              await adapter.sendMedia(
                ctx,
                payload.instanceName,
                payload.message as Parameters<typeof adapter.sendMedia>[2],
              );
            } else if (messageType === 'document') {
              await adapter.sendDocument(
                ctx,
                payload.instanceName,
                payload.message as Parameters<typeof adapter.sendDocument>[2],
              );
            } else {
              await adapter.sendText(
                ctx,
                payload.instanceName,
                payload.message as Parameters<typeof adapter.sendText>[2],
              );
            }
          } catch (err) {
            success = false;
            deliveryError =
              err instanceof MediaTimeoutException
                ? `Media request timeout (${err.reason}); delivery not confirmed`
                : err instanceof Error
                  ? err.message || 'Unknown delivery error'
                  : 'Unknown delivery error';
            providerError =
              err instanceof Error ? err : new Error(deliveryError);
            this.logger.error(
              `Batch job ${payload.batchJobId} failed: ${String(err)}`,
            );
          }
          processedAt = new Date().toISOString();
        }
        const outcome = { success, deliveryError, processedAt };
        // A checkpoint failure must not replace the real provider outcome.
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await job.updateData({
              ...payload,
              batchExecution: { started: true, result: outcome },
            });
            break;
          } catch (error) {
            if (attempt < 2) await delay(250 * (attempt + 1));
            else
              this.logger.error(
                `Batch ${payload.batchJobId}: result checkpoint unavailable; provider success=${success}; no resend: ${String(error)}`,
              );
          }
        }
        {
          // Compat: jobs antigos usavam batchWebhookEnabled/Url no payload
          const legacy = payload as BatchJobPayload & {
            batchWebhookEnabled?: boolean;
            batchWebhookUrl?: string | null;
          };
          const webhook =
            payload.webhook ??
            (legacy.batchWebhookEnabled && legacy.batchWebhookUrl
              ? { url: legacy.batchWebhookUrl }
              : null);

          const notification: BatchWebhookJobPayload | null = webhook?.url
            ? {
                batchWebhookUrl: webhook.url,
                batchWebhookHeaders: webhook.headers ?? null,
                apiKeyHash: payload.apiKeyHash,
                batchJobId: payload.batchJobId,
                productId: payload.productId,
                instanceId: payload.instanceId,
                ...outcome,
                messagePayload: payload.message as Record<string, unknown>,
              }
            : null;
          try {
            await this.results.publish({
              batchJobId: payload.batchJobId,
              jobId: job.id!,
              ...outcome,
              notification,
            });
          } catch (error) {
            this.logger.error(
              'Batch ' +
                payload.batchJobId +
                ': result registration pending; provider success=' +
                success +
                '; no resend: ' +
                String(error),
            );
            // Only the recorded outcome is retried; the adapter is never called here.
            // Never defer a known outcome that has not been durably checkpointed.
            await job.updateData({
              ...payload,
              batchExecution: { started: true, result: outcome },
            });
            await job.moveToDelayed(Date.now() + 5000, token);
            throw new DelayedError();
          }
        }
        if (providerError) throw providerError;
        if (!success)
          throw new Error(deliveryError ?? 'Resultado do envio não confirmado');
      },
      { connection, concurrency },
    );
    this.worker.on('error', (err) =>
      this.logger.error('BatchWorker error: ' + String(err)),
    );
    this.worker.on('active', (job) =>
      this.logger.log(
        'Job ' + job.id + ' | batch ' + job.data.batchJobId + ' → started',
      ),
    );
    this.worker.on('completed', (job) =>
      this.logger.log(
        'Job ' + job.id + ' | batch ' + job.data.batchJobId + ' → completed',
      ),
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(
        'Job ' +
          job?.id +
          ' | batch ' +
          job?.data?.batchJobId +
          ' → failed — ' +
          err.message,
      ),
    );
    this.worker.on('stalled', (jobId) =>
      this.logger.warn(
        'Job ' +
          jobId +
          ' → stalled — recovery will not resend a started message',
      ),
    );
  }
  async onModuleDestroy() {
    await this.worker?.close();
  }
}
