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
}
