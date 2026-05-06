import {
  Body,
  Controller,
  Delete,
  Get,
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
  WebhookConfigResponseDto,
} from './dto/webhook-config.dto';
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
}
