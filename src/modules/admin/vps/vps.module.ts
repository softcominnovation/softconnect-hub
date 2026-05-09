import { Module } from '@nestjs/common';
import { AuthModule } from '../../../auth/auth.module';
import { CacheModule } from '../../../cache/cache.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { VpsController } from './vps.controller';
import { VpsService } from './vps.service';
import { VpsProviderController } from './vps-provider.controller';
import { VpsProviderService } from './vps-provider.service';

@Module({
  imports: [AuthModule, CacheModule, PrismaModule],
  controllers: [VpsController, VpsProviderController],
  providers: [VpsService, VpsProviderService],
})
export class VpsModule {}
