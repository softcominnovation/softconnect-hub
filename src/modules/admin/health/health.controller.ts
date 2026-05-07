import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { JwtGuard } from '../../../auth/jwt.guard';
import { HealthCheckService } from './health-check.service';

@ApiTags('Admin — Health')
@ApiBearerAuth()
@Controller('admin/health')
@UseGuards(JwtGuard)
export class HealthController {
  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Retorna o status consolidado de todas as VPS ativas',
  })
  @ApiResponse({ status: 200, description: 'Status de saúde das VPS' })
  getHealth() {
    return this.healthCheckService.getHealthStatus();
  }

  @Get(':vpsId')
  @ApiOperation({ summary: 'Retorna o status de saúde de uma VPS específica' })
  @ApiParam({ name: 'vpsId', description: 'UUID da VPS' })
  @ApiResponse({ status: 200, description: 'Status da VPS' })
  @ApiResponse({ status: 404, description: 'VPS não encontrada' })
  getVpsHealth(@Param('vpsId') vpsId: string) {
    return this.healthCheckService.getVpsHealthStatus(vpsId);
  }

  @Get('hub/metrics')
  @ApiOperation({ summary: 'Retorna métricas de sistema do hub (opcional)' })
  @ApiResponse({
    status: 200,
    description: 'Métricas do hub ou { available: false }',
  })
  async getHubMetrics(): Promise<Record<string, unknown>> {
    const monitorUrl = this.config.get<string>('HUB_MONITOR_URL');
    if (!monitorUrl) return { available: false };

    const apiKey = this.config.get<string>('HUB_MONITOR_API_KEY');

    try {
      const response = await axios.get<Record<string, unknown>>(
        monitorUrl + '/status',
        {
          headers: apiKey ? { 'x-api-key': apiKey } : {},
          timeout: 5000,
        },
      );
      return { available: true, ...response.data };
    } catch {
      return { available: false };
    }
  }
}
