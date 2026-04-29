import { Module } from '@nestjs/common';
import { AuthModule } from '../../../auth/auth.module';
import { CacheModule } from '../../../cache/cache.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { VpsController } from './vps.controller';
import { VpsService } from './vps.service';

@Module({
  imports: [AuthModule, CacheModule, PrismaModule],
  controllers: [VpsController],
  providers: [VpsService],
})
export class VpsModule {}
