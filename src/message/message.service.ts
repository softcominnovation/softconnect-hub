import { Injectable } from '@nestjs/common';
import type { AuthCachePayload } from '../auth/apikey.guard';
import { AdapterResolverService } from '../providers/adapter-resolver.service';
import type {
  MessageResponseDto,
  ProviderContext,
  SendAudioDto,
  SendButtonsDto,
  SendContactDto,
  SendListDto,
  SendLocationDto,
  SendMediaDto,
  SendReactionDto,
  SendTextDto,
} from '../providers/whatsapp-provider.interface';
import { InstanceResolverService } from '../resolver/instance.resolver';

@Injectable()
export class MessageService {
  constructor(
    private readonly adapterResolver: AdapterResolverService,
    private readonly instanceResolver: InstanceResolverService,
  ) {}

  private async ctx(
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

  async sendText(
    product: AuthCachePayload,
    instanceName: string,
    dto: SendTextDto,
  ): Promise<MessageResponseDto> {
    const { ctx, adapterType } = await this.ctx(product, instanceName);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.sendText(ctx, instanceName, dto);
  }

  async sendMedia(
    product: AuthCachePayload,
    instanceName: string,
    dto: SendMediaDto,
  ): Promise<MessageResponseDto> {
    const { ctx, adapterType } = await this.ctx(product, instanceName);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.sendMedia(ctx, instanceName, dto);
  }

  async sendWhatsAppAudio(
    product: AuthCachePayload,
    instanceName: string,
    dto: SendAudioDto,
  ): Promise<MessageResponseDto> {
    const { ctx, adapterType } = await this.ctx(product, instanceName);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.sendWhatsAppAudio(ctx, instanceName, dto);
  }

  async sendButtons(
    product: AuthCachePayload,
    instanceName: string,
    dto: SendButtonsDto,
  ): Promise<MessageResponseDto> {
    const { ctx, adapterType } = await this.ctx(product, instanceName);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.sendButtons(ctx, instanceName, dto);
  }

  async sendList(
    product: AuthCachePayload,
    instanceName: string,
    dto: SendListDto,
  ): Promise<MessageResponseDto> {
    const { ctx, adapterType } = await this.ctx(product, instanceName);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.sendList(ctx, instanceName, dto);
  }

  async sendLocation(
    product: AuthCachePayload,
    instanceName: string,
    dto: SendLocationDto,
  ): Promise<MessageResponseDto> {
    const { ctx, adapterType } = await this.ctx(product, instanceName);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.sendLocation(ctx, instanceName, dto);
  }

  async sendContact(
    product: AuthCachePayload,
    instanceName: string,
    dto: SendContactDto,
  ): Promise<MessageResponseDto> {
    const { ctx, adapterType } = await this.ctx(product, instanceName);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.sendContact(ctx, instanceName, dto);
  }

  async sendReaction(
    product: AuthCachePayload,
    instanceName: string,
    dto: SendReactionDto,
  ): Promise<MessageResponseDto> {
    const { ctx, adapterType } = await this.ctx(product, instanceName);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.sendReaction(ctx, instanceName, dto);
  }
}
