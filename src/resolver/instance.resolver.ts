import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptAES256GCM } from '../common/crypto.util';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolvedInstance {
  providerUrl: string;
  providerApiKey: string;
  vpsId: string;
  instanceId: string;
  adapterType: string;
}

@Injectable()
export class InstanceResolverService {
  private readonly encryptionKeyHex: string;

  constructor(
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.encryptionKeyHex = this.config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  async resolve(
    productId: string,
    instanceName: string,
  ): Promise<ResolvedInstance> {
    const cacheKey = `instance:${productId}:${instanceName}`;
    const cached = await this.cache.get<ResolvedInstance>(cacheKey);
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
      adapterType: instance.product.adapterType,
    };

    await this.cache.setWithTTL(cacheKey, resolved, 300);
    return resolved;
  }
}
