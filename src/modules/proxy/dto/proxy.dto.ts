import { ApiProperty } from '@nestjs/swagger';

export class SetProxyDto {
  @ApiProperty({ description: 'Ativar o proxy', example: true })
  enabled!: boolean;

  @ApiProperty({ description: 'Host do servidor proxy', example: 'proxy.example.com' })
  host!: string;

  @ApiProperty({ description: 'Porta do servidor proxy', example: '8080' })
  port!: string;

  @ApiProperty({
    description: 'Protocolo do proxy',
    enum: ['http', 'https', 'socks5'],
    example: 'http',
  })
  protocol!: 'http' | 'https' | 'socks5';

  @ApiProperty({ description: 'Usuário de autenticação do proxy', example: 'user', required: false })
  username?: string;

  @ApiProperty({ description: 'Senha de autenticação do proxy', example: 'pass', required: false })
  password?: string;
}
