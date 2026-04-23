import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdapterRegistryService } from '../../providers/adapter-registry.service';
import { JwtGuard } from '../../auth/jwt.guard';

@UseGuards(JwtGuard)
@Controller('admin/adapters')
export class AdminAdaptersController {
  constructor(private readonly registry: AdapterRegistryService) {}

  @Get()
  list(): { adapters: string[] } {
    return { adapters: this.registry.getAvailableTypes() };
  }
}
