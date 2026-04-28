import { Injectable } from '@nestjs/common';
import {
  ChatDto,
  CheckNumberDto,
  CheckNumberResponseDto,
  ConnectInstanceDto,
  ConnectionStateDto,
  ContactDto,
  CreateInstanceDto,
  FindChatsDto,
  FindContactsDto,
  FindMessagesDto,
  InstanceCreatedDto,
  InstanceDto,
  MessageDto,
  MessageResponseDto,
  ProviderContext,
  ProxyDto,
  SendDocumentDto,
  SendListDto,
  SendMediaDto,
  SendPresenceDto,
  SendStickerDto,
  SendTextDto,
  SetProxyDto,
  SetSettingsDto,
  SetWebhookDto,
  SettingsDto,
  ToggleWebhookDto,
  WebhookDto,
  WhatsAppProvider,
} from '../../providers/whatsapp-provider.interface';
import { EvolutionHttpService } from './evolution.http';

@Injectable()
export class EvolutionAdapter implements WhatsAppProvider {
  constructor(private readonly http: EvolutionHttpService) {}

  createInstance(
    ctx: ProviderContext,
    dto: CreateInstanceDto,
  ): Promise<InstanceCreatedDto> {
    return this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      '/instance/create',
      { ...dto, integration: dto.integration ?? 'WHATSAPP-BAILEYS' },
    );
  }

  fetchInstances(ctx: ProviderContext): Promise<InstanceDto[]> {
    return this.http.request(
      'get',
      ctx.providerUrl,
      ctx.providerApiKey,
      '/instance/fetchInstances',
    );
  }

  fetchInstance(ctx: ProviderContext, instanceName: string): Promise<InstanceDto> {
    return this.http.request(
      'get',
      ctx.providerUrl,
      ctx.providerApiKey,
      '/instance/fetchInstances',
      undefined,
      { instanceName },
    );
  }

  connectInstance(
    ctx: ProviderContext,
    instanceName: string,
  ): Promise<ConnectInstanceDto> {
    return this.http.request(
      'get',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/instance/connect/${instanceName}`,
    );
  }

  getConnectionState(
    ctx: ProviderContext,
    instanceName: string,
  ): Promise<ConnectionStateDto> {
    return this.http.request(
      'get',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/instance/connectionState/${instanceName}`,
    );
  }

  async restartInstance(
    ctx: ProviderContext,
    instanceName: string,
  ): Promise<void> {
    await this.http.request(
      'put',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/instance/restart/${instanceName}`,
    );
  }

  async logoutInstance(
    ctx: ProviderContext,
    instanceName: string,
  ): Promise<void> {
    await this.http.request(
      'delete',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/instance/logout/${instanceName}`,
    );
  }

  async deleteInstance(
    ctx: ProviderContext,
    instanceName: string,
  ): Promise<void> {
    await this.http.request(
      'delete',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/instance/delete/${instanceName}`,
    );
  }

  sendText(
    ctx: ProviderContext,
    instanceName: string,
    dto: SendTextDto,
  ): Promise<MessageResponseDto> {
    return this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/message/sendText/${instanceName}`,
      dto,
    );
  }

  sendMedia(
    ctx: ProviderContext,
    instanceName: string,
    dto: SendMediaDto,
  ): Promise<MessageResponseDto> {
    return this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/message/sendMedia/${instanceName}`,
      dto,
    );
  }

  sendDocument(
    ctx: ProviderContext,
    instanceName: string,
    dto: SendDocumentDto,
  ): Promise<MessageResponseDto> {
    return this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/message/sendMedia/${instanceName}`,
      { ...dto, mediatype: 'document' },
    );
  }

  sendSticker(
    ctx: ProviderContext,
    instanceName: string,
    dto: SendStickerDto,
  ): Promise<MessageResponseDto> {
    return this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/message/sendSticker/${instanceName}`,
      dto,
    );
  }

  sendList(
    ctx: ProviderContext,
    instanceName: string,
    dto: SendListDto,
  ): Promise<MessageResponseDto> {
    return this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/message/sendList/${instanceName}`,
      dto,
    );
  }

  async sendPresence(
    ctx: ProviderContext,
    instanceName: string,
    dto: SendPresenceDto,
  ): Promise<void> {
    await this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/message/sendPresence/${instanceName}`,
      dto,
    );
  }

  findChats(
    ctx: ProviderContext,
    instanceName: string,
    dto: FindChatsDto,
  ): Promise<ChatDto[]> {
    return this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/chat/findChats/${instanceName}`,
      dto,
    );
  }

  findMessages(
    ctx: ProviderContext,
    instanceName: string,
    dto: FindMessagesDto,
  ): Promise<MessageDto[]> {
    return this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/chat/findMessages/${instanceName}`,
      dto,
    );
  }

  findContacts(
    ctx: ProviderContext,
    instanceName: string,
    dto: FindContactsDto,
  ): Promise<ContactDto[]> {
    return this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/chat/findContacts/${instanceName}`,
      dto,
    );
  }

  checkNumber(
    ctx: ProviderContext,
    instanceName: string,
    dto: CheckNumberDto,
  ): Promise<CheckNumberResponseDto> {
    return this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/chat/whatsappNumbers/${instanceName}`,
      dto,
    );
  }

  async setWebhook(
    ctx: ProviderContext,
    instanceName: string,
    dto: SetWebhookDto,
  ): Promise<void> {
    await this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/webhook/set/${instanceName}`,
      dto,
    );
  }

  findWebhook(ctx: ProviderContext, instanceName: string): Promise<WebhookDto> {
    return this.http.request(
      'get',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/webhook/find/${instanceName}`,
    );
  }

  async toggleWebhook(
    ctx: ProviderContext,
    instanceName: string,
    dto: ToggleWebhookDto,
  ): Promise<void> {
    const current = await this.findWebhook(ctx, instanceName);
    const updated: SetWebhookDto = {
      webhook: { ...current.webhook, enabled: dto.enabled },
    };
    await this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/webhook/set/${instanceName}`,
      updated,
    );
  }

  setSettings(
    ctx: ProviderContext,
    instanceName: string,
    dto: SetSettingsDto,
  ): Promise<SettingsDto> {
    return this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/settings/set/${instanceName}`,
      dto,
    );
  }

  findSettings(ctx: ProviderContext, instanceName: string): Promise<SettingsDto> {
    return this.http.request(
      'get',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/settings/find/${instanceName}`,
    );
  }

  setProxy(
    ctx: ProviderContext,
    instanceName: string,
    dto: SetProxyDto,
  ): Promise<ProxyDto> {
    return this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/proxy/set/${instanceName}`,
      dto,
    );
  }

  findProxy(ctx: ProviderContext, instanceName: string): Promise<ProxyDto> {
    return this.http.request(
      'get',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/proxy/find/${instanceName}`,
    );
  }
}
