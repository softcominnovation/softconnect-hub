import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdapterRegistryService } from '../../providers/adapter-registry.service';
import { JwtGuard } from '../../auth/jwt.guard';

@ApiTags('Admin — Adapters')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('admin/adapters')
export class AdminAdaptersController {
  constructor(private readonly registry: AdapterRegistryService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os adapters disponíveis em runtime' })
  @ApiResponse({ status: 200, description: 'Lista de adapters registrados' })
  list(): { adapters: string[] } {
    return { adapters: this.registry.getAvailableTypes() };
  }
}
