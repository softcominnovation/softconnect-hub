import { ApiProperty } from '@nestjs/swagger';

export class UpdateVpsProviderDto {
  @ApiProperty({
    description: 'Label identificador do provider',
    example: 'Evolution A - Atualizado',
    required: false,
  })
  label?: string;

  @ApiProperty({
    description: 'URL base do provider',
    example: 'https://evo-a.softconnect.net.br',
    required: false,
  })
  providerUrl?: string;

  @ApiProperty({
    description: 'API Key do provider (re-criptografada ao alterar)',
    example: 'nova-chave-secreta',
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
    description: 'Ativa ou desativa o provider',
    example: true,
    required: false,
  })
  isActive?: boolean;
}
