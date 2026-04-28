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
import { PrismaService } from '../prisma/prisma.service';

export interface RelayJobPayload {
  adapterType: string;
  instanceName: string;
  body: unknown;
}

@Injectable()
export class RelayWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RelayWorker.name);
  private worker!: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

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
      'relay',
      async (job) => {
        const payload = job.data as RelayJobPayload;
        await this.relay(payload);
      },
      { connection },
    );

    this.worker.on('error', (err) => {
      this.logger.error(`RelayWorker error: ${String(err)}`);
    });
  }

  private async relay(payload: RelayJobPayload): Promise<void> {
    const instance = await this.prisma.instance.findFirst({
      where: { instanceName: payload.instanceName, isActive: true },
      select: { productId: true },
    });

    if (!instance) {
      this.logger.warn(
        `Relay: nenhuma instância encontrada para "${payload.instanceName}"`,
      );
      return;
    }

    const webhookConfig = await this.prisma.webhookConfig.findFirst({
      where: { productId: instance.productId, isActive: true },
    });

    if (!webhookConfig) {
      this.logger.warn(
        `Relay: nenhuma configuração de webhook para produto "${instance.productId}"`,
      );
      return;
    }

    const bodyStr = JSON.stringify(payload.body);
    const signature = createHmac('sha256', webhookConfig.secret)
      .update(bodyStr)
      .digest('hex');

    await axios.post(webhookConfig.url, payload.body, {
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature': `sha256=${signature}`,
      },
      timeout: 10000,
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
