import { ApiProperty } from '@nestjs/swagger';

export class SetInstanceDefaultWebhookDto {
  @ApiProperty({
    description: 'Ativa ou desativa o webhook padrão nas instâncias criadas',
    example: true,
    required: false,
  })
  enabled?: boolean;

  @ApiProperty({
    description: 'URL de destino do webhook configurada automaticamente na instância',
    example: 'https://meu-sistema.com/webhook/whatsapp',
  })
  url!: string;

  @ApiProperty({
    description: 'Headers adicionais enviados nas requisições do webhook',
    example: { Authorization: 'Bearer token' },
    required: false,
    additionalProperties: { type: 'string' },
  })
  headers?: Record<string, string>;

  @ApiProperty({
    description: 'Quando true, o webhook filtra eventos individualmente (byEvents)',
    example: false,
    required: false,
  })
  byEvents?: boolean;

  @ApiProperty({
    description: 'Envia o payload do webhook em Base64',
    example: false,
    required: false,
  })
  base64?: boolean;

  @ApiProperty({
    description: 'Lista de eventos a enviar. Vazio = todos os eventos.',
    example: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
    type: [String],
    required: false,
  })
  events?: string[];
}

export class InstanceDefaultWebhookResponseDto {
  @ApiProperty({ example: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'uuid-do-produto' })
  productId!: string;

  @ApiProperty({ example: true })
  enabled!: boolean;

  @ApiProperty({ example: 'https://meu-sistema.com/webhook/whatsapp' })
  url!: string;

  @ApiProperty({
    example: { Authorization: 'Bearer token' },
    required: false,
    nullable: true,
  })
  headers!: Record<string, string> | null;

  @ApiProperty({ example: false })
  byEvents!: boolean;

  @ApiProperty({ example: false })
  base64!: boolean;

  @ApiProperty({ example: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] })
  events!: string[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class SetInstanceDefaultProxyDto {
  @ApiProperty({
    description: 'Ativa ou desativa o proxy padrão nas instâncias criadas',
    example: true,
    required: false,
  })
  enabled?: boolean;

  @ApiProperty({
    description: 'Hostname ou IP do servidor proxy',
    example: 'proxy.example.com',
  })
  host!: string;

  @ApiProperty({
    description: 'Porta do servidor proxy',
    example: '8080',
  })
  port!: string;

  @ApiProperty({
    description: 'Protocolo do proxy: http, https ou socks5',
    example: 'http',
  })
  protocol!: string;

  @ApiProperty({
    description: 'Usuário de autenticação do proxy',
    example: 'user',
    required: false,
  })
  username?: string;

  @ApiProperty({
    description: 'Senha de autenticação do proxy',
    example: 'pass',
    required: false,
  })
  password?: string;
}

export class InstanceDefaultProxyResponseDto {
  @ApiProperty({ example: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'uuid-do-produto' })
  productId!: string;

  @ApiProperty({ example: true })
  enabled!: boolean;

  @ApiProperty({ example: 'proxy.example.com' })
  host!: string;

  @ApiProperty({ example: '8080' })
  port!: string;

  @ApiProperty({ example: 'http' })
  protocol!: string;

  @ApiProperty({ example: 'user', required: false, nullable: true })
  username!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
