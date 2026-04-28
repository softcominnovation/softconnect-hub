import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
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
        monitorUrl + '/',
        {
          headers: apiKey ? { apikey: apiKey } : {},
          timeout: 5000,
        },
      );
      return { available: true, ...response.data };
    } catch {
      return { available: false };
    }
  }
}
