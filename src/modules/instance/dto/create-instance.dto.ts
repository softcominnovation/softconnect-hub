import { ApiProperty } from '@nestjs/swagger';

export class CreateInstanceDto {
  @ApiProperty({
    description: 'Nome único da instância no provider',
    example: 'agent-atendente-001',
  })
  instanceName!: string;

  @ApiProperty({
    description: 'Token fixo para a instância (opcional)',
    example: 'meu-token-fixo',
    required: false,
  })
  token?: string;

  @ApiProperty({
    description: 'Se true, retorna QR code na resposta de criação',
    example: true,
    required: false,
  })
  qrcode?: boolean;

  @ApiProperty({
    description: 'Tipo de integração WhatsApp',
    example: 'WHATSAPP-BAILEYS',
    required: false,
    enum: ['WHATSAPP-BAILEYS', 'WHATSAPP-BUSINESS'],
  })
  integration?: string;
}
