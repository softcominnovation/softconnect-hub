import { ApiProperty } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiProperty({
    description: 'Nome completo do usuário',
    example: 'João Silva',
    required: false,
  })
  name?: string;

  @ApiProperty({
    description: 'Tipo/perfil do usuário',
    example: 'admin',
    required: false,
  })
  type?: string;

  @ApiProperty({
    description: 'Ativa ou desativa o usuário',
    example: true,
    required: false,
  })
  isActive?: boolean;
}
