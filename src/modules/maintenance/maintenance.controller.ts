import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '../../auth/jwt.guard';
import { EvolutionInputPipe } from '../admin/evolutions/evolution.dto';
import {
  maintenancePageSchema,
  maintenancePolicySchema,
} from './maintenance.dto';
import type { MaintenancePolicyInput } from './maintenance.dto';
import { MaintenanceService } from './maintenance.service';

@ApiTags('Admin — Maintenance')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('admin/evolutions/:providerId/maintenance')
export class MaintenanceController {
  constructor(private readonly service: MaintenanceService) {}
  @Get()
  @ApiOperation({
    summary: 'Consultar política e acompanhamento sem chamadas à Evolution',
  })
  get(@Param('providerId') id: string) {
    return this.service.get(id);
  }
  @Put()
  @ApiOperation({
    summary:
      'Salvar política opt-in com confirmação e revisão, sem executar ação',
  })
  update(
    @Param('providerId') id: string,
    @Body(new EvolutionInputPipe(maintenancePolicySchema))
    body: MaintenancePolicyInput,
    @Req() req: { admin: { sub?: string } },
  ) {
    return this.service.update(
      id,
      body,
      req.admin.sub ?? 'authenticated-admin',
    );
  }
  @Get('observations')
  observations(
    @Param('providerId') id: string,
    @Query(new EvolutionInputPipe(maintenancePageSchema))
    query: { cursor?: string; limit: number },
  ) {
    return this.service.page(id, 'observations', query);
  }
  @Get('actions')
  actions(
    @Param('providerId') id: string,
    @Query(new EvolutionInputPipe(maintenancePageSchema))
    query: { cursor?: string; limit: number },
  ) {
    return this.service.page(id, 'actions', query);
  }
}
