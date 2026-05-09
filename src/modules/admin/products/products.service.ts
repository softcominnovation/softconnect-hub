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
import { Product, WebhookConfig } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { CacheService } from '../../../cache/cache.service';
import {
  decryptAES256GCM,
  generateApiKey,
  hashSHA256,
} from '../../../common/crypto.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdapterResolverService } from '../../../providers/adapter-resolver.service';
import { ProviderContext } from '../../../providers/whatsapp-provider.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  SetWebhookConfigDto,
  SyncRelayResultDto,
  ToggleWebhookBulkResultDto,
} from './dto/webhook-config.dto';

type SafeProduct = Omit<Product, 'apiKeyHash'>;

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
      const product = await this.prisma.product.create({
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

      return { ...this.stripHash(product), apiKey };
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
      select: {
        id: true,
        name: true,
        slug: true,
        adapterType: true,
        origins: true,
        hubRelay: true,
        batchWebhookEnabled: true,
        batchWebhookUrl: true,
        isActive: true,
        vpsProviderId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(id: string): Promise<SafeProduct> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        adapterType: true,
        origins: true,
        hubRelay: true,
        batchWebhookEnabled: true,
        batchWebhookUrl: true,
        isActive: true,
        vpsProviderId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!product) throw new NotFoundException(`Produto ${id} não encontrado`);
    return product;
  }

  async update(id: string, dto: UpdateProductDto): Promise<SafeProduct> {
    this.validateBatchWebhook(dto.batchWebhookEnabled, dto.batchWebhookUrl);
    await this.assertExists(id);

    try {
      const updated = await this.prisma.product.update({
        where: { id },
        data: dto,
      });

      await this.cache.del(`auth:${updated.apiKeyHash}`);
      return this.stripHash(updated);
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
    return this.stripHash(updated);
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

    return { ...this.stripHash(updated), apiKey: newApiKey };
  }

  private stripHash(product: Product): SafeProduct {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { apiKeyHash, ...safe } = product;
    return safe;
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

        const adapter = this.adapterResolver.resolve(product.adapterType);
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
        const ctx: ProviderContext = {
          providerUrl: instance.vpsProvider.providerUrl,
          providerApiKey: decryptAES256GCM(
            instance.vpsProvider.providerApiKey,
            this.encryptionKeyHex,
          ),
        };

        const adapter = this.adapterResolver.resolve(product.adapterType);

        await adapter.setWebhook(ctx, instance.instanceName, {
          webhook: {
            url: targetUrl,
            enabled: true,
            events: targetEvents,
          },
        });

        synced++;
      } catch (err) {
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
}
