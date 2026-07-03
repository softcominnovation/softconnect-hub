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
import type { AuthCachePayload } from '../../auth/apikey.guard';
import { ApiKeyGuard } from '../../auth/apikey.guard';
import { RateLimitGuard } from '../../auth/rate-limit.guard';
import { Product } from '../../common/decorators/product.decorator';
import { CreateInstanceDto } from './dto/create-instance.dto';
import { InstanceService } from './instance.service';

@ApiTags('Data Plane — Instances')
@ApiSecurity('apikey')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller('instance')
export class InstanceController {
  constructor(private readonly service: InstanceService) {}

  @Post('create')
  @ApiOperation({ summary: 'Criar instância no provider' })
  @ApiBody({ type: CreateInstanceDto })
  @ApiResponse({ status: 201, description: 'Instância criada — retorna id (UUID Hub) na resposta' })
  create(@Product() product: AuthCachePayload, @Body() dto: CreateInstanceDto) {
    return this.service.createInstance(product, dto);
  }

  @Get('list')
  @ApiOperation({ summary: 'Listar instâncias do produto' })
  @ApiResponse({ status: 200, description: 'Lista de instâncias com id (UUID Hub) em cada item' })
  list(@Product() product: AuthCachePayload) {
    return this.service.listInstances(product);
  }

  @Get(':instanceId')
  @ApiOperation({ summary: 'Buscar dados de uma instância específica' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiResponse({ status: 200, description: 'Dados da instância' })
  @ApiResponse({ status: 404, description: 'Instância não encontrada' })
  fetchInstance(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
  ) {
    return this.service.fetchInstance(product, instanceId);
  }

  @Get(':instanceId/connect')
  @ApiOperation({ summary: 'Conectar instância — retorna QR code ou state:open (polimórfico)' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiResponse({ status: 200, description: 'QR code (base64) ou estado open' })
  @ApiResponse({ status: 404, description: 'Instância não encontrada' })
  connect(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
  ) {
    return this.service.connectInstance(product, instanceId);
  }

  @Get(':instanceId/status')
  @ApiOperation({ summary: 'Estado de conexão da instância' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiResponse({ status: 200, description: 'Estado atual da conexão' })
  @ApiResponse({ status: 404, description: 'Instância não encontrada' })
  status(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
  ) {
    return this.service.getConnectionState(product, instanceId);
  }

  @Post(':instanceId/restart')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reiniciar instância' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiResponse({ status: 204, description: 'Instância reiniciada' })
  @ApiResponse({ status: 404, description: 'Instância não encontrada' })
  restart(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
  ) {
    return this.service.restartInstance(product, instanceId);
  }

  @Post(':instanceId/disconnect')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deslogar instância do WhatsApp' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiResponse({ status: 204, description: 'Logout realizado' })
  @ApiResponse({ status: 404, description: 'Instância não encontrada' })
  disconnect(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
  ) {
    return this.service.logoutInstance(product, instanceId);
  }

  @Delete(':instanceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deletar instância' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiResponse({ status: 204, description: 'Instância deletada' })
  @ApiResponse({ status: 404, description: 'Instância não encontrada' })
  delete(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
  ) {
    return this.service.deleteInstance(product, instanceId);
  }
}
