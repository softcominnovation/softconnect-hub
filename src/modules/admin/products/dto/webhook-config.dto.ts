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

export class SyncRelayResultDto {
  @ApiProperty({
    description: 'Número de instâncias atualizadas com sucesso na Evolution',
    example: 3,
  })
  synced!: number;

  @ApiProperty({
    description: 'Número de instâncias que falharam ao atualizar',
    example: 0,
  })
  failed!: number;

  @ApiProperty({
    description:
      'URL registrada na Evolution para todas as instâncias sincronizadas',
    example: 'https://hub.softconnect.net.br/api/v1/internal/webhook/evolution',
    required: false,
  })
  targetUrl?: string;

  @ApiProperty({
    description: 'Motivo caso o sync não tenha processado nenhuma instância',
    required: false,
  })
  reason?: string;

  @ApiProperty({
    description:
      'Detalhes de erro por instância que falhou — contém o retorno real da Evolution',
    type: [Object],
    required: false,
    example: [
      {
        instanceName: 'teste',
        error: '{"status":400,"error":"Bad Request","message":"..."}',
      },
    ],
  })
  errors?: { instanceName: string; error: string }[];
}

export class SyncRelayDto {
  @ApiProperty({
    description:
      'ID da instância a sincronizar. Se omitido, todas as instâncias ativas do produto serão sincronizadas.',
    example: 'uuid-da-instancia',
    required: false,
  })
  instanceId?: string;
}

export class ToggleWebhookBulkDto {
  @ApiProperty({
    description:
      'true para ativar o webhook nas instâncias, false para desativar.',
    example: false,
  })
  enabled!: boolean;

  @ApiProperty({
    description:
      'ID da instância a alterar. Se omitido, aplica a todas as instâncias ativas do produto.',
    example: 'uuid-da-instancia',
    required: false,
  })
  instanceId?: string;
}

export class ToggleWebhookBulkResultDto {
  @ApiProperty({
    description: 'Número de instâncias atualizadas com sucesso na Evolution',
    example: 3,
  })
  synced!: number;

  @ApiProperty({
    description: 'Número de instâncias que falharam',
    example: 0,
  })
  failed!: number;

  @ApiProperty({
    description: 'Estado aplicado (true = ativado, false = desativado)',
    example: false,
  })
  enabled!: boolean;

  @ApiProperty({
    description:
      'Detalhes de erro por instância que falhou — contém o retorno real da Evolution',
    type: [Object],
    required: false,
    example: [
      {
        instanceName: 'teste',
        error: '{"status":400,"error":"Bad Request","message":"..."}',
      },
    ],
  })
  errors?: { instanceName: string; error: string }[];
}
