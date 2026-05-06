import { ApiProperty } from '@nestjs/swagger';

export class SetWebhookConfigDto {
  @ApiProperty({
    description: 'URL para onde o Hub entregará os eventos (sua aplicação)',
    example: 'https://minha-api.com/webhook/whatsapp',
  })
  url!: string;

  @ApiProperty({
    description:
      'Segredo para validação da assinatura HMAC-SHA256 (X-Hub-Signature). Mínimo 16 caracteres.',
    example: 'meu-segredo-super-secreto-123',
  })
  secret!: string;

  @ApiProperty({
    description:
      'Eventos a filtrar. Array vazio ou omitido = todos os eventos.',
    example: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
    type: [String],
    required: false,
  })
  events?: string[];
}

export class WebhookConfigResponseDto {
  @ApiProperty({ example: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'uuid-do-produto' })
  productId!: string;

  @ApiProperty({ example: 'https://minha-api.com/webhook/whatsapp' })
  url!: string;

  @ApiProperty({ example: ['MESSAGES_UPSERT'] })
  events!: string[];

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty()
  createdAt!: Date;
}
