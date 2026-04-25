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
  SendAudioDto,
  SendButtonsDto,
  SendContactDto,
  SendListDto,
  SendLocationDto,
  SendMediaDto,
  SendReactionDto,
  SendTextDto,
  SetWebhookDto,
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
      dto,
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

  sendWhatsAppAudio(
    ctx: ProviderContext,
    instanceName: string,
    dto: SendAudioDto,
  ): Promise<MessageResponseDto> {
    return this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/message/sendWhatsAppAudio/${instanceName}`,
      dto,
    );
  }

  sendButtons(
    ctx: ProviderContext,
    instanceName: string,
    dto: SendButtonsDto,
  ): Promise<MessageResponseDto> {
    return this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/message/sendButtons/${instanceName}`,
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

  sendLocation(
    ctx: ProviderContext,
    instanceName: string,
    dto: SendLocationDto,
  ): Promise<MessageResponseDto> {
    return this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/message/sendLocation/${instanceName}`,
      dto,
    );
  }

  sendContact(
    ctx: ProviderContext,
    instanceName: string,
    dto: SendContactDto,
  ): Promise<MessageResponseDto> {
    return this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/message/sendContact/${instanceName}`,
      dto,
    );
  }

  sendReaction(
    ctx: ProviderContext,
    instanceName: string,
    dto: SendReactionDto,
  ): Promise<MessageResponseDto> {
    return this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/message/sendReaction/${instanceName}`,
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
}
