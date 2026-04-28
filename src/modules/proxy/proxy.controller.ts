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
import type { AuthCachePayload } from '../../auth/apikey.guard';
import { ApiKeyGuard } from '../../auth/apikey.guard';
import { RateLimitGuard } from '../../auth/rate-limit.guard';
import { Product } from '../../common/decorators/product.decorator';
import { SetProxyDto } from './dto/proxy.dto';
import { ProxyService } from './proxy.service';

@ApiTags('Data Plane — Proxy')
@ApiSecurity('apikey')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller('proxy')
export class ProxyController {
  constructor(private readonly service: ProxyService) {}

  @Post('set/:instanceId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Configurar proxy da instância' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: SetProxyDto })
  @ApiResponse({ status: 200, description: 'Proxy configurado' })
  setProxy(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
    @Body() dto: SetProxyDto,
  ) {
    return this.service.setProxy(product, instanceId, dto);
  }

  @Get('find/:instanceId')
  @ApiOperation({ summary: 'Consultar proxy da instância' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiResponse({ status: 200, description: 'Configuração do proxy' })
  findProxy(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
  ) {
    return this.service.findProxy(product, instanceId);
  }
}
