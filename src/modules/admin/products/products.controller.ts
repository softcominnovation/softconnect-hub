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
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtGuard } from '../../../auth/jwt.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  SetWebhookConfigDto,
  SyncRelayDto,
  SyncRelayResultDto,
  ToggleWebhookBulkDto,
  ToggleWebhookBulkResultDto,
  WebhookConfigResponseDto,
} from './dto/webhook-config.dto';
import {
  InstanceDefaultProxyResponseDto,
  InstanceDefaultWebhookResponseDto,
  SetInstanceDefaultProxyDto,
  SetInstanceDefaultWebhookDto,
} from './dto/instance-defaults.dto';
import { ProductsService } from './products.service';

@ApiTags('Admin — Products')
@ApiBearerAuth()
@Controller('admin/products')
@UseGuards(JwtGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um novo produto e gera uma API Key' })
  @ApiBody({ type: CreateProductDto })
  @ApiResponse({
    status: 201,
    description: 'Produto criado com API Key gerada',
  })
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista todos os produtos' })
  @ApiResponse({ status: 200, description: 'Lista de produtos' })
  findAll() {
    return this.productsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca um produto por ID' })
  @ApiParam({
    name: 'id',
    description: 'UUID do produto',
    example: 'uuid-do-produto',
  })
  @ApiResponse({ status: 200, description: 'Produto encontrado' })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualiza um produto' })
  @ApiParam({
    name: 'id',
    description: 'UUID do produto',
    example: 'uuid-do-produto',
  })
  @ApiBody({ type: UpdateProductDto })
  @ApiResponse({ status: 200, description: 'Produto atualizado' })
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Desativa um produto' })
  @ApiParam({
    name: 'id',
    description: 'UUID do produto',
    example: 'uuid-do-produto',
  })
  @ApiResponse({ status: 200, description: 'Produto desativado' })
  deactivate(@Param('id') id: string) {
    return this.productsService.deactivate(id);
  }

  @Post(':id/rotate-key')
  @ApiOperation({
    summary:
      'Rotaciona a API Key do produto — invalida a antiga e retorna nova key uma única vez',
  })
  @ApiParam({ name: 'id', description: 'UUID do produto' })
  @ApiResponse({ status: 201, description: 'Nova API Key gerada' })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  rotateKey(@Param('id') id: string) {
    return this.productsService.rotateKey(id);
  }

  @Put(':id/webhook-config')
  @ApiOperation({
    summary:
      'Cadastra ou atualiza a configuração de relay webhook do produto — URL para onde o Hub entregará os eventos quando hubRelay estiver ativo',
  })
  @ApiParam({ name: 'id', description: 'UUID do produto' })
  @ApiBody({ type: SetWebhookConfigDto })
  @ApiResponse({
    status: 200,
    description: 'WebhookConfig salva',
    type: WebhookConfigResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  setWebhookConfig(@Param('id') id: string, @Body() dto: SetWebhookConfigDto) {
    return this.productsService.setWebhookConfig(id, dto);
  }

  @Get(':id/webhook-config')
  @ApiOperation({
    summary: 'Consulta a configuração de relay webhook do produto',
  })
  @ApiParam({ name: 'id', description: 'UUID do produto' })
  @ApiResponse({
    status: 200,
    description: 'WebhookConfig atual ou null',
    type: WebhookConfigResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  getWebhookConfig(@Param('id') id: string) {
    return this.productsService.getWebhookConfig(id);
  }

  @Post(':id/sync-relay')
  @ApiOperation({
    summary: 'Sincroniza o webhook das instâncias do produto na Evolution',
    description:
      'Quando hubRelay=true, registra a URL do Hub em todas as instâncias (ou apenas em uma, se instanceId for informado). ' +
      'Quando hubRelay=false, desativa o webhook em todas as instâncias afetadas. ' +
      'Use após ativar/desativar o hubRelay do produto para propagar a mudança imediatamente.',
  })
  @ApiParam({ name: 'id', description: 'UUID do produto' })
  @ApiBody({
    type: SyncRelayDto,
    required: false,
    description: 'Opcional — omita para sincronizar todas as instâncias ativas',
  })
  @ApiResponse({
    status: 201,
    description: 'Resultado do sync por instância',
    type: SyncRelayResultDto,
  })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  syncRelay(@Param('id') id: string, @Body() dto?: SyncRelayDto) {
    return this.productsService.syncRelay(id, dto?.instanceId);
  }

  @Post(':id/toggle-webhook')
  @ApiOperation({
    summary: 'Ativa ou desativa o webhook de todas as instâncias do produto',
    description:
      'Chama toggleWebhook na Evolution para cada instância ativa do produto (ou apenas para uma, se instanceId for informado). ' +
      'Útil para pausar/retomar a entrega de eventos sem alterar a configuração de relay.',
  })
  @ApiParam({ name: 'id', description: 'UUID do produto' })
  @ApiBody({ type: ToggleWebhookBulkDto })
  @ApiResponse({
    status: 201,
    description: 'Resultado por instância',
    type: ToggleWebhookBulkResultDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Produto ou instância não encontrado',
  })
  toggleWebhook(@Param('id') id: string, @Body() dto: ToggleWebhookBulkDto) {
    return this.productsService.toggleWebhookBulk(
      id,
      dto.enabled,
      dto.instanceId,
    );
  }

  @Put(':id/instance-defaults/webhook')
  @ApiOperation({
    summary: 'Define o webhook padrão aplicado ao criar novas instâncias (Evolution)',
    description:
      'Quando preenchido, toda nova instância criada via Evolution terá o webhook configurado automaticamente. ' +
      'Campos não informados usam o valor padrão. A configuração é por produto.',
  })
  @ApiParam({ name: 'id', description: 'UUID do produto' })
  @ApiBody({ type: SetInstanceDefaultWebhookDto })
  @ApiResponse({
    status: 200,
    description: 'Webhook padrão salvo',
    type: InstanceDefaultWebhookResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  setInstanceDefaultWebhook(
    @Param('id') id: string,
    @Body() dto: SetInstanceDefaultWebhookDto,
  ) {
    return this.productsService.setInstanceDefaultWebhook(id, dto);
  }

  @Get(':id/instance-defaults/webhook')
  @ApiOperation({ summary: 'Consulta o webhook padrão de instâncias do produto' })
  @ApiParam({ name: 'id', description: 'UUID do produto' })
  @ApiResponse({
    status: 200,
    description: 'Webhook padrão atual ou null',
    type: InstanceDefaultWebhookResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  getInstanceDefaultWebhook(@Param('id') id: string) {
    return this.productsService.getInstanceDefaultWebhook(id);
  }

  @Delete(':id/instance-defaults/webhook')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove o webhook padrão de instâncias do produto' })
  @ApiParam({ name: 'id', description: 'UUID do produto' })
  @ApiResponse({ status: 204, description: 'Webhook padrão removido' })
  @ApiResponse({ status: 404, description: 'Produto ou configuração não encontrado' })
  deleteInstanceDefaultWebhook(@Param('id') id: string) {
    return this.productsService.deleteInstanceDefaultWebhook(id);
  }

  @Put(':id/instance-defaults/proxy')
  @ApiOperation({
    summary: 'Define o proxy padrão aplicado ao criar novas instâncias (Evolution)',
    description:
      'Quando preenchido, toda nova instância criada via Evolution terá o proxy configurado automaticamente.',
  })
  @ApiParam({ name: 'id', description: 'UUID do produto' })
  @ApiBody({ type: SetInstanceDefaultProxyDto })
  @ApiResponse({
    status: 200,
    description: 'Proxy padrão salvo',
    type: InstanceDefaultProxyResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  setInstanceDefaultProxy(
    @Param('id') id: string,
    @Body() dto: SetInstanceDefaultProxyDto,
  ) {
    return this.productsService.setInstanceDefaultProxy(id, dto);
  }

  @Get(':id/instance-defaults/proxy')
  @ApiOperation({ summary: 'Consulta o proxy padrão de instâncias do produto' })
  @ApiParam({ name: 'id', description: 'UUID do produto' })
  @ApiResponse({
    status: 200,
    description: 'Proxy padrão atual ou null',
    type: InstanceDefaultProxyResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  getInstanceDefaultProxy(@Param('id') id: string) {
    return this.productsService.getInstanceDefaultProxy(id);
  }

  @Delete(':id/instance-defaults/proxy')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove o proxy padrão de instâncias do produto' })
  @ApiParam({ name: 'id', description: 'UUID do produto' })
  @ApiResponse({ status: 204, description: 'Proxy padrão removido' })
  @ApiResponse({ status: 404, description: 'Produto ou configuração não encontrado' })
  deleteInstanceDefaultProxy(@Param('id') id: string) {
    return this.productsService.deleteInstanceDefaultProxy(id);
  }
}
