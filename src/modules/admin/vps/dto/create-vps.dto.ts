import { ApiProperty } from '@nestjs/swagger';

export class CreateVpsDto {
  @ApiProperty({ description: 'Label identificador da VPS', example: 'EvoLab-02' })
  label!: string;

  @ApiProperty({ description: 'Subdominio da VPS', example: 'evolab02.softconnect.net.br' })
  subdomain!: string;

  @ApiProperty({ description: 'IP publico da VPS', example: '203.0.113.10' })
  ip!: string;

  @ApiProperty({ description: 'Tipo do gerenciador (ex: portainer)', example: 'portainer', required: false })
  managerType?: string;

  @ApiProperty({ description: 'URL do gerenciador', example: 'https://portainer.softconnect.net.br', required: false })
  managerUrl?: string;

  @ApiProperty({ description: 'API Key do gerenciador', example: 'token-portainer', required: false })
  managerApiKey?: string;

  @ApiProperty({ description: 'URL do system-monitor na VPS', example: 'https://monitor.evo01.softconnect.net.br', required: false })
  monitorUrl?: string;

  @ApiProperty({ description: 'API Key do system-monitor (armazenada criptografada)', example: 'chave-monitor-secreta', required: false })
  monitorApiKey?: string;

  @ApiProperty({ description: 'Anotacoes livres sobre a VPS', example: 'VPS principal do cliente X.', required: false })
  notes?: string;
}
