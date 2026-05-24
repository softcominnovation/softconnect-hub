import { Module } from '@nestjs/common';
import { AdaptersModule } from '../adapters/adapters.module';
import { CacheModule } from '../cache/cache.module';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProviderModule } from '../providers/provider.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    CacheModule,
    ProviderModule,
    AdaptersModule,
  ],
  exports: [
    AppConfigModule,
    PrismaModule,
    CacheModule,
    ProviderModule,
    AdaptersModule,
  ],
})
export class CoreModule {}
