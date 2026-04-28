import { ApiProperty } from '@nestjs/swagger';

export class QuotedMessageDto {
  @ApiProperty({
    description: 'Chave da mensagem a ser citada',
    type: 'object',
    properties: {
      id: { type: 'string', example: 'BAE5F4B73B1F6B50' },
      remoteJid: { type: 'string', example: '5511999990001@s.whatsapp.net' },
      fromMe: { type: 'boolean', example: false },
    },
  })
  key!: { id: string; remoteJid?: string; fromMe?: boolean };
}

export class SendTextDto {
  @ApiProperty({ description: 'Número de destino (DDI+DDD+número)', example: '5511999990001' })
  number!: string;

  @ApiProperty({ description: 'Texto da mensagem', example: 'Olá, tudo bem?' })
  text!: string;

  @ApiProperty({ description: 'Delay antes de enviar (ms)', example: 1200, required: false })
  delay?: number;

  @ApiProperty({ description: 'Mensagem citada (reply)', type: () => QuotedMessageDto, required: false })
  quoted?: QuotedMessageDto;

  @ApiProperty({ description: 'Mencionar todos do grupo', example: false, required: false })
  mentionsEveryOne?: boolean;

  @ApiProperty({ description: 'JIDs específicos a mencionar', type: [String], example: ['5511999990001@s.whatsapp.net'], required: false })
  mentioned?: string[];
}

export class SendMediaDto {
  @ApiProperty({ description: 'Número de destino', example: '5511999990001' })
  number!: string;

  @ApiProperty({ description: 'Tipo da mídia', enum: ['image', 'video', 'document', 'audio'], example: 'image' })
  mediatype!: 'image' | 'video' | 'document' | 'audio';

  @ApiProperty({ description: 'URL pública ou base64 da mídia', example: 'https://example.com/imagem.jpg' })
  media!: string;

  @ApiProperty({ description: 'Legenda da mídia', example: 'Confira o relatório', required: false })
  caption?: string;

  @ApiProperty({ description: 'Nome do arquivo (para document)', example: 'relatorio.pdf', required: false })
  fileName?: string;

  @ApiProperty({ description: 'Delay antes de enviar (ms)', example: 0, required: false })
  delay?: number;

  @ApiProperty({ type: () => QuotedMessageDto, required: false })
  quoted?: QuotedMessageDto;
}

export class SendDocumentDto {
  @ApiProperty({ description: 'Número de destino', example: '5511999990001' })
  number!: string;

  @ApiProperty({ description: 'URL pública ou base64 do documento', example: 'https://example.com/relatorio.pdf' })
  media!: string;

  @ApiProperty({ description: 'Nome do arquivo', example: 'relatorio.pdf' })
  fileName!: string;

  @ApiProperty({ description: 'Legenda', example: 'Segue o relatório', required: false })
  caption?: string;

  @ApiProperty({ description: 'Delay antes de enviar (ms)', example: 0, required: false })
  delay?: number;

  @ApiProperty({ type: () => QuotedMessageDto, required: false })
  quoted?: QuotedMessageDto;
}

export class SendStickerDto {
  @ApiProperty({ description: 'Número de destino', example: '5511999990001' })
  number!: string;

  @ApiProperty({ description: 'URL pública ou base64 do sticker (webp)', example: 'https://example.com/sticker.webp' })
  sticker!: string;

  @ApiProperty({ description: 'Delay antes de enviar (ms)', example: 0, required: false })
  delay?: number;

  @ApiProperty({ type: () => QuotedMessageDto, required: false })
  quoted?: QuotedMessageDto;
}

export class SendPresenceDto {
  @ApiProperty({ description: 'Número de destino', example: '5511999990001' })
  number!: string;

  @ApiProperty({
    description: 'Tipo de presença a simular',
    enum: ['unavailable', 'available', 'composing', 'recording', 'paused'],
    example: 'composing',
  })
  presence!: 'unavailable' | 'available' | 'composing' | 'recording' | 'paused';

  @ApiProperty({ description: 'Delay antes de enviar (ms)', example: 0, required: false })
  delay?: number;
}

class ListRowDto {
  @ApiProperty({ example: 'Opção A' })
  title!: string;

  @ApiProperty({ example: 'Descrição da opção', required: false })
  description?: string;

  @ApiProperty({ example: 'row-1' })
  rowId!: string;
}

class ListSectionDto {
  @ApiProperty({ example: 'Seção 1' })
  title!: string;

  @ApiProperty({ type: [ListRowDto] })
  rows!: ListRowDto[];
}

export class SendListDto {
  @ApiProperty({ description: 'Número de destino', example: '5511999990001' })
  number!: string;

  @ApiProperty({ description: 'Título da mensagem', example: 'Cardápio' })
  title!: string;

  @ApiProperty({ description: 'Descrição/corpo', example: 'Escolha seu prato' })
  description!: string;

  @ApiProperty({ description: 'Texto do botão que abre a lista', example: 'Ver opções' })
  buttonText!: string;

  @ApiProperty({ description: 'Texto do rodapé', example: 'Softcom', required: false })
  footerText?: string;

  @ApiProperty({ type: [ListSectionDto], description: 'Seções com linhas de opções' })
  sections!: ListSectionDto[];

  @ApiProperty({ description: 'Delay antes de enviar (ms)', example: 0, required: false })
  delay?: number;

  @ApiProperty({ type: () => QuotedMessageDto, required: false })
  quoted?: QuotedMessageDto;
}

export class SendBatchDto {
  @ApiProperty({ description: 'Lista de mensagens de texto para envio em lote', type: [SendTextDto] })
  messages!: SendTextDto[];

  @ApiProperty({ description: 'Delay entre cada mensagem do lote (ms)', example: 1000, required: false })
  delayMs?: number;
}

export class SendBatchMediaDto {
  @ApiProperty({ description: 'Lista de mensagens de mídia para envio em lote', type: [SendMediaDto] })
  messages!: SendMediaDto[];

  @ApiProperty({ description: 'Delay entre cada mensagem do lote (ms)', example: 1000, required: false })
  delayMs?: number;
}

export class SendBatchDocumentDto {
  @ApiProperty({ description: 'Lista de documentos para envio em lote', type: [SendDocumentDto] })
  messages!: SendDocumentDto[];

  @ApiProperty({ description: 'Delay entre cada mensagem do lote (ms)', example: 1000, required: false })
  delayMs?: number;
}
