import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBody,
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
import { ChatService } from './chat.service';
import {
  CheckNumberDto,
  FindChatsDto,
  FindContactsDto,
  FindMessagesDto,
} from './dto/chat.dto';

@ApiTags('Data Plane — Chat')
@ApiSecurity('apikey')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly service: ChatService) {}

  @Post('checkNumber/:instanceId')
  @ApiOperation({ summary: 'Verificar números no WhatsApp' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: CheckNumberDto })
  @ApiResponse({ status: 201, description: 'Resultado da verificação' })
  checkNumber(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
    @Body() dto: CheckNumberDto,
  ) {
    return this.service.checkNumber(product, instanceId, dto);
  }

  @Post('findChats/:instanceId')
  @ApiOperation({ summary: 'Buscar conversas' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: FindChatsDto })
  @ApiResponse({ status: 201, description: 'Lista de conversas' })
  findChats(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
    @Body() dto: FindChatsDto,
  ) {
    return this.service.findChats(product, instanceId, dto);
  }

  @Post('findMessages/:instanceId')
  @ApiOperation({ summary: 'Buscar mensagens' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: FindMessagesDto })
  @ApiResponse({ status: 201, description: 'Lista de mensagens' })
  findMessages(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
    @Body() dto: FindMessagesDto,
  ) {
    return this.service.findMessages(product, instanceId, dto);
  }

  @Post('findContacts/:instanceId')
  @ApiOperation({ summary: 'Buscar contatos' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: FindContactsDto })
  @ApiResponse({ status: 201, description: 'Lista de contatos' })
  findContacts(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
    @Body() dto: FindContactsDto,
  ) {
    return this.service.findContacts(product, instanceId, dto);
  }
}
