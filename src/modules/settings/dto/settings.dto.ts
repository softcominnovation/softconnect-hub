import { ApiProperty } from '@nestjs/swagger';

export class SetSettingsDto {
  @ApiProperty({
    description: 'Rejeitar chamadas recebidas',
    example: false,
    required: false,
  })
  rejectCall?: boolean;

  @ApiProperty({
    description: 'Mensagem enviada ao rejeitar chamada',
    example: 'Não posso atender agora.',
    required: false,
  })
  msgCall?: string;

  @ApiProperty({
    description: 'Ignorar mensagens de grupos',
    example: false,
    required: false,
  })
  groupsIgnore?: boolean;

  @ApiProperty({
    description: 'Manter status "online" permanentemente',
    example: false,
    required: false,
  })
  alwaysOnline?: boolean;

  @ApiProperty({
    description: 'Marcar mensagens como lidas automaticamente',
    example: false,
    required: false,
  })
  readMessages?: boolean;

  @ApiProperty({
    description: 'Sincronizar histórico completo ao conectar',
    example: false,
    required: false,
  })
  syncFullHistory?: boolean;

  @ApiProperty({
    description: 'Enviar confirmação de leitura (duplo check azul)',
    example: false,
    required: false,
  })
  readStatus?: boolean;
}
