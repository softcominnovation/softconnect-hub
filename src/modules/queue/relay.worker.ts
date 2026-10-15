import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { createHmac } from 'crypto';
import * as http from 'http';
import * as https from 'https';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { parseRedisConnection } from '../../common/redis.util';
import { RelayIngressService } from './relay-ingress.service';
import { RELAY_QUEUE_NAME } from './queue.constants';

export interface RelayJobPayload {
  version?: 2;
  providerId?: string;
  instanceId?: string;
  productId?: string;
  providerInstanceId?: string | null;
  pendingEventId?: string;
  adapterType: string;
  instanceName: string;
  body: unknown;
}

@Injectable()
export class RelayWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RelayWorker.name);
  private worker!: Worker<RelayJobPayload>;
  private legacyWorker!: Worker<RelayJobPayload>;
  private readonly httpAgent = new http.Agent({ keepAlive: true });
  private readonly httpsAgent = new https.Agent({ keepAlive: true });

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly ingress: RelayIngressService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<RelayJobPayload>(
      RELAY_QUEUE_NAME,
      async (job) => {
        const payload = job.data;
        if (payload.version !== 2) {
          await this.ingress.retainLegacyJob(payload, String(job.id));
          return;
        }
        await this.relay(payload);
      },
      {
        connection: parseRedisConnection(this.config),
        concurrency: this.config.get<number>('RELAY_CONCURRENCY') ?? 20,
      },
    );
    this.worker.on('error', () =>
      this.logger.error('event=relay_worker_error'),
    );
    this.worker.on('failed', (job) => {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        void this.ingress
          .markEvent(job.data.pendingEventId, 'failed', 'delivery_failed')
          .catch(() => this.logger.warn('event=relay_failure_record_pending'));
      }
    });
    // Older replicas consume only `relay`; they must never receive version 2 jobs.
    this.legacyWorker = new Worker<RelayJobPayload>(
      'relay',
      async (job) => this.ingress.retainLegacyJob(job.data, String(job.id)),
      { connection: parseRedisConnection(this.config), concurrency: 1 },
    );
    this.legacyWorker.on('error', () =>
      this.logger.error('event=legacy_relay_worker_error'),
    );
  }

  private async relay(payload: RelayJobPayload): Promise<void> {
    const instance = await this.ingress.validateJob(payload);
    if (!instance) {
      await this.ingress.markEvent(
        payload.pendingEventId,
        'retained',
        'identity_changed',
      );
      return;
    }
    if (!instance.product.hubRelay || !instance.product.isActive) {
      await this.ingress.markEvent(
        payload.pendingEventId,
        'delivered',
        'relay_disabled',
      );
      return;
    }
    const webhook = await this.prisma.webhookConfig.findFirst({
      where: { productId: instance.productId, isActive: true },
    });
    if (!webhook) {
      await this.ingress.markEvent(
        payload.pendingEventId,
        'retained',
        'destination_missing',
      );
      return;
    }
    const event =
      typeof payload.body === 'object' && payload.body !== null
        ? (payload.body as Record<string, unknown>).event
        : undefined;
    const normalize = (value: string) =>
      value.replace(/[.-]/g, '_').toUpperCase();
    if (
      webhook.events.length &&
      (typeof event !== 'string' ||
        !webhook.events.some(
          (allowed) => normalize(allowed) === normalize(event),
        ))
    ) {
      await this.ingress.markEvent(
        payload.pendingEventId,
        'delivered',
        'event_filtered',
      );
      return;
    }
    const signature = createHmac('sha256', webhook.secret)
      .update(JSON.stringify(payload.body))
      .digest('hex');
    try {
      await axios.post(webhook.url, payload.body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature': `sha256=${signature}`,
        },
        httpAgent: this.httpAgent,
        httpsAgent: this.httpsAgent,
        timeout: 10000,
      });
      await this.ingress.markEvent(payload.pendingEventId, 'delivered');
    } catch (error) {
      this.logger.warn('event=relay_delivery_failed');
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.legacyWorker?.close();
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  }
}
