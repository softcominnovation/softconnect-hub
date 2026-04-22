import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { VpsController } from './vps.controller';
import { VpsService } from './vps.service';

@Module({
  imports: [AuthModule],
  controllers: [VpsController],
  providers: [VpsService],
})
export class VpsModule {}
