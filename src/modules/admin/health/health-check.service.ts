import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VpsProvider, VpsServer } from '@prisma/client';
import axios from 'axios';
import { decryptAES256GCM } from '../../../common/crypto.util';
import { CacheService } from '../../../cache/cache.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface ProviderHealthEntry {
  providerId: string;
  label: string;
  adapterType: string;
  providerUrl: string;
  isHealthy: boolean;
  lastHealthAt: Date | null;
  lastCheck: {
    status: string;
    responseMs: number;
    errorMsg: string | null;
    checkedAt: Date;
  } | null;
}

export interface VpsHealthStatus {
  vpsId: string;
  label: string;
  subdomain: string;
  isHealthy: boolean;
  lastHealthAt: Date | null;
  lastCheck: {
    status: string;
    responseMs: number;
    errorMsg: string | null;
    checkedAt: Date;
  } | null;
  systemMetrics?: Record<string, unknown>;
  providers: ProviderHealthEntry[];
}

const UNHEALTHY_THRESHOLD = 3;
const HEALTH_REDIS_TTL = 120;
const PROVIDER_HEALTH_DETAIL_TTL = 30;

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
    const providers = await this.prisma.vpsProvider.findMany({
      where: { isActive: true },
      include: { vps: true },
    });

    await Promise.allSettled(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      providers.map((p) => this.checkProvider(p as any)),
    );

    const vpsList = await this.prisma.vpsServer.findMany({
      where: { isActive: true, monitorUrl: { not: null } },
    });

    await Promise.allSettled(
      vpsList.map((vps) => this.collectVpsMetrics(vps)),
    );
  }

  async checkProvider(
    provider: VpsProvider & {
      vps: { monitorUrl?: string | null; monitorApiKey?: string | null };
    },
  ): Promise<void> {
    const encryptionKey = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    const providerApiKey = decryptAES256GCM(provider.providerApiKey, encryptionKey);

    const start = Date.now();
    let status = 'healthy';
    let errorMsg: string | undefined;

    try {
      await axios.get(`${provider.providerUrl}/`, {
        headers: { apikey: providerApiKey },
        timeout: 5000,
      });
    } catch (err) {
      status = 'unhealthy';
      errorMsg = err instanceof Error ? err.message : String(err);
    }

    const responseMs = Date.now() - start;

    await this.prisma.healthCheck.create({
      data: {
        vpsProviderId: provider.id,
        status,
        responseMs,
        errorMsg: errorMsg ?? null,
      },
    });



    if (status === 'unhealthy') {
      const failures = (this.consecutiveFailures.get(provider.id) ?? 0) + 1;
      this.consecutiveFailures.set(provider.id, failures);

      if (failures >= UNHEALTHY_THRESHOLD && provider.isHealthy) {
        await this.prisma.vpsProvider.update({
          where: { id: provider.id },
          data: { isHealthy: false, lastHealthAt: new Date() },
        });
        await this.cache.setWithTTL(
          `provider:health:${provider.id}`,
          { isHealthy: false },
          HEALTH_REDIS_TTL,
        );
        this.logger.warn(
          `Provider ${provider.label} (${provider.id}) marcado como unhealthy apos ${failures} falhas consecutivas`,
        );
      }
    } else {
      this.consecutiveFailures.set(provider.id, 0);

      if (!provider.isHealthy) {
        await this.prisma.vpsProvider.update({
          where: { id: provider.id },
          data: { isHealthy: true, lastHealthAt: new Date() },
        });
        await this.cache.setWithTTL(
          `provider:health:${provider.id}`,
          { isHealthy: true },
          HEALTH_REDIS_TTL,
        );
        this.logger.log(
          `Provider ${provider.label} (${provider.id}) recuperado e marcado como healthy`,
        );
      }
    }
  }

  async getHealthStatus(): Promise<VpsHealthStatus[]> {
    const vpsList = await this.prisma.vpsServer.findMany({
      where: { isActive: true },
      include: {
        providers: {
          where: { isActive: true },
          include: {
            healthChecks: {
              orderBy: { checkedAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    const results: VpsHealthStatus[] = [];

    for (const vps of vpsList) {
      const providerEntries: ProviderHealthEntry[] = vps.providers.map((provider) => ({
        providerId: provider.id,
        label: provider.label,
        adapterType: provider.adapterType,
        providerUrl: provider.providerUrl,
        isHealthy: provider.isHealthy,
        lastHealthAt: provider.lastHealthAt,
        lastCheck: provider.healthChecks[0]
          ? {
              status: provider.healthChecks[0].status,
              responseMs: provider.healthChecks[0].responseMs,
              errorMsg: provider.healthChecks[0].errorMsg,
              checkedAt: provider.healthChecks[0].checkedAt,
            }
          : null,
      }));

      const vpsIsHealthy = providerEntries.length === 0
        ? true
        : providerEntries.every((p) => p.isHealthy);

      const allLastHealthAt = providerEntries
        .map((p) => p.lastHealthAt)
        .filter((d): d is Date => d !== null);
      const vpsLastHealthAt = allLastHealthAt.length > 0
        ? allLastHealthAt.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
        : null;

      const allLastChecks = providerEntries
        .map((p) => p.lastCheck)
        .filter((c): c is NonNullable<typeof c> => c !== null);
      const vpsLastCheck = allLastChecks.length > 0
        ? allLastChecks.sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime())[0]
        : null;

      const entry: VpsHealthStatus = {
        vpsId: vps.id,
        label: vps.label,
        subdomain: vps.subdomain,
        isHealthy: vpsIsHealthy,
        lastHealthAt: vpsLastHealthAt,
        lastCheck: vpsLastCheck,
        providers: providerEntries,
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

  async getVpsHealthStatus(providerId: string): Promise<ProviderHealthEntry> {
    const cacheKey = `provider:health-detail:${providerId}`;
    const cached = await this.cache.get<ProviderHealthEntry>(cacheKey);
    if (cached) return cached;

    const provider = await this.prisma.vpsProvider.findFirst({
      where: { id: providerId, isActive: true },
      include: {
        healthChecks: {
          orderBy: { checkedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!provider) {
      throw new NotFoundException(`Provider ${providerId} nao encontrado`);
    }

    const entry: ProviderHealthEntry = {
      providerId: provider.id,
      label: provider.label,
      adapterType: provider.adapterType,
      providerUrl: provider.providerUrl,
      isHealthy: provider.isHealthy,
      lastHealthAt: provider.lastHealthAt,
      lastCheck: provider.healthChecks[0]
        ? {
            status: provider.healthChecks[0].status,
            responseMs: provider.healthChecks[0].responseMs,
            errorMsg: provider.healthChecks[0].errorMsg,
            checkedAt: provider.healthChecks[0].checkedAt,
          }
        : null,
    };

    await this.cache.setWithTTL(cacheKey, entry, PROVIDER_HEALTH_DETAIL_TTL);

    return entry;
  }

  private async collectVpsMetrics(vps: VpsServer): Promise<void> {
    if (!vps.monitorUrl) return;

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
      // silently ignore
    }
  }
}
