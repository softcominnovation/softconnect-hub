import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthCachePayload } from '../../auth/apikey.guard';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import type {
  ProviderContext,
  SetWebhookDto,
  ToggleWebhookDto,
  WebhookDto,
} from '../../providers/whatsapp-provider.interface';
import { InstanceResolverService } from '../../resolver/instance.resolver';

@Injectable()
export class WebhookService {
  private readonly baseUrl: string;

  constructor(
    private readonly adapterResolver: AdapterResolverService,
    private readonly instanceResolver: InstanceResolverService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = this.config.get<string>(
      'HUB_BASE_URL',
      'http://localhost:3000',
    );
  }

  async setWebhook(
    product: AuthCachePayload,
    instanceId: string,
    dto: SetWebhookDto,
  ): Promise<void> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };

    const effectiveDto: SetWebhookDto = product.hubRelay
      ? {
          webhook: {
            ...dto.webhook,
            url: `${this.baseUrl}/internal/webhook/${resolved.adapterType}`,
          },
        }
      : dto;

    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    await adapter.setWebhook(ctx, resolved.instanceName, effectiveDto);
  }

  async findWebhook(
    product: AuthCachePayload,
    instanceId: string,
  ): Promise<WebhookDto> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    return adapter.findWebhook(ctx, resolved.instanceName);
  }

  async toggleWebhook(
    product: AuthCachePayload,
    instanceId: string,
    dto: ToggleWebhookDto,
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
    return adapter.toggleWebhook(ctx, resolved.instanceName, dto);
  }
}
