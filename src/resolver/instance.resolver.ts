import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptAES256GCM } from '../common/crypto.util';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/config.schema';

export interface ResolvedInstance {
  providerUrl: string;
  providerApiKey: string;
  vpsId: string;
  instanceId: string;
  instanceName: string;
  adapterType: string;
}

@Injectable()
export class InstanceResolverService {
  private readonly logger = new Logger(InstanceResolverService.name);
  private readonly encryptionKeyHex: string;
  private readonly cacheDebug: boolean;

  constructor(
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    this.encryptionKeyHex = this.config.getOrThrow('ENCRYPTION_KEY');
    this.cacheDebug = this.config.get('CACHE_DEBUG', { infer: true }) ?? false;
  }

  async resolve(
    productId: string,
    instanceName: string,
  ): Promise<ResolvedInstance> {
    const cacheKey = `instance:${productId}:${instanceName}`;

    const t0 = this.cacheDebug ? Date.now() : 0;
    const cached = await this.cache.get<ResolvedInstance>(cacheKey);
    if (this.cacheDebug) {
      const elapsed = Date.now() - t0;
      if (cached) {
        this.logger.log(`[CACHE HIT] key=${cacheKey} elapsed=${elapsed}ms`);
      } else {
        this.logger.log(`[CACHE MISS] key=${cacheKey} elapsed=${elapsed}ms — querying DB`);
      }
    }

    if (cached) return cached;

    const instance = await this.prisma.instance.findFirst({
      where: { productId, instanceName, isActive: true },
      include: {
        vps: true,
        product: true,
      },
    });

    if (!instance) {
      throw new NotFoundException(`Instância "${instanceName}" não encontrada`);
    }

    const resolved: ResolvedInstance = {
      providerUrl: instance.vps.providerUrl,
      providerApiKey: decryptAES256GCM(
        instance.vps.providerApiKey,
        this.encryptionKeyHex,
      ),
      vpsId: instance.vpsId,
      instanceId: instance.id,
      instanceName: instance.instanceName,
      adapterType: instance.product.adapterType,
    };

    await this.cache.setWithTTL(`instance:${instance.id}`, resolved, 300);

    if (this.cacheDebug) {
      this.logger.log(`[CACHE SET] key=instance:${instance.id} ttl=300s`);
    }

    return resolved;
  }

  async resolveById(
    productId: string,
    instanceId: string,
  ): Promise<ResolvedInstance> {
    const cacheKey = `instance:${instanceId}`;

    const t0 = this.cacheDebug ? Date.now() : 0;
    const cached = await this.cache.get<ResolvedInstance>(cacheKey);
    if (this.cacheDebug) {
      const elapsed = Date.now() - t0;
      if (cached) {
        this.logger.log(`[CACHE HIT] key=${cacheKey} elapsed=${elapsed}ms`);
      } else {
        this.logger.log(`[CACHE MISS] key=${cacheKey} elapsed=${elapsed}ms — querying DB`);
      }
    }

    if (cached) return cached;

    const instance = await this.prisma.instance.findFirst({
      where: { id: instanceId, productId, isActive: true },
      include: {
        vps: true,
        product: true,
      },
    });

    if (!instance) {
      throw new NotFoundException(`Instância "${instanceId}" não encontrada`);
    }

    const resolved: ResolvedInstance = {
      providerUrl: instance.vps.providerUrl,
      providerApiKey: decryptAES256GCM(
        instance.vps.providerApiKey,
        this.encryptionKeyHex,
      ),
      vpsId: instance.vpsId,
      instanceId: instance.id,
      instanceName: instance.instanceName,
      adapterType: instance.product.adapterType,
    };

    await this.cache.setWithTTL(cacheKey, resolved, 300);

    if (this.cacheDebug) {
      this.logger.log(`[CACHE SET] key=${cacheKey} ttl=300s`);
    }

    return resolved;
  }
}
