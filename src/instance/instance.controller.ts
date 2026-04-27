import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
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
import type { CreateInstanceDto } from '../providers/whatsapp-provider.interface';
import { InstanceService } from './instance.service';

@ApiTags('Data Plane — Instances')
@ApiSecurity('apikey')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller('instance')
export class InstanceController {
  constructor(private readonly service: InstanceService) {}

  @Post('create')
  @ApiOperation({ summary: 'Criar instância no provider' })
  @ApiResponse({ status: 201, description: 'Instância criada com sucesso' })
  create(@Product() product: AuthCachePayload, @Body() dto: CreateInstanceDto) {
    return this.service.createInstance(product, dto);
  }

  @Get('fetchInstances')
  @ApiOperation({ summary: 'Listar instâncias do produto' })
  @ApiResponse({ status: 200, description: 'Lista de instâncias' })
  fetchInstances(@Product() product: AuthCachePayload) {
    return this.service.fetchInstances(product);
  }

  @Get('connect/:instance')
  @ApiOperation({ summary: 'Conectar instância (obter QR code)' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 200, description: 'Dados de conexão' })
  connect(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
  ) {
    return this.service.connectInstance(product, instance);
  }

  @Get('connectionState/:instance')
  @ApiOperation({ summary: 'Estado de conexão da instância' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 200, description: 'Estado atual da conexão' })
  connectionState(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
  ) {
    return this.service.getConnectionState(product, instance);
  }

  @Put('restart/:instance')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reiniciar instância' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 204, description: 'Instância reiniciada' })
  restart(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
  ) {
    return this.service.restartInstance(product, instance);
  }

  @Delete('logout/:instance')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deslogar instância do WhatsApp' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 204, description: 'Logout realizado' })
  logout(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
  ) {
    return this.service.logoutInstance(product, instance);
  }

  @Delete('delete/:instance')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deletar instância' })
  @ApiParam({ name: 'instance', description: 'Nome da instância' })
  @ApiResponse({ status: 204, description: 'Instância deletada' })
  delete(
    @Product() product: AuthCachePayload,
    @Param('instance') instance: string,
  ) {
    return this.service.deleteInstance(product, instance);
  }
}
