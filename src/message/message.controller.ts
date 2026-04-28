import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
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
import {
  SendBatchDocumentDto,
  SendBatchDto,
  SendBatchMediaDto,
  SendDocumentDto,
  SendListDto,
  SendMediaDto,
  SendPresenceDto,
  SendStickerDto,
  SendTextDto,
} from './dto/message.dto';
import { MessageService } from './message.service';

@ApiTags('Data Plane — Messages')
@ApiSecurity('apikey')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller('message')
export class MessageController {
  constructor(private readonly service: MessageService) {}

  @Post('sendText/:instanceId')
  @ApiOperation({ summary: 'Enviar mensagem de texto' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: SendTextDto })
  @ApiResponse({ status: 201, description: 'Mensagem enviada' })
  sendText(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
    @Body() dto: SendTextDto,
  ) {
    return this.service.sendText(product, instanceId, dto);
  }

  @Post('sendMedia/:instanceId')
  @ApiOperation({ summary: 'Enviar imagem, vídeo ou áudio' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: SendMediaDto })
  @ApiResponse({ status: 201, description: 'Mídia enviada' })
  sendMedia(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
    @Body() dto: SendMediaDto,
  ) {
    return this.service.sendMedia(product, instanceId, dto);
  }

  @Post('sendDocument/:instanceId')
  @ApiOperation({ summary: 'Enviar documento (PDF, DOCX, etc.)' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: SendDocumentDto })
  @ApiResponse({ status: 201, description: 'Documento enviado' })
  sendDocument(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
    @Body() dto: SendDocumentDto,
  ) {
    return this.service.sendDocument(product, instanceId, dto);
  }

  @Post('sendSticker/:instanceId')
  @ApiOperation({ summary: 'Enviar sticker' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: SendStickerDto })
  @ApiResponse({ status: 201, description: 'Sticker enviado' })
  sendSticker(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
    @Body() dto: SendStickerDto,
  ) {
    return this.service.sendSticker(product, instanceId, dto);
  }

  @Post('sendList/:instanceId')
  @ApiOperation({ summary: 'Enviar lista interativa' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: SendListDto })
  @ApiResponse({ status: 201, description: 'Lista enviada' })
  sendList(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
    @Body() dto: SendListDto,
  ) {
    return this.service.sendList(product, instanceId, dto);
  }

  @Post('sendPresence/:instanceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Atualizar presença da instância (digitando, gravando…)' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: SendPresenceDto })
  @ApiResponse({ status: 204, description: 'Presença atualizada' })
  sendPresence(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
    @Body() dto: SendPresenceDto,
  ) {
    return this.service.sendPresence(product, instanceId, dto);
  }
}

@ApiTags('Data Plane — Messages (Batch)')
@ApiSecurity('apikey')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller('message/batch')
export class MessageBatchController {
  constructor(private readonly service: MessageService) {}

  @Post('send-text/:instanceId')
  @ApiOperation({ summary: 'Enviar textos em lote (assíncrono via BullMQ)' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: SendBatchDto })
  @ApiResponse({ status: 201, description: 'Lote enfileirado — retorna batchJobId' })
  sendBatchText(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
    @Body() dto: SendBatchDto,
  ) {
    return this.service.sendBatch(product, instanceId, dto);
  }

  @Post('send-media/:instanceId')
  @ApiOperation({ summary: 'Enviar mídias em lote (assíncrono via BullMQ)' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: SendBatchMediaDto })
  @ApiResponse({ status: 201, description: 'Lote enfileirado — retorna batchJobId' })
  sendBatchMedia(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
    @Body() dto: SendBatchMediaDto,
  ) {
    return this.service.sendBatchMedia(product, instanceId, dto);
  }

  @Post('send-document/:instanceId')
  @ApiOperation({ summary: 'Enviar documentos em lote (assíncrono via BullMQ)' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: SendBatchDocumentDto })
  @ApiResponse({ status: 201, description: 'Lote enfileirado — retorna batchJobId' })
  sendBatchDocument(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
    @Body() dto: SendBatchDocumentDto,
  ) {
    return this.service.sendBatchDocument(product, instanceId, dto);
  }

  @Get(':jobId/status')
  @ApiOperation({ summary: 'Consultar status de um lote' })
  @ApiParam({ name: 'jobId', description: 'ID do lote retornado pelo endpoint de batch' })
  @ApiResponse({ status: 200, description: 'Status do lote' })
  @ApiResponse({ status: 404, description: 'Lote não encontrado' })
  getBatchStatus(
    @Product() product: AuthCachePayload,
    @Param('jobId') jobId: string,
  ) {
    return this.service.getBatchStatus(product, jobId);
  }

  @Delete(':jobId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancelar/deletar um lote pendente' })
  @ApiParam({ name: 'jobId', description: 'ID do lote a cancelar' })
  @ApiResponse({ status: 204, description: 'Lote removido' })
  @ApiResponse({ status: 404, description: 'Lote não encontrado' })
  deleteBatch(
    @Product() product: AuthCachePayload,
    @Param('jobId') jobId: string,
  ) {
    return this.service.deleteBatch(product, jobId);
  }
}
