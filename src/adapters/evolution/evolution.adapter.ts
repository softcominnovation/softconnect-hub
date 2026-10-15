import { ConflictException } from '@nestjs/common';
import { withoutRelayToken } from '../../modules/webhook/relay-configuration';
import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApplyInstanceDefaultsResult,
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
  InstanceDefaultProxyConfig,
  InstanceDefaultWebhookConfig,
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
import {
  buildPublicProxy,
  canConfirmProxySet,
  classifyProxyRead,
  DEFAULT_PROXY_CONFIRM_DELAYS_MS,
} from './evolution.proxy-confirmation';

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
    }>(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      '/instance/create',
      {
        ...dto,
        integration: dto.integration ?? 'WHATSAPP-BAILEYS',
      },
      undefined,
      ctx.execution
        ? { execution: ctx.execution, operation: 'create' }
        : undefined,
    );

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
      undefined,
      undefined,
      ctx.execution
        ? { execution: ctx.execution, operation: 'lookup' }
        : undefined,
    );

    if (ctx.strictInventory && !Array.isArray(raw))
      throw new BadGatewayException('Resposta de inventário inválida');
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

  async fetchInstance(
    ctx: ProviderContext,
    instanceName: string,
  ): Promise<InstanceDto> {
    const raw = await this.http.request(
      'get',
      ctx.providerUrl,
      ctx.providerApiKey,
      '/instance/fetchInstances',
      undefined,
      { instanceName },
    );

    // Evolution devolve array mesmo filtrando por instanceName
    const list = Array.isArray(raw)
      ? (raw as Record<string, unknown>[])
      : raw
        ? [raw as Record<string, unknown>]
        : [];

    if (list.length > 1)
      throw new ConflictException(
        'Identidade de instância ambígua no provider',
      );
    const inst = list[0];
    if (!inst) {
      throw new NotFoundException(
        `Instância "${instanceName}" não encontrada no provider`,
      );
    }

    const nested = inst.instance as Record<string, unknown> | undefined;
    const setting = inst.Setting as Record<string, unknown> | undefined;

    const name =
      (inst.instanceName as string | undefined) ||
      (inst.name as string | undefined) ||
      (nested?.instanceName as string | undefined) ||
      instanceName;

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

    return {
      ...inst,
      instanceName: name,
      id,
      status,
    } as unknown as InstanceDto;
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
      undefined,
      undefined,
      ctx.execution
        ? { execution: ctx.execution, operation: 'connect' }
        : undefined,
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
      undefined,
      undefined,
      ctx.execution
        ? { execution: ctx.execution, operation: 'delete' }
        : undefined,
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
  ): Promise<unknown> {
    const { byEvents, base64, headers, ...rest } = dto.webhook;
    const payload: Record<string, unknown> = {
      webhook: {
        ...rest,
        byEvents: byEvents ?? false,
        base64: base64 ?? true,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      },
    };
    return this.http.request<unknown>(
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/webhook/set/${instanceName}`,
      payload,
      undefined,
      ctx.execution
        ? { execution: ctx.execution, operation: 'webhook' }
        : undefined,
    );
  }

  async findWebhook(
    ctx: ProviderContext,
    instanceName: string,
  ): Promise<WebhookDto> {
    return withoutRelayToken(
      await this.http.request<WebhookDto>(
        'get',
        ctx.providerUrl,
        ctx.providerApiKey,
        `/webhook/find/${instanceName}`,
      ),
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
          ...(src?.headers && typeof src.headers === 'object'
            ? { headers: src.headers }
            : {}),
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
      undefined,
      ctx.execution
        ? { execution: ctx.execution, operation: 'proxy' }
        : undefined,
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

  async applyInstanceDefaults(
    ctx: ProviderContext,
    instanceName: string,
    defaults: {
      webhook?: InstanceDefaultWebhookConfig;
      proxy?: InstanceDefaultProxyConfig;
    },
    options?: { defaultProxyDeadlineAt: number },
  ): Promise<ApplyInstanceDefaultsResult> {
    const result: ApplyInstanceDefaultsResult = {};

    if (defaults.webhook) {
      const { enabled, url, headers, byEvents, base64, events } =
        defaults.webhook;
      result.webhook = await this.setWebhook(ctx, instanceName, {
        webhook: {
          enabled: enabled ?? true,
          url,
          headers,
          byEvents,
          base64,
          events,
        },
      });
    }

    if (defaults.proxy) {
      Object.assign(
        result,
        await this.applyDefaultProxy(
          ctx,
          instanceName,
          defaults.proxy,
          options?.defaultProxyDeadlineAt,
        ),
      );
    }

    return result;
  }

  /**
   * One POST, then up to three reads sharing the same budget. Only a read
   * that matches what was sent is returned; otherwise `proxy` is omitted.
   */
  private async applyDefaultProxy(
    ctx: ProviderContext,
    instanceName: string,
    defaults: InstanceDefaultProxyConfig,
    deadlineAt: number | undefined,
  ): Promise<ApplyInstanceDefaultsResult> {
    const startedAt = performance.now();
    const diagnostics = (operation: 'set' | 'find', reads: number) => ({
      operation,
      reads,
      durationMs: Math.round(performance.now() - startedAt),
    });
    const budget = this.http.createOptionalBudget(ctx.execution, deadlineAt);
    if (!budget) return { proxyFailure: 'budget_unavailable' };

    const { enabled, host, port, protocol, username, password } = defaults;
    const payload: SetProxyDto = {
      enabled: enabled ?? true,
      host,
      port,
      protocol: protocol as SetProxyDto['protocol'],
      username,
      password,
    };
    const set = await this.http.tryOptionalRequest<unknown>(
      budget,
      'post',
      ctx.providerUrl,
      ctx.providerApiKey,
      `/proxy/set/${instanceName}`,
      payload,
    );
    if ('failure' in set) {
      return {
        proxyFailure: set.failure,
        proxyDiagnostics: diagnostics('set', 0),
      };
    }
    if (!canConfirmProxySet(set.data, instanceName)) {
      return {
        proxyFailure: 'confirmation_invalid',
        proxyDiagnostics: diagnostics('set', 0),
      };
    }

    let reads = 0;
    let pending: 'confirmation_unavailable' | 'confirmation_mismatch' =
      'confirmation_unavailable';
    const delays = [0, ...DEFAULT_PROXY_CONFIRM_DELAYS_MS];
    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (
        attempt > 0 &&
        !(await this.http.waitOptional(budget, delays[attempt]))
      ) {
        break;
      }
      const read = await this.http.tryOptionalRequest<unknown>(
        budget,
        'get',
        ctx.providerUrl,
        ctx.providerApiKey,
        `/proxy/find/${instanceName}`,
      );
      if ('failure' in read && read.failure === 'budget_exhausted') break;
      reads += 1;
      if ('failure' in read) {
        if (read.status === 404) {
          pending = 'confirmation_unavailable';
          continue;
        }
        return {
          proxyFailure: read.failure,
          proxyDiagnostics: diagnostics('find', reads),
        };
      }
      const outcome = classifyProxyRead(read.data, instanceName, payload);
      if (outcome.kind === 'confirmed') {
        return {
          proxy: buildPublicProxy(set.data, outcome.leaf, instanceName),
        };
      }
      if (outcome.kind === 'invalid') {
        return {
          proxyFailure: 'confirmation_invalid',
          proxyDiagnostics: diagnostics('find', reads),
        };
      }
      pending =
        outcome.kind === 'divergent'
          ? 'confirmation_mismatch'
          : 'confirmation_unavailable';
    }

    return {
      proxyFailure: pending,
      proxyDiagnostics: diagnostics('find', reads),
    };
  }
}
