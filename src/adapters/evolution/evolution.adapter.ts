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

  async createInstance(
    ctx: ProviderContext,
    dto: CreateInstanceDto,
  ): Promise<InstanceCreatedDto> {
    const raw = await this.http.request<{
      instance?: {
        instanceName?: string;
        instanceId?: string;
        status?: string;
      };
      qrcode?: { base64?: string; code?: string; pairingCode?: string };
    }>('post', ctx.providerUrl, ctx.providerApiKey, '/instance/create', {
      ...dto,
      integration: dto.integration ?? 'WHATSAPP-BAILEYS',
    });

    return {
      instanceName: raw.instance?.instanceName ?? dto.instanceName,
      instanceId: raw.instance?.instanceId,
      status: raw.instance?.status ?? 'connecting',
      qrcode: raw.qrcode
        ? { base64: raw.qrcode.base64, code: raw.qrcode.code }
        : undefined,
    };
  }

  async fetchInstances(ctx: ProviderContext): Promise<InstanceDto[]> {
    const raw = await this.http.request<unknown>(
      'get',
      ctx.providerUrl,
      ctx.providerApiKey,
      '/instance/fetchInstances',
    );

    const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];

    return list.map((inst) => {
      const nested = inst.instance as Record<string, unknown> | undefined;
      const setting = inst.Setting as Record<string, unknown> | undefined;

      const instanceName =
        (inst.instanceName as string | undefined) ||
        (inst.name as string | undefined) ||
        (nested?.instanceName as string | undefined) ||
        '';

      const id =
        (inst.id as string | undefined) ||
        (nested?.instanceId as string | undefined) ||
        (inst.instanceId as string | undefined) ||
        (setting?.instanceId as string | undefined);

      const status =
        (inst.connectionStatus as string | undefined) ||
        (nested?.connectionStatus as string | undefined) ||
        (nested?.status as string | undefined) ||
        (inst.status as string | undefined) ||
        'unknown';

      return { ...inst, instanceName, id, status } as unknown as InstanceDto;
    });
  }

  fetchInstance(
    ctx: ProviderContext,
    instanceName: string,
  ): Promise<InstanceDto> {
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
      `/chat/sendPresence/${instanceName}`,
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
    const { byEvents, base64, ...rest } = dto.webhook;
    const payload = {
      webhook: {
        ...rest,
        byEvents: byEvents ?? false,
        base64: base64 ?? true,
      },
    };
    const response = await this.http.request<unknown>(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/webhook/set/${instanceName}`,
      payload,
    );
    void response;
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
    const raw = await this.http.request<Record<string, unknown>>(
      'get',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/webhook/find/${instanceName}`,
    );

    const src =
      raw && typeof raw === 'object' && 'webhook' in raw
        ? (raw.webhook as Record<string, unknown>)
        : raw;

    const url = (src?.url ?? src?.webhookUrl ?? '') as string;
    const events = Array.isArray(src?.events) ? src.events : [];
    const byEvents =
      src?.byEvents !== undefined
        ? src.byEvents
        : src?.webhookByEvents !== undefined
          ? src.webhookByEvents
          : false;
    const base64 =
      src?.base64 !== undefined
        ? src.base64
        : src?.webhookBase64 !== undefined
          ? src.webhookBase64
          : false;

    await this.http.request(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/webhook/set/${instanceName}`,
      {
        webhook: {
          enabled: dto.enabled,
          url,
          events,
          byEvents,
          base64,
        },
      },
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

  findSettings(
    ctx: ProviderContext,
    instanceName: string,
  ): Promise<SettingsDto> {
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
