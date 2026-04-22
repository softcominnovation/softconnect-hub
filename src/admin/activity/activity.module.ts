import { Module } from '@nestjs/common';
import { AdminActivityController } from './activity.controller';
import { AdminActivityService } from './activity.service';

@Module({
  controllers: [AdminActivityController],
  providers: [AdminActivityService],
  exports: [AdminActivityService],
})
export class AdminActivityModule {}
