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

export interface SendAudioDto {
  number: string;
  audio: string;
  delay?: number;
  quoted?: QuotedMessageDto;
}

export interface SendButtonsDto {
  number: string;
  title: string;
  description: string;
  footer?: string;
  buttons: Array<{ buttonId: string; buttonText: { displayText: string } }>;
  delay?: number;
  quoted?: QuotedMessageDto;
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

export interface SendLocationDto {
  number: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  delay?: number;
  quoted?: QuotedMessageDto;
}

export interface SendContactDto {
  number: string;
  contact: Array<{
    fullName: string;
    wuid?: string;
    phoneNumber: string;
    organization?: string;
    email?: string;
    url?: string;
  }>;
  delay?: number;
  quoted?: QuotedMessageDto;
}

export interface SendReactionDto {
  key: { id: string; remoteJid: string; fromMe: boolean };
  reaction: string;
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

export interface SetWebhookDto {
  url: string;
  webhook_by_events?: boolean;
  webhook_base64?: boolean;
  events?: string[];
}

export interface WebhookDto {
  enabled: boolean;
  url: string;
  events?: string[];
  webhook_by_events?: boolean;
  webhook_base64?: boolean;
}

// --- Main interface ---

export interface WhatsAppProvider {
  createInstance(ctx: ProviderContext, dto: CreateInstanceDto): Promise<InstanceCreatedDto>;
  fetchInstances(ctx: ProviderContext): Promise<InstanceDto[]>;
  connectInstance(ctx: ProviderContext, instanceName: string): Promise<ConnectInstanceDto>;
  getConnectionState(ctx: ProviderContext, instanceName: string): Promise<ConnectionStateDto>;
  restartInstance(ctx: ProviderContext, instanceName: string): Promise<void>;
  logoutInstance(ctx: ProviderContext, instanceName: string): Promise<void>;
  deleteInstance(ctx: ProviderContext, instanceName: string): Promise<void>;

  sendText(ctx: ProviderContext, instanceName: string, dto: SendTextDto): Promise<MessageResponseDto>;
  sendMedia(ctx: ProviderContext, instanceName: string, dto: SendMediaDto): Promise<MessageResponseDto>;
  sendWhatsAppAudio(ctx: ProviderContext, instanceName: string, dto: SendAudioDto): Promise<MessageResponseDto>;
  sendButtons(ctx: ProviderContext, instanceName: string, dto: SendButtonsDto): Promise<MessageResponseDto>;
  sendList(ctx: ProviderContext, instanceName: string, dto: SendListDto): Promise<MessageResponseDto>;
  sendLocation(ctx: ProviderContext, instanceName: string, dto: SendLocationDto): Promise<MessageResponseDto>;
  sendContact(ctx: ProviderContext, instanceName: string, dto: SendContactDto): Promise<MessageResponseDto>;
  sendReaction(ctx: ProviderContext, instanceName: string, dto: SendReactionDto): Promise<MessageResponseDto>;

  findChats(ctx: ProviderContext, instanceName: string, dto: FindChatsDto): Promise<ChatDto[]>;
  findMessages(ctx: ProviderContext, instanceName: string, dto: FindMessagesDto): Promise<MessageDto[]>;
  findContacts(ctx: ProviderContext, instanceName: string, dto: FindContactsDto): Promise<ContactDto[]>;
  checkNumber(ctx: ProviderContext, instanceName: string, dto: CheckNumberDto): Promise<CheckNumberResponseDto>;

  setWebhook(ctx: ProviderContext, instanceName: string, dto: SetWebhookDto): Promise<void>;
  findWebhook(ctx: ProviderContext, instanceName: string): Promise<WebhookDto>;
}
