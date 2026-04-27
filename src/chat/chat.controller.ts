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
  CheckNumberDto,
  FindChatsDto,
  FindContactsDto,
  FindMessagesDto,
} from '../providers/whatsapp-provider.interface';
import { ChatService } from './chat.service';

@ApiTags('Data Plane — Chat')
@ApiSecurity('apikey')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly service: ChatService) {}

  @Post('whatsappNumbers/:instance')
  @ApiOperation({ summary: 'Verificar números no WhatsApp' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 201, description: 'Resultado da verificação' })
  checkNumber(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
    @Body() dto: CheckNumberDto,
  ) {
    return this.service.checkNumber(product, instance, dto);
  }

  @Post('findChats/:instance')
  @ApiOperation({ summary: 'Buscar conversas' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 201, description: 'Lista de conversas' })
  findChats(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
    @Body() dto: FindChatsDto,
  ) {
    return this.service.findChats(product, instance, dto);
  }

  @Post('findMessages/:instance')
  @ApiOperation({ summary: 'Buscar mensagens' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 201, description: 'Lista de mensagens' })
  findMessages(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
    @Body() dto: FindMessagesDto,
  ) {
    return this.service.findMessages(product, instance, dto);
  }

  @Post('findContacts/:instance')
  @ApiOperation({ summary: 'Buscar contatos' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 201, description: 'Lista de contatos' })
  findContacts(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
    @Body() dto: FindContactsDto,
  ) {
    return this.service.findContacts(product, instance, dto);
  }
}
