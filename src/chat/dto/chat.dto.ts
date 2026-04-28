import { ApiProperty } from '@nestjs/swagger';

export class CheckNumberDto {
  @ApiProperty({
    description: 'Lista de números a verificar (DDI+DDD+número)',
    type: [String],
    example: ['5511999990001', '5521988880002'],
  })
  numbers!: string[];
}

export class FindChatsDto {
  @ApiProperty({
    description: 'Filtros de busca — ex: { "where": { "id": "5511999990001@s.whatsapp.net" } }',
    required: false,
    example: { where: { id: '5511999990001@s.whatsapp.net' } },
  })
  where?: { id?: string };
}

export class FindMessagesDto {
  @ApiProperty({
    description: 'Filtros de busca — ex: { "where": { "key": { "id": "BAE5F4B73B1F6B50" } } }',
    required: false,
    example: { where: { key: { id: 'BAE5F4B73B1F6B50' } }, limit: 20 },
  })
  where?: { key?: { id?: string }; messageTimestamp?: { gte?: number; lte?: number } };

  @ApiProperty({
    description: 'Limite de mensagens retornadas',
    example: 20,
    required: false,
  })
  limit?: number;
}

export class FindContactsDto {
  @ApiProperty({
    description: 'Filtros de busca — ex: { "where": { "id": "5511...", "pushName": "João" } }',
    required: false,
    example: { where: { id: '5511999990001@s.whatsapp.net', pushName: 'João' } },
  })
  where?: { id?: string; pushName?: string };
}
