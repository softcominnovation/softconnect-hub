import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VpsServer } from '@prisma/client';
import axios from 'axios';
import { decryptAES256GCM } from '../../../common/crypto.util';
import { CacheService } from '../../../cache/cache.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface VpsHealthStatus {
  vpsId: string;
  label: string;
  subdomain: string;
  isHealthy: boolean;
  lastHealthAt: Date | null;
  systemMetrics?: Record<string, unknown>;
  lastCheck: {
    status: string;
    responseMs: number;
    errorMsg: string | null;
    checkedAt: Date;
  } | null;
}

const UNHEALTHY_THRESHOLD = 3;
const HEALTH_REDIS_TTL = 120;
const VPS_HEALTH_DETAIL_TTL = 30;

@Injectable()
export class HealthCheckService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthCheckService.name);
  private cronTimer?: ReturnType<typeof setInterval>;
  private readonly consecutiveFailures = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.cronTimer = setInterval(() => {
      void this.runChecks();
    }, 60_000);
  }

  onModuleDestroy() {
    if (this.cronTimer) clearInterval(this.cronTimer);
  }

  async runChecks(): Promise<void> {
    const servers = await this.prisma.vpsServer.findMany({
      where: { isActive: true },
    });

    await Promise.allSettled(servers.map((vps) => this.checkVps(vps)));
  }

  async checkVps(vps: VpsServer): Promise<void> {
    const encryptionKey = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    const providerApiKey = decryptAES256GCM(vps.providerApiKey, encryptionKey);

    const start = Date.now();
    let status = 'healthy';
    let errorMsg: string | undefined;

    try {
      await axios.get(`${vps.providerUrl}/`, {
        headers: { apikey: providerApiKey },
        timeout: 5000,
      });
    } catch (err) {
      status = 'unhealthy';
      errorMsg = err instanceof Error ? err.message : String(err);
    }

    const responseMs = Date.now() - start;

    await this.prisma.healthCheck.create({
      data: { vpsId: vps.id, status, responseMs, errorMsg: errorMsg ?? null },
    });

    if (vps.monitorUrl) {
      void this.collectMetrics(vps);
    }

    if (status === 'unhealthy') {
      const failures = (this.consecutiveFailures.get(vps.id) ?? 0) + 1;
      this.consecutiveFailures.set(vps.id, failures);

      if (failures >= UNHEALTHY_THRESHOLD && vps.isHealthy) {
        await this.prisma.vpsServer.update({
          where: { id: vps.id },
          data: { isHealthy: false, lastHealthAt: new Date() },
        });
        await this.cache.setWithTTL(
          `vps:health:${vps.id}`,
          { isHealthy: false },
          HEALTH_REDIS_TTL,
        );
        this.logger.warn(
          `VPS ${vps.label} (${vps.id}) marcada como unhealthy após ${failures} falhas consecutivas`,
        );
      }
    } else {
      this.consecutiveFailures.set(vps.id, 0);

      if (!vps.isHealthy) {
        await this.prisma.vpsServer.update({
          where: { id: vps.id },
          data: { isHealthy: true, lastHealthAt: new Date() },
        });
        await this.cache.setWithTTL(
          `vps:health:${vps.id}`,
          { isHealthy: true },
          HEALTH_REDIS_TTL,
        );
        this.logger.log(
          `VPS ${vps.label} (${vps.id}) recuperada e marcada como healthy`,
        );
      }
    }
  }

  async getHealthStatus(): Promise<VpsHealthStatus[]> {
    const servers = await this.prisma.vpsServer.findMany({
      where: { isActive: true },
      include: {
        healthChecks: {
          orderBy: { checkedAt: 'desc' },
          take: 1,
        },
      },
    });

    const results: VpsHealthStatus[] = [];

    for (const vps of servers) {
      const entry: VpsHealthStatus = {
        vpsId: vps.id,
        label: vps.label,
        subdomain: vps.subdomain,
        isHealthy: vps.isHealthy,
        lastHealthAt: vps.lastHealthAt,
        lastCheck: vps.healthChecks[0]
          ? {
              status: vps.healthChecks[0].status,
              responseMs: vps.healthChecks[0].responseMs,
              errorMsg: vps.healthChecks[0].errorMsg,
              checkedAt: vps.healthChecks[0].checkedAt,
            }
          : null,
      };

      if (vps.monitorUrl) {
        const metrics = await this.cache.get<Record<string, unknown>>(
          `vps:metrics:${vps.id}`,
        );
        if (metrics) entry.systemMetrics = metrics;
      }

      results.push(entry);
    }

    return results;
  }

  async getVpsHealthStatus(vpsId: string): Promise<VpsHealthStatus> {
    const cacheKey = `vps:health-detail:${vpsId}`;
    const cached = await this.cache.get<VpsHealthStatus>(cacheKey);
    if (cached) return cached;

    const vps = await this.prisma.vpsServer.findFirst({
      where: { id: vpsId, isActive: true },
      include: {
        healthChecks: {
          orderBy: { checkedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!vps) {
      throw new NotFoundException(`VPS ${vpsId} não encontrada`);
    }

    const entry: VpsHealthStatus = {
      vpsId: vps.id,
      label: vps.label,
      subdomain: vps.subdomain,
      isHealthy: vps.isHealthy,
      lastHealthAt: vps.lastHealthAt,
      lastCheck: vps.healthChecks[0]
        ? {
            status: vps.healthChecks[0].status,
            responseMs: vps.healthChecks[0].responseMs,
            errorMsg: vps.healthChecks[0].errorMsg,
            checkedAt: vps.healthChecks[0].checkedAt,
          }
        : null,
    };

    if (vps.monitorUrl) {
      const metrics = await this.cache.get<Record<string, unknown>>(
        `vps:metrics:${vps.id}`,
      );
      if (metrics) entry.systemMetrics = metrics;
    }

    await this.cache.setWithTTL(cacheKey, entry, VPS_HEALTH_DETAIL_TTL);

    return entry;
  }

  private async collectMetrics(vps: VpsServer): Promise<void> {
    const encryptionKey = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    const apiKey = vps.monitorApiKey
      ? decryptAES256GCM(vps.monitorApiKey, encryptionKey)
      : undefined;

    try {
      const response = await axios.get<Record<string, unknown>>(
        `${vps.monitorUrl}/status`,
        {
          headers: apiKey ? { 'x-api-key': apiKey } : {},
          timeout: 5000,
        },
      );

      const metrics: Record<string, unknown> = {
        ...response.data,
        collectedAt: new Date().toISOString(),
      };

      await this.cache.setWithTTL(`vps:metrics:${vps.id}`, metrics, 90);
    } catch {
      // silently ignore — monitor is optional
    }
  }
}
