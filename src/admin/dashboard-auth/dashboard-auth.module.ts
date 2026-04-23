import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AdminActivityModule } from '../activity/activity.module';
import { DashboardAuthController } from './dashboard-auth.controller';
import { DashboardAuthService } from './dashboard-auth.service';

@Module({
  imports: [AuthModule, AdminActivityModule],
  controllers: [DashboardAuthController],
  providers: [DashboardAuthService],
})
export class DashboardAuthModule {}
