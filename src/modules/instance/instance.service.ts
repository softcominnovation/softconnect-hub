import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthCachePayload } from '../../auth/apikey.guard';
import { decryptAES256GCM } from '../../common/crypto.util';
import { CacheService } from '../../cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import {
  ConnectInstanceDto,
  ConnectionStateDto,
  CreateInstanceDto,
  InstanceCreatedDto,
  InstanceDto,
  ProviderContext,
} from '../../providers/whatsapp-provider.interface';
import { InstanceResolverService } from '../../resolver/instance.resolver';

@Injectable()
export class InstanceService {
  private readonly logger = new Logger(InstanceService.name);
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
  ): Promise<InstanceCreatedDto & { id: string }> {
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

    const instance = await this.prisma.instance.create({
      data: {
        productId: product.productId,
        vpsId: vps.id,
        instanceName: dto.instanceName,
        providerInstanceId: result.instanceId ?? null,
        instanceToken: dto.token,
        hubToken: `hub_${product.productId}_${dto.instanceName}`,
        status: 'disconnected',
      },
    });

    return { ...result, id: instance.id };
  }

  async listInstances(product: AuthCachePayload): Promise<InstanceDto[]> {
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

  async fetchInstance(
    product: AuthCachePayload,
    instanceId: string,
  ): Promise<InstanceDto> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    return adapter.fetchInstance(ctx, resolved.instanceName);
  }

  async connectInstance(
    product: AuthCachePayload,
    instanceId: string,
  ): Promise<ConnectInstanceDto> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    return adapter.connectInstance(ctx, resolved.instanceName);
  }

  async getConnectionState(
    product: AuthCachePayload,
    instanceId: string,
  ): Promise<ConnectionStateDto> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    return adapter.getConnectionState(ctx, resolved.instanceName);
  }

  async restartInstance(
    product: AuthCachePayload,
    instanceId: string,
  ): Promise<void> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    return adapter.restartInstance(ctx, resolved.instanceName);
  }

  async logoutInstance(
    product: AuthCachePayload,
    instanceId: string,
  ): Promise<void> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    await adapter.logoutInstance(ctx, resolved.instanceName);
    await this.cache.del(`instance:${instanceId}`);
  }

  async deleteInstance(
    product: AuthCachePayload,
    instanceId: string,
  ): Promise<void> {
    const instance = await this.prisma.instance.findFirst({
      where: { id: instanceId, productId: product.productId },
      include: { vps: true, product: true },
    });

    if (!instance) {
      throw new NotFoundException(`Instância "${instanceId}" não encontrada`);
    }

    const ctx: ProviderContext = {
      providerUrl: instance.vps.providerUrl,
      providerApiKey: decryptAES256GCM(
        instance.vps.providerApiKey,
        this.encryptionKeyHex,
      ),
    };
    const adapter = this.adapterResolver.resolve(instance.product.adapterType);

    try {
      await adapter.deleteInstance(ctx, instance.instanceName);
    } catch (err) {
      this.logger.warn(
        `[delete] provider error for instanceId=${instanceId} — continuing with DB soft-delete. error=${(err as Error).message}`,
      );
    }

    const deleted = await this.prisma.instance.deleteMany({
      where: { id: instanceId, productId: product.productId },
    });

    this.logger.log(
      `[delete] instanceId=${instanceId} productId=${product.productId} rowsDeleted=${deleted.count}`,
    );

    await this.cache.del(`instance:${instanceId}`);
  }
}
