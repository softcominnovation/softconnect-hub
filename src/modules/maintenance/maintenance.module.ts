import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { CacheModule } from '../../cache/cache.module';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceController } from './maintenance.controller';
@Module({
  imports: [AuthModule, PrismaModule, CacheModule],
  providers: [MaintenanceService],
  controllers: [MaintenanceController],
})
export class MaintenanceModule {}
