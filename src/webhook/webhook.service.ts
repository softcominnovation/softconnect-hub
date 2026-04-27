import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthCachePayload } from '../auth/apikey.guard';
import { AdapterResolverService } from '../providers/adapter-resolver.service';
import type {
  ProviderContext,
  SetWebhookDto,
  WebhookDto,
} from '../providers/whatsapp-provider.interface';
import { InstanceResolverService } from '../resolver/instance.resolver';

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
    instanceName: string,
    dto: SetWebhookDto,
  ): Promise<void> {
    const resolved = await this.instanceResolver.resolve(
      product.productId,
      instanceName,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };

    const effectiveDto: SetWebhookDto = product.hubRelay
      ? {
          ...dto,
          url: `${this.baseUrl}/internal/webhook/${resolved.adapterType}`,
        }
      : dto;

    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    return adapter.setWebhook(ctx, instanceName, effectiveDto);
  }

  async findWebhook(
    product: AuthCachePayload,
    instanceName: string,
  ): Promise<WebhookDto> {
    const resolved = await this.instanceResolver.resolve(
      product.productId,
      instanceName,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    return adapter.findWebhook(ctx, instanceName);
  }
}
