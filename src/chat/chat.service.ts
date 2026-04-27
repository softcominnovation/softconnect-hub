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
    instanceName: string,
  ): Promise<{ ctx: ProviderContext; adapterType: string }> {
    const resolved = await this.instanceResolver.resolve(
      product.productId,
      instanceName,
    );
    return {
      ctx: {
        providerUrl: resolved.providerUrl,
        providerApiKey: resolved.providerApiKey,
      },
      adapterType: resolved.adapterType,
    };
  }

  async findChats(
    product: AuthCachePayload,
    instanceName: string,
    dto: FindChatsDto,
  ): Promise<ChatDto[]> {
    const { ctx, adapterType } = await this.resolve(product, instanceName);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.findChats(ctx, instanceName, dto);
  }

  async findMessages(
    product: AuthCachePayload,
    instanceName: string,
    dto: FindMessagesDto,
  ): Promise<MessageDto[]> {
    const { ctx, adapterType } = await this.resolve(product, instanceName);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.findMessages(ctx, instanceName, dto);
  }

  async findContacts(
    product: AuthCachePayload,
    instanceName: string,
    dto: FindContactsDto,
  ): Promise<ContactDto[]> {
    const { ctx, adapterType } = await this.resolve(product, instanceName);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.findContacts(ctx, instanceName, dto);
  }

  async checkNumber(
    product: AuthCachePayload,
    instanceName: string,
    dto: CheckNumberDto,
  ): Promise<CheckNumberResponseDto> {
    const { ctx, adapterType } = await this.resolve(product, instanceName);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.checkNumber(ctx, instanceName, dto);
  }
}
