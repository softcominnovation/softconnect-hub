import { ApiProperty } from '@nestjs/swagger';

export class CreateProductDto {
  @ApiProperty({ description: 'Nome do produto', example: 'Softshop' })
  name!: string;

  @ApiProperty({ description: 'Slug único do produto', example: 'softshop' })
  slug!: string;

  @ApiProperty({
    description: 'Tipo do adapter de mensageria',
    example: 'evolution',
    required: false,
  })
  adapterType?: string;

  @ApiProperty({
    description: 'Origens HTTP permitidas para CORS/whitelist',
    example: ['https://app.softshop.com.br'],
    type: [String],
    required: false,
  })
  origins?: string[];

  @ApiProperty({
    description: 'Ativa o relay de webhook via Hub (hub_relay)',
    example: false,
    required: false,
  })
  hubRelay?: boolean;

  @ApiProperty({
    description: 'ID da VPS vinculada ao produto',
    example: 'uuid-da-vps',
    required: false,
  })
  vpsId?: string;

  @ApiProperty({
    description: 'Ativa notificação de resultado batch via webhook',
    example: false,
    required: false,
  })
  batchWebhookEnabled?: boolean;

  @ApiProperty({
    description: 'URL de destino das notificações de batch webhook',
    example: 'https://n8n.empresa.com/webhook/batch-result',
    required: false,
  })
  batchWebhookUrl?: string;
}
