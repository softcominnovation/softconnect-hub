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
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtGuard } from '../../../auth/jwt.guard';
import { CreateInstanceDto } from '../../instance/dto/create-instance.dto';
import { SendPresenceDto, SendTextDto } from '../../message/dto/message.dto';
import { AdminInstancesService } from './admin-instances.service';

@ApiTags('Admin — Instances')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('admin/products/:productId/instances')
export class AdminInstancesController {
  constructor(private readonly service: AdminInstancesService) {}

  @Post()
  @ApiOperation({ summary: 'Criar instância em nome de um produto' })
  @ApiParam({ name: 'productId', description: 'UUID do produto' })
  @ApiBody({ type: CreateInstanceDto })
  @ApiResponse({ status: 201, description: 'Instância criada' })
  @ApiResponse({
    status: 404,
    description: 'Produto não encontrado',
  })
  create(
    @Param('productId') productId: string,
    @Body() dto: CreateInstanceDto,
  ) {
    return this.service.createInstance(productId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar instâncias de um produto' })
  @ApiParam({ name: 'productId', description: 'UUID do produto' })
  @ApiResponse({ status: 200, description: 'Lista de instâncias' })
  @ApiResponse({
    status: 404,
    description: 'Produto não encontrado',
  })
  list(@Param('productId') productId: string) {
    return this.service.listInstances(productId);
  }

  @Get('hub')
  @ApiOperation({
    summary: 'Listar instâncias do Hub (somente banco, sem consultar o provider)',
  })
  @ApiParam({ name: 'productId', description: 'UUID do produto' })
  @ApiResponse({ status: 200, description: 'Lista de instâncias cadastradas no Hub' })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  listHubInstances(@Param('productId') productId: string) {
    return this.service.listHubInstances(productId);
  }

  @Get('hub/:instanceId')
  @ApiOperation({
    summary: 'Buscar instância do Hub por ID (somente banco, sem consultar o provider)',
  })
  @ApiParam({ name: 'productId', description: 'UUID do produto' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiResponse({ status: 200, description: 'Dados da instância no Hub' })
  @ApiResponse({ status: 404, description: 'Produto ou instância não encontrado' })
  getHubInstance(
    @Param('productId') productId: string,
    @Param('instanceId') instanceId: string,
  ) {
    return this.service.getHubInstance(productId, instanceId);
  }

  @Get(':instanceId')
  @ApiOperation({ summary: 'Buscar dados de uma instância' })
  @ApiParam({ name: 'productId', description: 'UUID do produto' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiResponse({ status: 200, description: 'Dados da instância' })
  @ApiResponse({
    status: 404,
    description: 'Produto ou instância não encontrado',
  })
  fetchInstance(
    @Param('productId') productId: string,
    @Param('instanceId') instanceId: string,
  ) {
    return this.service.fetchInstance(productId, instanceId);
  }

  @Get(':instanceId/connect')
  @ApiOperation({
    summary: 'Conectar instância — retorna QR code ou state:open',
  })
  @ApiParam({ name: 'productId', description: 'UUID do produto' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiResponse({ status: 200, description: 'QR code ou estado open' })
  @ApiResponse({
    status: 404,
    description: 'Produto ou instância não encontrado',
  })
  connect(
    @Param('productId') productId: string,
    @Param('instanceId') instanceId: string,
  ) {
    return this.service.connectInstance(productId, instanceId);
  }

  @Get(':instanceId/status')
  @ApiOperation({ summary: 'Estado de conexão da instância' })
  @ApiParam({ name: 'productId', description: 'UUID do produto' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiResponse({ status: 200, description: 'Estado atual da conexão' })
  @ApiResponse({
    status: 404,
    description: 'Produto ou instância não encontrado',
  })
  status(
    @Param('productId') productId: string,
    @Param('instanceId') instanceId: string,
  ) {
    return this.service.getConnectionState(productId, instanceId);
  }

  @Post(':instanceId/restart')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reiniciar instância' })
  @ApiParam({ name: 'productId', description: 'UUID do produto' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiResponse({ status: 204, description: 'Instância reiniciada' })
  @ApiResponse({
    status: 404,
    description: 'Produto ou instância não encontrado',
  })
  restart(
    @Param('productId') productId: string,
    @Param('instanceId') instanceId: string,
  ) {
    return this.service.restartInstance(productId, instanceId);
  }

  @Post(':instanceId/disconnect')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deslogar instância do WhatsApp' })
  @ApiParam({ name: 'productId', description: 'UUID do produto' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiResponse({ status: 204, description: 'Logout realizado' })
  @ApiResponse({
    status: 404,
    description: 'Produto ou instância não encontrado',
  })
  disconnect(
    @Param('productId') productId: string,
    @Param('instanceId') instanceId: string,
  ) {
    return this.service.disconnectInstance(productId, instanceId);
  }

  @Delete(':instanceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deletar instância' })
  @ApiParam({ name: 'productId', description: 'UUID do produto' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiResponse({ status: 204, description: 'Instância deletada' })
  @ApiResponse({
    status: 404,
    description: 'Produto ou instância não encontrado',
  })
  delete(
    @Param('productId') productId: string,
    @Param('instanceId') instanceId: string,
  ) {
    return this.service.deleteInstance(productId, instanceId);
  }

  @Post(':instanceId/sendText')
  @ApiOperation({ summary: 'Enviar mensagem de texto pela instância' })
  @ApiParam({ name: 'productId', description: 'UUID do produto' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: SendTextDto })
  @ApiResponse({ status: 201, description: 'Mensagem enviada' })
  @ApiResponse({
    status: 404,
    description: 'Produto ou instância não encontrado',
  })
  sendText(
    @Param('productId') productId: string,
    @Param('instanceId') instanceId: string,
    @Body() dto: SendTextDto,
  ) {
    return this.service.sendText(productId, instanceId, dto);
  }

  @Post(':instanceId/sendPresence')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Enviar presença (digitando, gravando...)' })
  @ApiParam({ name: 'productId', description: 'UUID do produto' })
  @ApiParam({ name: 'instanceId', description: 'UUID da instância no Hub' })
  @ApiBody({ type: SendPresenceDto })
  @ApiResponse({ status: 204, description: 'Presença enviada' })
  @ApiResponse({
    status: 404,
    description: 'Produto ou instância não encontrado',
  })
  sendPresence(
    @Param('productId') productId: string,
    @Param('instanceId') instanceId: string,
    @Body() dto: SendPresenceDto,
  ) {
    return this.service.sendPresence(productId, instanceId, dto);
  }
}
