import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtGuard } from '../../../auth/jwt.guard';
import { LogsService } from './logs.service';

@ApiTags('Admin — Logs')
@ApiBearerAuth()
@Controller('admin/logs')
@UseGuards(JwtGuard)
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  @ApiOperation({ summary: 'Consulta paginada de logs de auditoria' })
  @ApiQuery({
    name: 'productId',
    required: false,
    description: 'Filtrar por produto (UUID)',
  })
  @ApiQuery({
    name: 'instanceId',
    required: false,
    description: 'Filtrar por instância (UUID)',
  })
  @ApiQuery({
    name: 'statusCode',
    required: false,
    description: 'Filtrar por código HTTP (ex: 200, 401, 500)',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Data de início ISO 8601 (ex: 2026-04-01T00:00:00Z)',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'Data de fim ISO 8601 (ex: 2026-04-30T23:59:59Z)',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Página (padrão: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Itens por página (padrão: 50, máx: 200)',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de logs de auditoria',
  })
  findLogs(
    @Query('productId') productId?: string,
    @Query('instanceId') instanceId?: string,
    @Query('statusCode') statusCode?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.logsService.findLogs({
      productId,
      instanceId,
      statusCode: statusCode ? parseInt(statusCode, 10) : undefined,
      from,
      to,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
