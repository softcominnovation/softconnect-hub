import { ApiProperty } from '@nestjs/swagger';

export class AdminLoginDto {
  @ApiProperty({
    description:
      'Secret de autenticação machine-to-machine (variável ADMIN_SECRET)',
    example: 'minha-senha-admin-dev',
  })
  secret!: string;
}
