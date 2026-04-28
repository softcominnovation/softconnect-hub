import { ApiProperty } from '@nestjs/swagger';

export class DashboardLoginDto {
  @ApiProperty({
    description: 'E-mail do usuário admin',
    example: 'joao@softcom.com.br',
  })
  email!: string;

  @ApiProperty({ description: 'Senha do usuário', example: 'senha-segura-123' })
  password!: string;
}
