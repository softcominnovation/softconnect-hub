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
    description: 'ID da VPS vinculada',
    example: 'uuid-da-vps',
    required: false,
  })
  vpsId?: string;

  @ApiProperty({
    description: 'Ativa ou desativa o produto',
    example: true,
    required: false,
  })
  isActive?: boolean;
}
