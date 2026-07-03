import { ApiProperty } from '@nestjs/swagger';

export class UpdateVpsDto {
  @ApiProperty({ description: 'Label identificador da VPS', example: 'EvoLab-02', required: false })
  label?: string;

  @ApiProperty({ description: 'Subdominio da VPS', example: 'evolab02.softconnect.net.br', required: false })
  subdomain?: string;

  @ApiProperty({ description: 'IP publico da VPS', example: '203.0.113.10', required: false })
  ip?: string;

  @ApiProperty({ description: 'Tipo do gerenciador', example: 'portainer', required: false })
  managerType?: string;

  @ApiProperty({ description: 'URL do gerenciador', example: 'https://portainer.softconnect.net.br', required: false })
  managerUrl?: string;

  @ApiProperty({ description: 'API Key do gerenciador', example: 'token-portainer', required: false })
  managerApiKey?: string;

  @ApiProperty({ description: 'Ativa ou desativa a VPS', example: true, required: false })
  isActive?: boolean;

  @ApiProperty({ description: 'URL do system-monitor na VPS', example: 'https://monitor.evo01.softconnect.net.br', required: false })
  monitorUrl?: string;

  @ApiProperty({ description: 'API Key do system-monitor (re-criptografada ao alterar)', example: 'chave-monitor-secreta', required: false })
  monitorApiKey?: string;

  @ApiProperty({ description: 'Anotacoes livres sobre a VPS', example: 'VPS principal do cliente X.', required: false })
  notes?: string;
}
