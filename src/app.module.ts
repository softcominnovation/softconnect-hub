import { Module } from '@nestjs/common';
import { AdminAdaptersModule } from './admin/adapters/adapters.module';
import { AdminAuthModule } from './admin/auth/admin-auth.module';
import { ProductsModule } from './admin/products/products.module';
import { VpsModule } from './admin/vps/vps.module';
import { AdminActivityModule } from './admin/activity/activity.module';
import { DashboardAuthModule } from './admin/dashboard-auth/dashboard-auth.module';
import { AdminUsersModule } from './admin/users/users.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CacheModule } from './cache/cache.module';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProviderModule } from './providers/provider.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    CacheModule,
    ProviderModule,
    AdminAuthModule,
    ProductsModule,
    VpsModule,
    AdminActivityModule,
    DashboardAuthModule,
    AdminUsersModule,
    AdminAdaptersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
