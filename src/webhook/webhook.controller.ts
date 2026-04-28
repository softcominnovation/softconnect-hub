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
import { WebhookService } from './webhook.service';
import { SetWebhookDto, ToggleWebhookDto } from './dto/webhook.dto';

@ApiTags('Data Plane — Webhooks')
@ApiSecurity('apikey')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller('webhook')
export class WebhookController {
  constructor(private readonly service: WebhookService) {}

  @Post('set/:instanceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Configurar webhook da instância' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: SetWebhookDto })
  @ApiResponse({ status: 204, description: 'Webhook configurado' })
  setWebhook(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
    @Body() dto: SetWebhookDto,
  ) {
    return this.service.setWebhook(product, instanceId, dto);
  }

  @Get('find/:instanceId')
  @ApiOperation({ summary: 'Consultar webhook da instância' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiResponse({ status: 200, description: 'Configuração do webhook' })
  findWebhook(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
  ) {
    return this.service.findWebhook(product, instanceId);
  }

  @Post('toggle/:instanceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Ativar ou desativar webhook da instância' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: ToggleWebhookDto })
  @ApiResponse({ status: 204, description: 'Estado do webhook atualizado' })
  toggleWebhook(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
    @Body() dto: ToggleWebhookDto,
  ) {
    return this.service.toggleWebhook(product, instanceId, dto);
  }
}
