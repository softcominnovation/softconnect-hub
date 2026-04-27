import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
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
import type { SetWebhookDto } from '../providers/whatsapp-provider.interface';
import { WebhookService } from './webhook.service';

@ApiTags('Data Plane — Webhooks')
@ApiSecurity('apikey')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller('webhook')
export class WebhookController {
  constructor(private readonly service: WebhookService) {}

  @Post('set/:instance')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Configurar webhook da instância' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 204, description: 'Webhook configurado' })
  setWebhook(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
    @Body() dto: SetWebhookDto,
  ) {
    return this.service.setWebhook(product, instance, dto);
  }

  @Get('find/:instance')
  @ApiOperation({ summary: 'Consultar webhook da instância' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 200, description: 'Configuração do webhook' })
  findWebhook(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
  ) {
    return this.service.findWebhook(product, instance);
  }
}
