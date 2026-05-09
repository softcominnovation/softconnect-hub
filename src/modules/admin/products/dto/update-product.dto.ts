import { ApiProperty } from '@nestjs/swagger';

export class UpdateProductDto {
  @ApiProperty({
    description: 'Nome do produto',
    example: 'Softshop',
    required: false,
  })
  name?: string;

  @ApiProperty({
    description: 'Slug único do produto',
    example: 'softshop',
    required: false,
  })
  slug?: string;

  @ApiProperty({
    description: 'Tipo do adapter de mensageria',
    example: 'evolution',
    required: false,
  })
  adapterType?: string;

  @ApiProperty({
    description: 'Origens HTTP permitidas',
    example: ['https://app.softshop.com.br'],
    type: [String],
    required: false,
  })
  origins?: string[];

  @ApiProperty({
    description: 'Ativa o relay de webhook via Hub',
    example: false,
    required: false,
  })
  hubRelay?: boolean;

  @ApiProperty({
    description: 'ID do VpsProvider vinculado',
    example: 'uuid-do-provider',
    required: false,
  })
  vpsProviderId?: string;

  @ApiProperty({
    description: 'Ativa ou desativa o produto',
    example: true,
    required: false,
  })
  isActive?: boolean;

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
