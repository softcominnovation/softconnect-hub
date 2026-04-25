import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtGuard } from '../../auth/jwt.guard';
import { AdminActivityService } from './activity.service';

@ApiTags('Admin — Activity Log')
@ApiBearerAuth()
@Controller('admin/activity')
@UseGuards(JwtGuard)
export class AdminActivityController {
  constructor(private readonly activityService: AdminActivityService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista o log de atividades dos usuários admin (paginado)',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Página (padrão: 1)',
    example: 1,
    type: Number,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Itens por página (padrão: 20)',
    example: 20,
    type: Number,
  })
  @ApiQuery({
    name: 'adminUserId',
    required: false,
    description: 'Filtrar por UUID do usuário admin',
    example: 'uuid-do-admin',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Data inicial (ISO 8601)',
    example: '2026-01-01T00:00:00.000Z',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'Data final (ISO 8601)',
    example: '2026-12-31T23:59:59.999Z',
  })
  @ApiResponse({ status: 200, description: 'Lista de atividades' })
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('adminUserId') adminUserId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.activityService.findAll({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      adminUserId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }
}
