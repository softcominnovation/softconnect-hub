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
import { JwtGuard } from '../../auth/jwt.guard';
import { CreateVpsDto } from './dto/create-vps.dto';
import { UpdateVpsDto } from './dto/update-vps.dto';
import { VpsService } from './vps.service';

@ApiTags('Admin — VPS')
@ApiBearerAuth()
@Controller('admin/vps')
@UseGuards(JwtGuard)
export class VpsController {
  constructor(private readonly vpsService: VpsService) {}

  @Post()
  @ApiOperation({ summary: 'Cadastra uma nova VPS' })
  @ApiBody({ type: CreateVpsDto })
  @ApiResponse({ status: 201, description: 'VPS cadastrada' })
  create(@Body() dto: CreateVpsDto) {
    return this.vpsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista todas as VPS' })
  @ApiResponse({ status: 200, description: 'Lista de VPS' })
  findAll() {
    return this.vpsService.findAll();
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualiza uma VPS' })
  @ApiParam({ name: 'id', description: 'UUID da VPS', example: 'uuid-da-vps' })
  @ApiBody({ type: UpdateVpsDto })
  @ApiResponse({ status: 200, description: 'VPS atualizada' })
  update(@Param('id') id: string, @Body() dto: UpdateVpsDto) {
    return this.vpsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Desativa uma VPS' })
  @ApiParam({ name: 'id', description: 'UUID da VPS', example: 'uuid-da-vps' })
  @ApiResponse({ status: 200, description: 'VPS desativada' })
  deactivate(@Param('id') id: string) {
    return this.vpsService.deactivate(id);
  }
}
