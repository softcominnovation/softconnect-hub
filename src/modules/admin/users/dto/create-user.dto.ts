import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({
    description: 'Nome completo do usuário',
    example: 'João Silva',
  })
  name!: string;

  @ApiProperty({
    description: 'E-mail do usuário (único)',
    example: 'joao@softcom.com.br',
  })
  email!: string;

  @ApiProperty({
    description: 'Senha (mínimo 8 caracteres)',
    example: 'senha-segura-123',
  })
  password!: string;

  @ApiProperty({
    description: 'Tipo/perfil do usuário',
    example: 'admin',
    required: false,
  })
  type?: string;
}
