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

export interface RelayJobPayload {
  adapterType: string;
  instanceName: string;
  body: unknown;
}

@Injectable()
export class RelayWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RelayWorker.name);
  private worker!: Worker;
  private readonly httpAgent = new http.Agent({ keepAlive: true });
  private readonly httpsAgent = new https.Agent({ keepAlive: true });

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    const connection = parseRedisConnection(this.config);
    const concurrency = this.config.get<number>('RELAY_CONCURRENCY') ?? 20;

    this.worker = new Worker(
      'relay',
      async (job) => {
        const payload = job.data as RelayJobPayload;
        await this.relay(payload);
      },
      { connection, concurrency },
    );

    this.worker.on('error', (err) => {
      this.logger.error(`RelayWorker error: ${String(err)}`);
    });
  }

  private async relay(payload: RelayJobPayload): Promise<void> {
    const debug = this.config.get<boolean>('RELAY_DEBUG');
    const start = Date.now();

    if (debug) {
      this.logger.log(
        `[RELAY] job received | adapterType=${payload.adapterType} | instanceName=${payload.instanceName}`,
      );
    }

    const instance = await this.prisma.instance.findFirst({
      where: { instanceName: payload.instanceName, isActive: true },
      select: { id: true, productId: true },
    });

    if (!instance) {
      this.logger.warn(
        `Relay: no instance found for "${payload.instanceName}"`,
      );
      return;
    }

    if (debug) {
      this.logger.log(
        `[RELAY] instance resolved | instanceId=${instance.id} | productId=${instance.productId}`,
      );
    }

    const webhookConfig = await this.prisma.webhookConfig.findFirst({
      where: { productId: instance.productId, isActive: true },
    });

    if (!webhookConfig) {
      this.logger.warn(
        `Relay: no webhook config found for product "${instance.productId}"`,
      );
      return;
    }

    if (debug) {
      this.logger.log(
        `[RELAY] webhook config found | url=${webhookConfig.url} | events=${JSON.stringify(webhookConfig.events)}`,
      );
    }

    const bodyStr = JSON.stringify(payload.body);
    const signature = createHmac('sha256', webhookConfig.secret)
      .update(bodyStr)
      .digest('hex');

    const payloadKeys = Object.keys(
      typeof payload.body === 'object' && payload.body !== null
        ? (payload.body as Record<string, unknown>)
        : {},
    );

    if (debug) {
      this.logger.log(
        `[RELAY] delivering | url=${webhookConfig.url} | payloadKeys=${JSON.stringify(payloadKeys)}`,
      );
    }

    try {
      const response = await axios.post(webhookConfig.url, payload.body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature': `sha256=${signature}`,
        },
        httpAgent: this.httpAgent,
        httpsAgent: this.httpsAgent,
        timeout: 10000,
      });

      if (debug) {
        this.logger.log(
          `[RELAY] delivered ✓ | url=${webhookConfig.url} | status=${response.status} | latencyMs=${Date.now() - start}`,
        );
      }
    } catch (err: unknown) {
      const status = axios.isAxiosError(err)
        ? (err.response?.status ?? 'no-response')
        : 'error';
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[RELAY ERROR] delivery failed | url=${webhookConfig.url} | status=${status} | error=${message}`,
      );
      throw err;
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
