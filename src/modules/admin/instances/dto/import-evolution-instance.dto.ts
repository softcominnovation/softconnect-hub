import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ImportEvolutionInstanceDto {
  @ApiProperty({
    description:
      'ID da instância na Evolution (campo "id" do fetchInstances — equivalente ao instanceId da criação)',
    example: 'e59930c1-934d-4648-ba5a-e72a965376a2',
  })
  id!: string;

  @ApiProperty({
    description: 'Nome da instância na Evolution (campo "name")',
    example: 'bot01-f0e69d51-6ee2-4ec0-a7d0-052ec656f5f8',
  })
  name!: string;

  @ApiProperty({
    description: 'Token da instância na Evolution (campo "token")',
    example: 'D3A7E00BADDF-41B1-B14B-E17C7B5C8E7B',
  })
  token!: string;

  @ApiPropertyOptional({
    description: 'Status de conexão atual (campo "connectionStatus")',
    example: 'open',
  })
  connectionStatus?: string;

  @ApiPropertyOptional({
    description: 'Número de telefone vinculado (campo "number")',
    example: '558391206116',
  })
  number?: string;
}

export class ImportBulkResultDto {
  @ApiProperty({
    description: 'Quantidade de instâncias importadas com sucesso',
  })
  created!: number;

  @ApiProperty({
    description: 'Quantidade de instâncias já vinculadas (puladas)',
  })
  skipped!: number;

  @ApiProperty({ description: 'Quantidade de instâncias com erro' })
  errors!: number;

  @ApiProperty({
    description: 'Detalhes por instância',
    type: () => [ImportBulkItemResultDto],
  })
  details!: ImportBulkItemResultDto[];
}

export class ImportBulkItemResultDto {
  @ApiProperty({ description: 'Nome da instância na Evolution' })
  instanceName!: string;

  @ApiProperty({
    description: 'Resultado: created | skipped | error',
    example: 'created',
    enum: ['created', 'skipped', 'error'],
  })
  result!: 'created' | 'skipped' | 'error';

  @ApiPropertyOptional({ description: 'Mensagem de erro, se houver' })
  reason?: string;

  @ApiPropertyOptional({ description: 'ID da instância criada no Hub' })
  hubInstanceId?: string;
}
