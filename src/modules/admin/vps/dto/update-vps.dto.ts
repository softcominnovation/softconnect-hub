import { ApiProperty } from '@nestjs/swagger';

export class UpdateVpsDto {
  @ApiProperty({
    description: 'Label identificador da VPS',
    example: 'EvoLab-02',
    required: false,
  })
  label?: string;

  @ApiProperty({
    description: 'Subdomínio da VPS',
    example: 'evolab02.softconnect.net.br',
    required: false,
  })
  subdomain?: string;

  @ApiProperty({
    description: 'IP público da VPS',
    example: '203.0.113.10',
    required: false,
  })
  ip?: string;

  @ApiProperty({
    description: 'URL base do provider',
    example: 'http://203.0.113.10:8080',
    required: false,
  })
  providerUrl?: string;

  @ApiProperty({
    description: 'API Key do provider (re-criptografada ao alterar)',
    example: 'chave-secreta',
    required: false,
  })
  providerApiKey?: string;

  @ApiProperty({
    description: 'Tipo do adapter',
    example: 'evolution',
    required: false,
  })
  adapterType?: string;

  @ApiProperty({
    description: 'Tipo do gerenciador',
    example: 'portainer',
    required: false,
  })
  managerType?: string;

  @ApiProperty({
    description: 'URL do gerenciador',
    example: 'https://portainer.softconnect.net.br',
    required: false,
  })
  managerUrl?: string;

  @ApiProperty({
    description: 'API Key do gerenciador',
    example: 'token-portainer',
    required: false,
  })
  managerApiKey?: string;

  @ApiProperty({
    description: 'Ativa ou desativa a VPS',
    example: true,
    required: false,
  })
  isActive?: boolean;
}
