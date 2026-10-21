import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MaintenanceGuard } from './maintenance.guard';
@Module({
  imports: [PrismaModule],
  providers: [MaintenanceGuard],
  exports: [MaintenanceGuard],
})
export class MaintenanceGuardModule {}
