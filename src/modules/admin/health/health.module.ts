import { Module } from '@nestjs/common';
import { CacheModule } from '../../../cache/cache.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { HealthController } from './health.controller';
import { HealthCheckService } from './health-check.service';

@Module({
  imports: [PrismaModule, CacheModule],
  controllers: [HealthController],
  providers: [HealthCheckService],
  exports: [HealthCheckService],
})
export class HealthModule {}
