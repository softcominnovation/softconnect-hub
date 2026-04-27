import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthCachePayload } from '../auth/apikey.guard';
import { decryptAES256GCM } from '../common/crypto.util';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdapterResolverService } from '../providers/adapter-resolver.service';
import {
  ConnectInstanceDto,
  ConnectionStateDto,
  CreateInstanceDto,
  InstanceCreatedDto,
  InstanceDto,
  ProviderContext,
} from '../providers/whatsapp-provider.interface';
import { InstanceResolverService } from '../resolver/instance.resolver';

@Injectable()
export class InstanceService {
  private readonly encryptionKeyHex: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly adapterResolver: AdapterResolverService,
    private readonly instanceResolver: InstanceResolverService,
    private readonly config: ConfigService,
  ) {
    this.encryptionKeyHex = this.config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  async createInstance(
    product: AuthCachePayload,
    dto: CreateInstanceDto,
  ): Promise<InstanceCreatedDto> {
    if (!product.vpsId) {
      throw new BadRequestException('Produto sem VPS associada');
    }

    const vps = await this.prisma.vpsServer.findUnique({
      where: { id: product.vpsId, isActive: true },
    });

    if (!vps) throw new NotFoundException('VPS não encontrada ou inativa');

    if (vps.adapterType !== product.adapterType) {
      throw new BadRequestException(
        `Incompatibilidade de adapter: produto usa "${product.adapterType}", VPS usa "${vps.adapterType}"`,
      );
    }

    const ctx: ProviderContext = {
      providerUrl: vps.providerUrl,
      providerApiKey: decryptAES256GCM(
        vps.providerApiKey,
        this.encryptionKeyHex,
      ),
    };

    const adapter = this.adapterResolver.resolve(product.adapterType);
    const result = await adapter.createInstance(ctx, dto);

    await this.prisma.instance.create({
      data: {
        productId: product.productId,
        vpsId: vps.id,
        instanceName: dto.instanceName,
        instanceToken: dto.token,
        hubToken: `hub_${product.productId}_${dto.instanceName}`,
        status: 'disconnected',
      },
    });

    await this.cache.del(`instance:${product.productId}:${dto.instanceName}`);

    return result;
  }

  async fetchInstances(product: AuthCachePayload): Promise<InstanceDto[]> {
    if (!product.vpsId) {
      throw new BadRequestException('Produto sem VPS associada');
    }

    const vps = await this.prisma.vpsServer.findUnique({
      where: { id: product.vpsId, isActive: true },
    });

    if (!vps) throw new NotFoundException('VPS não encontrada ou inativa');

    const ctx: ProviderContext = {
      providerUrl: vps.providerUrl,
      providerApiKey: decryptAES256GCM(
        vps.providerApiKey,
        this.encryptionKeyHex,
      ),
    };

    const adapter = this.adapterResolver.resolve(product.adapterType);
    return adapter.fetchInstances(ctx);
  }

  async connectInstance(
    product: AuthCachePayload,
    instanceName: string,
  ): Promise<ConnectInstanceDto> {
    const resolved = await this.instanceResolver.resolve(
      product.productId,
      instanceName,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    return adapter.connectInstance(ctx, instanceName);
  }

  async getConnectionState(
    product: AuthCachePayload,
    instanceName: string,
  ): Promise<ConnectionStateDto> {
    const resolved = await this.instanceResolver.resolve(
      product.productId,
      instanceName,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    return adapter.getConnectionState(ctx, instanceName);
  }

  async restartInstance(
    product: AuthCachePayload,
    instanceName: string,
  ): Promise<void> {
    const resolved = await this.instanceResolver.resolve(
      product.productId,
      instanceName,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    return adapter.restartInstance(ctx, instanceName);
  }

  async logoutInstance(
    product: AuthCachePayload,
    instanceName: string,
  ): Promise<void> {
    const resolved = await this.instanceResolver.resolve(
      product.productId,
      instanceName,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    await adapter.logoutInstance(ctx, instanceName);
    await this.cache.del(`instance:${product.productId}:${instanceName}`);
  }

  async deleteInstance(
    product: AuthCachePayload,
    instanceName: string,
  ): Promise<void> {
    const resolved = await this.instanceResolver.resolve(
      product.productId,
      instanceName,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    await adapter.deleteInstance(ctx, instanceName);

    await this.prisma.instance.updateMany({
      where: { productId: product.productId, instanceName },
      data: { isActive: false },
    });

    await this.cache.del(`instance:${product.productId}:${instanceName}`);
  }
}
