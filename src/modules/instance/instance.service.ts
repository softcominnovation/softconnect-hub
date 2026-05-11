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
  ): Promise<InstanceCreatedDto & { id: string } & Record<string, unknown>> {
    if (!product.vpsProviderId) {
      throw new BadRequestException('Produto sem VpsProvider associado');
    }

    const provider = await this.prisma.vpsProvider.findUnique({
      where: { id: product.vpsProviderId, isActive: true },
    });

    if (!provider)
      throw new NotFoundException('VpsProvider nao encontrado ou inativo');

    if (provider.adapterType !== product.adapterType) {
      throw new BadRequestException(
        `Incompatibilidade de adapter: produto usa "${product.adapterType}", VPS usa "${provider.adapterType}"`,
      );
    }

    const ctx: ProviderContext = {
      providerUrl: provider.providerUrl,
      providerApiKey: decryptAES256GCM(
        provider.providerApiKey,
        this.encryptionKeyHex,
      ),
    };

    const adapter = this.adapterResolver.resolve(product.adapterType);
    const result = await adapter.createInstance(ctx, dto);

    const instance = await this.prisma.instance.create({
      data: {
        productId: product.productId,
        vpsProviderId: provider.id,
        instanceName: dto.instanceName,
        providerInstanceId: result.instanceId ?? null,
        instanceToken: dto.token,
        hubToken: `hub_${product.productId}_${dto.instanceName}`,
        status: 'disconnected',
      },
    });

    const response: InstanceCreatedDto & { id: string } & Record<
        string,
        unknown
      > = {
      ...result,
      id: instance.id,
    };

    if (adapter.applyInstanceDefaults) {
      try {
        const [defaultWebhook, defaultProxy] = await Promise.all([
          this.prisma.productDefaultWebhook.findUnique({
            where: { productId: product.productId },
          }),
          this.prisma.productDefaultProxy.findUnique({
            where: { productId: product.productId },
          }),
        ]);

        const hasDefaults = defaultWebhook || defaultProxy;

        if (hasDefaults) {
          const applied = await adapter.applyInstanceDefaults(
            ctx,
            dto.instanceName,
            {
              webhook: defaultWebhook
                ? {
                    enabled: defaultWebhook.enabled,
                    url: defaultWebhook.url,
                    headers: defaultWebhook.headers as
                      | Record<string, string>
                      | undefined,
                    byEvents: defaultWebhook.byEvents,
                    base64: defaultWebhook.base64,
                    events: defaultWebhook.events,
                  }
                : undefined,
              proxy: defaultProxy
                ? {
                    enabled: defaultProxy.enabled,
                    host: defaultProxy.host,
                    port: defaultProxy.port,
                    protocol: defaultProxy.protocol,
                    username: defaultProxy.username ?? undefined,
                    password: defaultProxy.password ?? undefined,
                  }
                : undefined,
            },
          );

          if (applied.webhook !== undefined) response.webhook = applied.webhook;
          if (applied.proxy !== undefined) response.proxy = applied.proxy;
        }
      } catch (err) {
        this.logger.warn(
          `[createInstance] falha ao aplicar defaults para productId=${product.productId} instanceName=${dto.instanceName}: ${(err as Error).message}`,
        );
      }
    }

    return response;
  }

  async listInstances(product: AuthCachePayload): Promise<InstanceDto[]> {
    if (!product.vpsProviderId) {
      throw new BadRequestException('Produto sem VpsProvider associado');
    }

    const provider = await this.prisma.vpsProvider.findUnique({
      where: { id: product.vpsProviderId, isActive: true },
    });

    if (!provider)
      throw new NotFoundException('VpsProvider nao encontrado ou inativo');

    const ctx: ProviderContext = {
      providerUrl: provider.providerUrl,
      providerApiKey: decryptAES256GCM(
        provider.providerApiKey,
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
      include: { vpsProvider: true, product: true },
    });

    if (!instance) {
      throw new NotFoundException(`Instância "${instanceId}" não encontrada`);
    }

    const ctx: ProviderContext = {
      providerUrl: instance.vpsProvider.providerUrl,
      providerApiKey: decryptAES256GCM(
        instance.vpsProvider.providerApiKey,
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
