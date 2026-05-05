export interface ProviderContext {
  providerUrl: string;
  providerApiKey: string;
}

// --- Instance DTOs ---

export interface CreateInstanceDto {
  instanceName: string;
  token?: string;
  qrcode?: boolean;
  integration?: string;
}

export interface InstanceCreatedDto {
  instanceName: string;
  instanceId?: string;
  status: string;
  qrcode?: { base64?: string; code?: string };
}

export interface InstanceDto {
  instanceName: string;
  id?: string;
  instanceId?: string;
  status: string;
  owner?: string;
  profileName?: string;
  profilePictureUrl?: string;
}

export interface ConnectInstanceDto {
  pairingCode?: string;
  code?: string;
  base64?: string;
}

export interface ConnectionStateDto {
  instance: {
    instanceName: string;
    state: string;
  };
}

// --- Message DTOs ---

export interface MessageResponseDto {
  key: { id: string; remoteJid: string; fromMe: boolean };
  message?: Record<string, unknown>;
  messageTimestamp?: number;
  status?: string;
}

export interface SendTextDto {
  number: string;
  text: string;
  delay?: number;
  quoted?: QuotedMessageDto;
  mentionsEveryOne?: boolean;
  mentioned?: string[];
}

export interface SendMediaDto {
  number: string;
  mediatype: 'image' | 'video' | 'document' | 'audio';
  media: string;
  caption?: string;
  fileName?: string;
  delay?: number;
  quoted?: QuotedMessageDto;
}

export interface SendDocumentDto {
  number: string;
  media: string;
  fileName: string;
  caption?: string;
  delay?: number;
  quoted?: QuotedMessageDto;
}

export interface SendStickerDto {
  number: string;
  sticker: string;
  delay?: number;
  quoted?: QuotedMessageDto;
}

export interface SendPresenceDto {
  number: string;
  delay?: number;
  presence: 'unavailable' | 'available' | 'composing' | 'recording' | 'paused';
}

export interface SendListDto {
  number: string;
  title: string;
  description: string;
  buttonText: string;
  footerText?: string;
  sections: Array<{
    title: string;
    rows: Array<{ title: string; description?: string; rowId: string }>;
  }>;
  delay?: number;
  quoted?: QuotedMessageDto;
}

export interface QuotedMessageDto {
  key: { id: string; remoteJid?: string; fromMe?: boolean };
}

// --- Chat DTOs ---

export interface FindChatsDto {
  where?: {
    id?: string;
  };
}

export interface ChatDto {
  id: string;
  name?: string;
  unreadMessages?: number;
  lastMessage?: Record<string, unknown>;
}

export interface FindMessagesDto {
  where?: {
    key?: { id?: string };
    messageTimestamp?: { gte?: number; lte?: number };
  };
  limit?: number;
}

export interface MessageDto {
  key: { id: string; remoteJid: string; fromMe: boolean };
  message?: Record<string, unknown>;
  messageTimestamp?: number;
  status?: string;
}

export interface FindContactsDto {
  where?: {
    id?: string;
    pushName?: string;
  };
}

export interface ContactDto {
  id: string;
  pushName?: string;
  profilePictureUrl?: string;
}

export interface CheckNumberDto {
  numbers: string[];
}

export interface CheckNumberResponseDto {
  exists: boolean;
  jid?: string;
  number?: string;
}

// --- Webhook DTOs ---

export interface WebhookPayloadDto {
  enabled: boolean;
  url: string;
  headers?: Record<string, string>;
  byEvents?: boolean;
  base64?: boolean;
  events?: string[];
}

export interface SetWebhookDto {
  webhook: WebhookPayloadDto;
}

export interface WebhookDto {
  webhook: WebhookPayloadDto;
}

export interface ToggleWebhookDto {
  enabled: boolean;
}

// --- Settings DTOs ---

export interface SetSettingsDto {
  rejectCall?: boolean;
  msgCall?: string;
  groupsIgnore?: boolean;
  alwaysOnline?: boolean;
  readMessages?: boolean;
  syncFullHistory?: boolean;
  readStatus?: boolean;
}

export interface SettingsDto {
  rejectCall: boolean;
  msgCall?: string;
  groupsIgnore: boolean;
  alwaysOnline: boolean;
  readMessages: boolean;
  syncFullHistory: boolean;
  readStatus: boolean;
}

// --- Proxy DTOs ---

export interface SetProxyDto {
  enabled: boolean;
  host: string;
  port: string;
  protocol: 'http' | 'https' | 'socks5';
  username?: string;
  password?: string;
}

export interface ProxyDto {
  enabled: boolean;
  host: string;
  port: string;
  protocol: string;
  username?: string;
}

// --- Main interface ---

export interface WhatsAppProvider {
  createInstance(
    ctx: ProviderContext,
    dto: CreateInstanceDto,
  ): Promise<InstanceCreatedDto>;
  fetchInstances(ctx: ProviderContext): Promise<InstanceDto[]>;
  fetchInstance(
    ctx: ProviderContext,
    instanceName: string,
  ): Promise<InstanceDto>;
  connectInstance(
    ctx: ProviderContext,
    instanceName: string,
  ): Promise<ConnectInstanceDto>;
  getConnectionState(
    ctx: ProviderContext,
    instanceName: string,
  ): Promise<ConnectionStateDto>;
  restartInstance(ctx: ProviderContext, instanceName: string): Promise<void>;
  logoutInstance(ctx: ProviderContext, instanceName: string): Promise<void>;
  deleteInstance(ctx: ProviderContext, instanceName: string): Promise<void>;

  sendText(
    ctx: ProviderContext,
    instanceName: string,
    dto: SendTextDto,
  ): Promise<MessageResponseDto>;
  sendMedia(
    ctx: ProviderContext,
    instanceName: string,
    dto: SendMediaDto,
  ): Promise<MessageResponseDto>;
  sendDocument(
    ctx: ProviderContext,
    instanceName: string,
    dto: SendDocumentDto,
  ): Promise<MessageResponseDto>;
  sendSticker(
    ctx: ProviderContext,
    instanceName: string,
    dto: SendStickerDto,
  ): Promise<MessageResponseDto>;
  sendList(
    ctx: ProviderContext,
    instanceName: string,
    dto: SendListDto,
  ): Promise<MessageResponseDto>;
  sendPresence(
    ctx: ProviderContext,
    instanceName: string,
    dto: SendPresenceDto,
  ): Promise<void>;

  findChats(
    ctx: ProviderContext,
    instanceName: string,
    dto: FindChatsDto,
  ): Promise<ChatDto[]>;
  findMessages(
    ctx: ProviderContext,
    instanceName: string,
    dto: FindMessagesDto,
  ): Promise<MessageDto[]>;
  findContacts(
    ctx: ProviderContext,
    instanceName: string,
    dto: FindContactsDto,
  ): Promise<ContactDto[]>;
  checkNumber(
    ctx: ProviderContext,
    instanceName: string,
    dto: CheckNumberDto,
  ): Promise<CheckNumberResponseDto>;

  setWebhook(
    ctx: ProviderContext,
    instanceName: string,
    dto: SetWebhookDto,
  ): Promise<void>;
  findWebhook(ctx: ProviderContext, instanceName: string): Promise<WebhookDto>;
  toggleWebhook(
    ctx: ProviderContext,
    instanceName: string,
    dto: ToggleWebhookDto,
  ): Promise<void>;

  setSettings(
    ctx: ProviderContext,
    instanceName: string,
    dto: SetSettingsDto,
  ): Promise<SettingsDto>;
  findSettings(
    ctx: ProviderContext,
    instanceName: string,
  ): Promise<SettingsDto>;

  setProxy(
    ctx: ProviderContext,
    instanceName: string,
    dto: SetProxyDto,
  ): Promise<ProxyDto>;
  findProxy(ctx: ProviderContext, instanceName: string): Promise<ProxyDto>;
}
