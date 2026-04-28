import { Injectable } from '@nestjs/common';
import type { AuthCachePayload } from '../auth/apikey.guard';
import { AdapterResolverService } from '../providers/adapter-resolver.service';
import type {
  ProviderContext,
  SetSettingsDto,
  SettingsDto,
} from '../providers/whatsapp-provider.interface';
import { InstanceResolverService } from '../resolver/instance.resolver';

@Injectable()
export class SettingsService {
  constructor(
    private readonly adapterResolver: AdapterResolverService,
    private readonly instanceResolver: InstanceResolverService,
  ) {}

  async setSettings(
    product: AuthCachePayload,
    instanceId: string,
    dto: SetSettingsDto,
  ): Promise<SettingsDto> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    return adapter.setSettings(ctx, resolved.instanceName, dto);
  }

  async findSettings(
    product: AuthCachePayload,
    instanceId: string,
  ): Promise<SettingsDto> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    return adapter.findSettings(ctx, resolved.instanceName);
  }
}
