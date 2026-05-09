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
import { CreateVpsProviderDto } from './dto/create-vps-provider.dto';
import { UpdateVpsProviderDto } from './dto/update-vps-provider.dto';
import { VpsProviderService } from './vps-provider.service';

@ApiTags('Admin — VPS Providers')
@ApiBearerAuth()
@Controller('admin/vps/:vpsId/providers')
@UseGuards(JwtGuard)
export class VpsProviderController {
  constructor(private readonly vpsProviderService: VpsProviderService) {}

  @Post()
  @ApiOperation({ summary: 'Adiciona um provider (endpoint Evolution) à VPS' })
  @ApiParam({ name: 'vpsId', description: 'UUID da VPS' })
  @ApiBody({ type: CreateVpsProviderDto })
  @ApiResponse({ status: 201, description: 'Provider criado' })
  create(@Param('vpsId') vpsId: string, @Body() dto: CreateVpsProviderDto) {
    return this.vpsProviderService.create(vpsId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista providers ativos da VPS' })
  @ApiParam({ name: 'vpsId', description: 'UUID da VPS' })
  @ApiResponse({ status: 200, description: 'Lista de providers' })
  findAll(@Param('vpsId') vpsId: string) {
    return this.vpsProviderService.findAll(vpsId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualiza um provider da VPS' })
  @ApiParam({ name: 'vpsId', description: 'UUID da VPS' })
  @ApiParam({ name: 'id', description: 'UUID do provider' })
  @ApiBody({ type: UpdateVpsProviderDto })
  @ApiResponse({ status: 200, description: 'Provider atualizado' })
  update(
    @Param('vpsId') vpsId: string,
    @Param('id') id: string,
    @Body() dto: UpdateVpsProviderDto,
  ) {
    return this.vpsProviderService.update(vpsId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Desativa um provider da VPS' })
  @ApiParam({ name: 'vpsId', description: 'UUID da VPS' })
  @ApiParam({ name: 'id', description: 'UUID do provider' })
  @ApiResponse({ status: 200, description: 'Provider desativado' })
  deactivate(@Param('vpsId') vpsId: string, @Param('id') id: string) {
    return this.vpsProviderService.deactivate(vpsId, id);
  }
}
