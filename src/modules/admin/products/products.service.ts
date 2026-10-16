import { relayWebhook } from '../../webhook/relay-configuration';
import { QrRequestContext } from '../../../common/qr-request-context';
import { isDeepStrictEqual } from 'node:util';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookConfig } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { CacheService } from '../../../cache/cache.service';
import {
  decryptAES256GCM,
  generateApiKey,
  hashSHA256,
} from '../../../common/crypto.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { ensureEvolutionLink } from '../../../prisma/evolution-links';
import { lockProduct, lockProvider } from '../../provisioning/evolution-locks';
import {
  LegacyProduct,
  legacyProduct,
  legacyProductSelect,
} from '../../../prisma/legacy-selects';
import { AdapterResolverService } from '../../../providers/adapter-resolver.service';
import { ProviderContext } from '../../../providers/whatsapp-provider.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  SetWebhookConfigDto,
  SyncRelayResultDto,
  ToggleWebhookBulkResultDto,
} from './dto/webhook-config.dto';
import {
  SetInstanceDefaultProxyDto,
  SetInstanceDefaultWebhookDto,
} from './dto/instance-defaults.dto';

type SafeProduct = LegacyProduct;

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);
  private readonly encryptionKeyHex: string;
  private readonly hubBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
    private readonly adapterResolver: AdapterResolverService,
  ) {
    this.encryptionKeyHex = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    this.hubBaseUrl = this.config.get<string>(
      'HUB_BASE_URL',
      'http://localhost:3000',
    );
  }
  private validateBatchWebhook(enabled?: boolean, url?: string): void {
    if (enabled === true && !url) {
      throw new BadRequestException(
        'batchWebhookUrl é obrigatório quando batchWebhookEnabled é true',
      );
    }
  }

  async create(
    dto: CreateProductDto,
  ): Promise<SafeProduct & { apiKey: string }> {
    this.validateBatchWebhook(dto.batchWebhookEnabled, dto.batchWebhookUrl);

    const apiKey = generateApiKey();
    const apiKeyHash = hashSHA256(apiKey);

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
          data: {
            name: dto.name,
            slug: dto.slug,
            apiKeyHash,
            adapterType: dto.adapterType ?? 'evolution',
            origins: dto.origins ?? [],
            hubRelay: dto.hubRelay ?? false,
            vpsProviderId: dto.vpsProviderId ?? null,
            batchWebhookEnabled: dto.batchWebhookEnabled ?? false,
            batchWebhookUrl: dto.batchWebhookUrl ?? null,
          },
        });
        if (created.vpsProviderId) {
          await ensureEvolutionLink(
            tx,
            created.id,
            created.vpsProviderId,
            true,
          );
        }
        return created;
      });

      return { ...legacyProduct(product), apiKey };
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('A product with this slug already exists');
      }
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new UnprocessableEntityException(
          'vpsProviderId inválido: VpsProvider não encontrado',
        );
      }
      throw err;
    }
  }

  async findAll(): Promise<SafeProduct[]> {
    return this.prisma.product.findMany({
      select: legacyProductSelect,
    });
  }

  async findOne(id: string): Promise<SafeProduct> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: legacyProductSelect,
    });
    if (!product) throw new NotFoundException(`Produto ${id} não encontrado`);
    return product;
  }

  async update(id: string, dto: UpdateProductDto): Promise<SafeProduct> {
    this.validateBatchWebhook(dto.batchWebhookEnabled, dto.batchWebhookUrl);
    await this.assertExists(id);

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const current = await lockProduct(tx, id);
        for (const providerId of [
          ...new Set(
            [current.vpsProviderId, dto.vpsProviderId].filter(
              (value): value is string => !!value,
            ),
          ),
        ].sort()) {
          try {
            await lockProvider(tx, providerId);
          } catch (error) {
            if (error instanceof NotFoundException)
              throw new UnprocessableEntityException(
                'vpsProviderId inválido: VpsProvider não encontrado',
              );
            throw error;
          }
        }
        const product = await tx.product.update({
          where: { id },
          data: {
            name: dto.name,
            slug: dto.slug,
            adapterType: dto.adapterType,
            origins: dto.origins,
            hubRelay: dto.hubRelay,
            vpsProviderId: dto.vpsProviderId,
            isActive: dto.isActive,
            batchWebhookEnabled: dto.batchWebhookEnabled,
            batchWebhookUrl: dto.batchWebhookUrl,
            allocationRevision: { increment: 1 },
          },
        });
        if (product.vpsProviderId) {
          await ensureEvolutionLink(
            tx,
            product.id,
            product.vpsProviderId,
            product.allocationMode === 'legacy',
          );
        }
        return product;
      });

      await this.cache.del(`auth:${updated.apiKeyHash}`);
      return legacyProduct(updated);
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new UnprocessableEntityException(
          'vpsProviderId inválido: VpsProvider não encontrado',
        );
      }
      throw err;
    }
  }

  async deactivate(id: string): Promise<SafeProduct> {
    await this.assertExists(id);

    const updated = await this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });

    await this.cache.del(`auth:${updated.apiKeyHash}`);
    return legacyProduct(updated);
  }

  async rotateKey(id: string): Promise<SafeProduct & { apiKey: string }> {
    const current = await this.prisma.product.findUnique({
      where: { id },
      select: { apiKeyHash: true },
    });

    if (!current) throw new NotFoundException(`Produto ${id} não encontrado`);

    await this.cache.del(`auth:${current.apiKeyHash}`);

    const newApiKey = generateApiKey();
    const newApiKeyHash = hashSHA256(newApiKey);

    const updated = await this.prisma.product.update({
      where: { id },
      data: { apiKeyHash: newApiKeyHash },
    });

    return { ...legacyProduct(updated), apiKey: newApiKey };
  }

  private async assertExists(id: string): Promise<void> {
    const exists = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`Produto ${id} não encontrado`);
  }

  async toggleWebhookBulk(
    productId: string,
    enabled: boolean,
    instanceId?: string,
  ): Promise<ToggleWebhookBulkResultDto> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { adapterType: true },
    });

    if (!product) {
      throw new NotFoundException(`Produto ${productId} não encontrado`);
    }

    if (instanceId) {
      const exists = await this.prisma.instance.findFirst({
        where: { id: instanceId, productId, isActive: true },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(
          `Instância ${instanceId} não encontrada ou não pertence ao produto`,
        );
      }
    }

    const instances = await this.prisma.instance.findMany({
      where: instanceId
        ? { id: instanceId, productId, isActive: true }
        : { productId, isActive: true },
      include: { vpsProvider: true },
    });

    if (instances.length === 0) {
      return { total: 0, synced: 0, failed: 0, enabled };
    }

    let synced = 0;
    let failed = 0;
    const errors: { instanceName: string; error: string }[] = [];

    for (const instance of instances) {
      try {
        const ctx: ProviderContext = {
          providerUrl: instance.vpsProvider.providerUrl,
          providerApiKey: decryptAES256GCM(
            instance.vpsProvider.providerApiKey,
            this.encryptionKeyHex,
          ),
        };

        const adapter = this.adapterResolver.resolve(
          instance.vpsProvider.adapterType,
        );
        await adapter.toggleWebhook(ctx, instance.instanceName, { enabled });

        synced++;
      } catch (err) {
        let errorDetail: string;
        if (err instanceof HttpException) {
          errorDetail = JSON.stringify(err.getResponse());
        } else {
          errorDetail = err instanceof Error ? err.message : String(err);
        }
        this.logger.error(
          `[TOGGLE-WEBHOOK] falha na instância ${instance.instanceName}: ${errorDetail}`,
        );
        errors.push({
          instanceName: instance.instanceName,
          error: errorDetail,
        });
        failed++;
      }
    }

    return {
      total: instances.length,
      synced,
      failed,
      enabled,
      ...(errors.length > 0 && { errors }),
    };
  }

  async syncRelay(
    productId: string,
    instanceId?: string,
    execution?: QrRequestContext,
  ): Promise<SyncRelayResultDto> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { hubRelay: true, adapterType: true },
    });

    if (!product) {
      throw new NotFoundException(`Produto ${productId} não encontrado`);
    }

    // Se instanceId foi informado, valida existência antes de qualquer operação
    if (instanceId) {
      const exists = await this.prisma.instance.findFirst({
        where: { id: instanceId, productId, isActive: true },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(
          `Instância ${instanceId} não encontrada ou não pertence ao produto`,
        );
      }
    }

    const instances = await this.prisma.instance.findMany({
      where: instanceId
        ? { id: instanceId, productId, isActive: true }
        : { productId, isActive: true },
      include: { vpsProvider: true },
    });

    if (instances.length === 0) {
      return {
        total: 0,
        synced: 0,
        failed: 0,
        reason: 'Nenhuma instância ativa encontrada',
      };
    }

    // Determina a URL alvo: Hub quando relay ativo, URL do cliente quando inativo
    // Em ambos os casos, os eventos filtrados vêm do webhookConfig do produto
    const webhookConfig = await this.prisma.webhookConfig.findFirst({
      where: { productId, isActive: true },
    });

    let targetUrl: string;
    if (product.hubRelay) {
      targetUrl = `${this.hubBaseUrl}/internal/webhook/${product.adapterType}`;
    } else {
      if (!webhookConfig) {
        throw new BadRequestException(
          'Produto não possui WebhookConfig cadastrado — cadastre a URL do cliente antes de sincronizar com hubRelay=false',
        );
      }
      targetUrl = webhookConfig.url;
    }

    const targetEvents = webhookConfig?.events ?? [];

    let synced = 0;
    let failed = 0;
    const errors: { instanceName: string; error: string }[] = [];

    for (const instance of instances) {
      try {
        execution?.assertActive();
        const ctx: ProviderContext = {
          ...(execution ? { execution } : {}),
          providerUrl: instance.vpsProvider.providerUrl,
          providerApiKey: decryptAES256GCM(
            instance.vpsProvider.providerApiKey,
            this.encryptionKeyHex,
          ),
        };

        const adapter = this.adapterResolver.resolve(
          instance.vpsProvider.adapterType,
        );

        const existing = await adapter.findWebhook(ctx, instance.instanceName);
        // No remote configuration yet is valid; lookup failures still reach catch.
        const raw = (existing ?? {}) as unknown as Record<string, unknown>;
        const previous = (
          raw.webhook && typeof raw.webhook === 'object' ? raw.webhook : raw
        ) as Record<string, unknown>;
        const options = {
          url: targetUrl,
          enabled: true,
          events: targetEvents,
          byEvents: (previous.byEvents ??
            previous.webhookByEvents ??
            false) as boolean,
          base64: (previous.base64 ??
            previous.webhookBase64 ??
            true) as boolean,
          headers: previous.headers as Record<string, string> | undefined,
        };
        const webhook = product.hubRelay
          ? await relayWebhook(
              this.prisma,
              this.config,
              instance.vpsProviderId,
              options,
            )
          : options;
        // Durable preparation always reads before retrying a possibly effective
        // write. The legacy sync contract retains its original write behavior.
        const matches = Object.entries(webhook).every(([name, value]) =>
          isDeepStrictEqual(previous[name], value),
        );
        execution?.assertActive();
        if (!execution || !matches)
          await adapter.setWebhook(ctx, instance.instanceName, { webhook });

        synced++;
      } catch (err) {
        if (execution) {
          failed++;
          continue;
        }
        let errorDetail: string;
        if (err instanceof HttpException) {
          errorDetail = JSON.stringify(err.getResponse());
        } else {
          errorDetail = err instanceof Error ? err.message : String(err);
        }
        this.logger.error(
          `[SYNC-RELAY] falha na instância ${instance.instanceName}: ${errorDetail}`,
        );
        errors.push({
          instanceName: instance.instanceName,
          error: errorDetail,
        });
        failed++;
      }
    }

    return {
      total: instances.length,
      synced,
      failed,
      targetUrl,
      ...(errors.length > 0 && { errors }),
    };
  }

  async setWebhookConfig(
    productId: string,
    dto: SetWebhookConfigDto,
  ): Promise<WebhookConfig> {
    await this.assertExists(productId);

    const existing = await this.prisma.webhookConfig.findFirst({
      where: { productId },
    });

    if (existing) {
      return this.prisma.webhookConfig.update({
        where: { id: existing.id },
        data: {
          url: dto.url,
          secret: dto.secret,
          events: dto.events ?? [],
          isActive: true,
        },
      });
    }

    return this.prisma.webhookConfig.create({
      data: {
        productId,
        url: dto.url,
        secret: dto.secret,
        events: dto.events ?? [],
        isActive: true,
      },
    });
  }

  async getWebhookConfig(productId: string): Promise<WebhookConfig | null> {
    await this.assertExists(productId);
    return this.prisma.webhookConfig.findFirst({ where: { productId } });
  }

  async setInstanceDefaultWebhook(
    productId: string,
    dto: SetInstanceDefaultWebhookDto,
  ) {
    await this.assertExists(productId);
    const headersValue = dto.headers
      ? (dto.headers as Prisma.InputJsonValue)
      : Prisma.JsonNull;
    return this.prisma.productDefaultWebhook.upsert({
      where: { productId },
      update: {
        enabled: dto.enabled ?? true,
        url: dto.url,
        headers: headersValue,
        byEvents: dto.byEvents ?? false,
        base64: dto.base64 ?? false,
        events: dto.events ?? [],
      },
      create: {
        productId,
        enabled: dto.enabled ?? true,
        url: dto.url,
        headers: headersValue,
        byEvents: dto.byEvents ?? false,
        base64: dto.base64 ?? false,
        events: dto.events ?? [],
      },
    });
  }

  async getInstanceDefaultWebhook(productId: string) {
    await this.assertExists(productId);
    return this.prisma.productDefaultWebhook.findUnique({
      where: { productId },
    });
  }

  async deleteInstanceDefaultWebhook(productId: string): Promise<void> {
    await this.assertExists(productId);
    const existing = await this.prisma.productDefaultWebhook.findUnique({
      where: { productId },
    });
    if (!existing)
      throw new NotFoundException(
        'Configuração de webhook padrão não encontrada',
      );
    await this.prisma.productDefaultWebhook.delete({ where: { productId } });
  }

  async setInstanceDefaultProxy(
    productId: string,
    dto: SetInstanceDefaultProxyDto,
  ) {
    await this.assertExists(productId);
    return this.prisma.productDefaultProxy.upsert({
      where: { productId },
      update: {
        enabled: dto.enabled ?? true,
        host: dto.host,
        port: dto.port,
        protocol: dto.protocol,
        username: dto.username ?? null,
        password: dto.password ?? null,
      },
      create: {
        productId,
        enabled: dto.enabled ?? true,
        host: dto.host,
        port: dto.port,
        protocol: dto.protocol,
        username: dto.username ?? null,
        password: dto.password ?? null,
      },
    });
  }

  async getInstanceDefaultProxy(productId: string) {
    await this.assertExists(productId);
    return this.prisma.productDefaultProxy.findUnique({
      where: { productId },
    });
  }

  async deleteInstanceDefaultProxy(productId: string): Promise<void> {
    await this.assertExists(productId);
    const existing = await this.prisma.productDefaultProxy.findUnique({
      where: { productId },
    });
    if (!existing)
      throw new NotFoundException(
        'Configuração de proxy padrão não encontrada',
      );
    await this.prisma.productDefaultProxy.delete({ where: { productId } });
  }
}
