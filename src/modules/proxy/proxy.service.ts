import { Injectable } from '@nestjs/common';
import type { AuthCachePayload } from '../../auth/apikey.guard';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import type {
  ProxyDto,
  ProviderContext,
  SetProxyDto,
} from '../../providers/whatsapp-provider.interface';
import { InstanceResolverService } from '../../resolver/instance.resolver';

@Injectable()
export class ProxyService {
  constructor(
    private readonly adapterResolver: AdapterResolverService,
    private readonly instanceResolver: InstanceResolverService,
  ) {}

  async setProxy(
    product: AuthCachePayload,
    instanceId: string,
    dto: SetProxyDto,
  ): Promise<ProxyDto> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    return adapter.setProxy(ctx, resolved.instanceName, dto);
  }

  async findProxy(
    product: AuthCachePayload,
    instanceId: string,
  ): Promise<ProxyDto> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    return adapter.findProxy(ctx, resolved.instanceName);
  }
}
