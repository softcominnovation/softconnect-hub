import { ApiProperty } from '@nestjs/swagger';

export class CreateVpsDto {
  @ApiProperty({
    description: 'Label identificador da VPS',
    example: 'EvoLab-02',
  })
  label!: string;

  @ApiProperty({
    description: 'Subdomínio da VPS',
    example: 'evolab02.softconnect.net.br',
  })
  subdomain!: string;

  @ApiProperty({ description: 'IP público da VPS', example: '203.0.113.10' })
  ip!: string;

  @ApiProperty({
    description: 'URL base do provider na VPS',
    example: 'http://203.0.113.10:8080',
  })
  providerUrl!: string;

  @ApiProperty({
    description: 'API Key do provider (armazenada criptografada)',
    example: 'chave-secreta-evolution',
  })
  providerApiKey!: string;

  @ApiProperty({
    description: 'Tipo do adapter associado à VPS',
    example: 'evolution',
    required: false,
  })
  adapterType?: string;

  @ApiProperty({
    description: 'Tipo do gerenciador (ex: portainer)',
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
    description:
      'URL do endpoint do system-monitor na VPS (ex: https://monitor.evo01.softconnect.net.br)',
    example: 'https://monitor.evo01.softconnect.net.br',
    required: false,
  })
  monitorUrl?: string;

  @ApiProperty({
    description: 'API Key do system-monitor (armazenada criptografada)',
    example: 'chave-monitor-secreta',
    required: false,
  })
  monitorApiKey?: string;
}
