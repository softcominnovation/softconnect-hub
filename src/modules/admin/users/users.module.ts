import { Module } from '@nestjs/common';
import { AdminUsersController } from './users.controller';
import { AdminUsersService } from './users.service';
import { AuthModule } from '../../../auth/auth.module';
import { AdminActivityModule } from '../activity/activity.module';

@Module({
  imports: [AuthModule, AdminActivityModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService],
})
export class AdminUsersModule {}
