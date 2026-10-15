import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptAES256GCM } from '../common/crypto.util';
import { CacheService } from '../cache/cache.service';
import { instanceCacheKey } from '../cache/instance-cache';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/config.schema';

export interface ResolvedInstance {
  providerUrl: string;
  providerApiKey: string;
  vpsProviderId: string;
  instanceId: string;
  instanceName: string;
  adapterType: string;
  productId: string;
  providerInstanceId: string | null;
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

  resolve(productId: string, instanceName: string): Promise<ResolvedInstance> {
    return this.lookup(productId, 'name', instanceName);
  }

  resolveById(
    productId: string,
    instanceId: string,
  ): Promise<ResolvedInstance> {
    return this.lookup(productId, 'id', instanceId);
  }

  private async lookup(
    productId: string,
    kind: 'id' | 'name',
    identifier: string,
  ): Promise<ResolvedInstance> {
    const key = instanceCacheKey(productId, kind, identifier);
    const cached = await this.cache.get<ResolvedInstance>(key);
    const hit =
      cached?.productId === productId &&
      !!cached.instanceId &&
      !!cached.vpsProviderId &&
      (kind === 'name'
        ? cached.instanceName === identifier
        : cached.instanceId === identifier ||
          cached.providerInstanceId === identifier);
    if (this.cacheDebug)
      this.logger.log(`[CACHE ${hit ? 'HIT' : 'MISS'}] key=${key}`);
    if (hit) return cached;

    const instances = await this.prisma.instance.findMany({
      where: {
        productId,
        isActive: true,
        ...(kind === 'name'
          ? { instanceName: identifier }
          : { OR: [{ id: identifier }, { providerInstanceId: identifier }] }),
      },
      include: { vpsProvider: true, product: true },
      take: 2,
    });
    if (instances.length > 1)
      throw new ConflictException('Identificador de instância ambíguo');
    const instance = instances[0];
    if (!instance || instance.productId !== productId) {
      throw new NotFoundException(`Instância "${identifier}" não encontrada`);
    }
    const resolved: ResolvedInstance = {
      productId,
      providerInstanceId: instance.providerInstanceId,
      providerUrl: instance.vpsProvider.providerUrl,
      providerApiKey: decryptAES256GCM(
        instance.vpsProvider.providerApiKey,
        this.encryptionKeyHex,
      ),
      vpsProviderId: instance.vpsProviderId,
      instanceId: instance.id,
      instanceName: instance.instanceName,
      adapterType: instance.vpsProvider.adapterType,
    };
    // Cache only the identifier actually checked for ambiguity, never unchecked aliases.
    await this.cache.setWithTTL(key, resolved, 300);
    if (this.cacheDebug) this.logger.log(`[CACHE SET] key=${key} ttl=300s`);
    return resolved;
  }
}
