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
import { SetSettingsDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('Data Plane — Settings')
@ApiSecurity('apikey')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Post('set/:instanceId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Configurar settings da instância' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: SetSettingsDto })
  @ApiResponse({ status: 200, description: 'Settings atualizados' })
  setSettings(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
    @Body() dto: SetSettingsDto,
  ) {
    return this.service.setSettings(product, instanceId, dto);
  }

  @Get('find/:instanceId')
  @ApiOperation({ summary: 'Consultar settings da instância' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiResponse({ status: 200, description: 'Settings da instância' })
  findSettings(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
  ) {
    return this.service.findSettings(product, instanceId);
  }
}
