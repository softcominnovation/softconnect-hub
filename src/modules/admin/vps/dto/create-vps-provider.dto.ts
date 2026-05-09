import { ApiProperty } from '@nestjs/swagger';

export class CreateVpsProviderDto {
  @ApiProperty({
    description: 'Label identificador do provider (ex: "Evolution A")',
    example: 'Evolution A',
  })
  label!: string;

  @ApiProperty({
    description: 'URL base do provider nesta VPS',
    example: 'https://evo-a.softconnect.net.br',
  })
  providerUrl!: string;

  @ApiProperty({
    description: 'API Key do provider (armazenada criptografada)',
    example: 'chave-secreta-evolution',
  })
  providerApiKey!: string;

  @ApiProperty({
    description: 'Tipo do adapter',
    example: 'evolution',
    required: false,
  })
  adapterType?: string;
}
