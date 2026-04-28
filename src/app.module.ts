import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AdaptersModule } from './adapters/adapters.module';
import { AdminAdaptersModule } from './modules/admin/adapters/adapters.module';
import { AdminAuthModule } from './modules/admin/auth/admin-auth.module';
import { HealthModule } from './modules/admin/health/health.module';
import { AdminLogsModule } from './modules/admin/logs/logs.module';
import { ProductsModule } from './modules/admin/products/products.module';
import { VpsModule } from './modules/admin/vps/vps.module';
import { AdminActivityModule } from './modules/admin/activity/activity.module';
import { DashboardAuthModule } from './modules/admin/dashboard-auth/dashboard-auth.module';
import { AdminUsersModule } from './modules/admin/users/users.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AuditModule } from './audit/audit.module';
import { CacheModule } from './cache/cache.module';
import { AppConfigModule } from './config/config.module';
import { ChatModule } from './modules/chat/chat.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { InstanceModule } from './modules/instance/instance.module';
import { MessageModule } from './modules/message/message.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProviderModule } from './providers/provider.module';
import { ProxyModule } from './modules/proxy/proxy.module';
import { QueueModule } from './modules/queue/queue.module';
import { ResolverModule } from './resolver/resolver.module';
import { SettingsModule } from './modules/settings/settings.module';
import { WebhookModule } from './modules/webhook/webhook.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    CacheModule,
    ProviderModule,
    AdaptersModule,
    AdminAuthModule,
    ProductsModule,
    VpsModule,
    AdminAdaptersModule,
    AdminActivityModule,
    DashboardAuthModule,
    AdminUsersModule,
    AuditModule,
    ResolverModule,
    HealthModule,
    AdminLogsModule,
    InstanceModule,
    MessageModule,
    ChatModule,
    WebhookModule,
    SettingsModule,
    ProxyModule,
    QueueModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TimeoutInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
