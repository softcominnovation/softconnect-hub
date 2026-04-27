import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthCachePayload } from '../auth/apikey.guard';
import { ApiKeyGuard } from '../auth/apikey.guard';
import { RateLimitGuard } from '../auth/rate-limit.guard';
import { Product } from '../common/decorators/product.decorator';
import type {
  SendAudioDto,
  SendButtonsDto,
  SendContactDto,
  SendListDto,
  SendLocationDto,
  SendMediaDto,
  SendReactionDto,
  SendTextDto,
} from '../providers/whatsapp-provider.interface';
import { MessageService } from './message.service';

@ApiTags('Data Plane — Messages')
@ApiSecurity('apikey')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller('message')
export class MessageController {
  constructor(private readonly service: MessageService) {}

  @Post('sendText/:instance')
  @ApiOperation({ summary: 'Enviar mensagem de texto' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 201, description: 'Mensagem enviada' })
  sendText(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
    @Body() dto: SendTextDto,
  ) {
    return this.service.sendText(product, instance, dto);
  }

  @Post('sendMedia/:instance')
  @ApiOperation({ summary: 'Enviar mensagem com mídia' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 201, description: 'Mídia enviada' })
  sendMedia(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
    @Body() dto: SendMediaDto,
  ) {
    return this.service.sendMedia(product, instance, dto);
  }

  @Post('sendWhatsAppAudio/:instance')
  @ApiOperation({ summary: 'Enviar áudio WhatsApp (PTT)' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 201, description: 'Áudio enviado' })
  sendWhatsAppAudio(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
    @Body() dto: SendAudioDto,
  ) {
    return this.service.sendWhatsAppAudio(product, instance, dto);
  }

  @Post('sendButtons/:instance')
  @ApiOperation({ summary: 'Enviar mensagem com botões' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 201, description: 'Botões enviados' })
  sendButtons(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
    @Body() dto: SendButtonsDto,
  ) {
    return this.service.sendButtons(product, instance, dto);
  }

  @Post('sendList/:instance')
  @ApiOperation({ summary: 'Enviar lista interativa' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 201, description: 'Lista enviada' })
  sendList(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
    @Body() dto: SendListDto,
  ) {
    return this.service.sendList(product, instance, dto);
  }

  @Post('sendLocation/:instance')
  @ApiOperation({ summary: 'Enviar localização' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 201, description: 'Localização enviada' })
  sendLocation(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
    @Body() dto: SendLocationDto,
  ) {
    return this.service.sendLocation(product, instance, dto);
  }

  @Post('sendContact/:instance')
  @ApiOperation({ summary: 'Enviar contato' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 201, description: 'Contato enviado' })
  sendContact(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
    @Body() dto: SendContactDto,
  ) {
    return this.service.sendContact(product, instance, dto);
  }

  @Post('sendReaction/:instance')
  @ApiOperation({ summary: 'Enviar reação a mensagem' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 201, description: 'Reação enviada' })
  sendReaction(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
    @Body() dto: SendReactionDto,
  ) {
    return this.service.sendReaction(product, instance, dto);
  }
}
