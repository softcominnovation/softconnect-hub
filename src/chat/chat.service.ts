import { Injectable } from '@nestjs/common';
import type { AuthCachePayload } from '../auth/apikey.guard';
import { AdapterResolverService } from '../providers/adapter-resolver.service';
import type {
  ChatDto,
  CheckNumberDto,
  CheckNumberResponseDto,
  ContactDto,
  FindChatsDto,
  FindContactsDto,
  FindMessagesDto,
  MessageDto,
  ProviderContext,
} from '../providers/whatsapp-provider.interface';
import { InstanceResolverService } from '../resolver/instance.resolver';

@Injectable()
export class ChatService {
  constructor(
    private readonly adapterResolver: AdapterResolverService,
    private readonly instanceResolver: InstanceResolverService,
  ) {}

  private async resolve(
    product: AuthCachePayload,
    instanceId: string,
  ): Promise<{ ctx: ProviderContext; adapterType: string; instanceName: string }> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    return {
      ctx: {
        providerUrl: resolved.providerUrl,
        providerApiKey: resolved.providerApiKey,
      },
      adapterType: resolved.adapterType,
      instanceName: resolved.instanceName,
    };
  }

  async findChats(
    product: AuthCachePayload,
    instanceId: string,
    dto: FindChatsDto,
  ): Promise<ChatDto[]> {
    const { ctx, adapterType, instanceName } = await this.resolve(product, instanceId);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.findChats(ctx, instanceName, dto);
  }

  async findMessages(
    product: AuthCachePayload,
    instanceId: string,
    dto: FindMessagesDto,
  ): Promise<MessageDto[]> {
    const { ctx, adapterType, instanceName } = await this.resolve(product, instanceId);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.findMessages(ctx, instanceName, dto);
  }

  async findContacts(
    product: AuthCachePayload,
    instanceId: string,
    dto: FindContactsDto,
  ): Promise<ContactDto[]> {
    const { ctx, adapterType, instanceName } = await this.resolve(product, instanceId);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.findContacts(ctx, instanceName, dto);
  }

  async checkNumber(
    product: AuthCachePayload,
    instanceId: string,
    dto: CheckNumberDto,
  ): Promise<CheckNumberResponseDto> {
    const { ctx, adapterType, instanceName } = await this.resolve(product, instanceId);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.checkNumber(ctx, instanceName, dto);
  }
}
