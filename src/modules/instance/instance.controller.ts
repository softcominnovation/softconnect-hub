import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
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
  @ApiResponse({ status: 201, description: 'Instância criada — retorna hubId na resposta' })
  create(@Product() product: AuthCachePayload, @Body() dto: CreateInstanceDto) {
    return this.service.createInstance(product, dto);
  }

  @Get('list')
  @ApiOperation({ summary: 'Listar instâncias do produto' })
  @ApiQuery({
    name: 'instance_name',
    required: false,
    description:
      'Filtro opcional por pedaço do nome da instância (case-insensitive)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Objeto do provider com hubId injetado em cada instância do produto',
  })
  list(
    @Product() product: AuthCachePayload,
    @Query('instance_name') instanceName?: string,
  ) {
    return this.service.listInstances(product, instanceName);
  }

  @Get(':instanceId')
  @ApiOperation({ summary: 'Buscar dados de uma instância específica' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância (hubId ou id do provider)' })
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
  @ApiParam({ name: 'instanceId', description: 'UUID da instância (hubId ou id do provider)' })
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
  @ApiParam({ name: 'instanceId', description: 'UUID da instância (hubId ou id do provider)' })
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
  @ApiParam({ name: 'instanceId', description: 'UUID da instância (hubId ou id do provider)' })
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
  @ApiParam({ name: 'instanceId', description: 'UUID da instância (hubId ou id do provider)' })
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
  @ApiParam({ name: 'instanceId', description: 'UUID da instância (hubId ou id do provider)' })
  @ApiResponse({ status: 204, description: 'Instância deletada no provider e no Hub' })
  @ApiResponse({ status: 404, description: 'Instância não encontrada' })
  @ApiResponse({
    status: 502,
    description:
      'Falha ao deletar no provider — registro no Hub mantido (sem dessincronização)',
  })
  delete(
    @Product() product: AuthCachePayload,
    @Param('instanceId') instanceId: string,
  ) {
    return this.service.deleteInstance(product, instanceId);
  }
}
