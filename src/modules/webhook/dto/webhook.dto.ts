import { ApiProperty } from '@nestjs/swagger';

export class WebhookPayloadDto {
  @ApiProperty({ description: 'Ativar ou desativar o webhook', example: true })
  enabled!: boolean;

  @ApiProperty({
    description: 'URL de destino do webhook',
    example: 'https://meu-sistema.com/webhook/whatsapp',
  })
  url!: string;

  @ApiProperty({
    description: 'Headers HTTP customizados',
    example: { Authorization: 'Bearer token' },
    required: false,
  })
  headers?: Record<string, string>;

  @ApiProperty({ description: 'Enviar um webhook por evento separado', example: false, required: false })
  byEvents?: boolean;

  @ApiProperty({ description: 'Incluir mídia como base64 no payload', example: false, required: false })
  base64?: boolean;

  @ApiProperty({
    description: 'Eventos a assinar (vazio = todos)',
    type: [String],
    example: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
    required: false,
  })
  events?: string[];
}

export class SetWebhookDto {
  @ApiProperty({ type: () => WebhookPayloadDto, description: 'Configuração do webhook' })
  webhook!: WebhookPayloadDto;
}

export class ToggleWebhookDto {
  @ApiProperty({ description: 'Ativar (true) ou desativar (false) o webhook', example: true })
  enabled!: boolean;
}
