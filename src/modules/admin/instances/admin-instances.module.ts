import { Module } from '@nestjs/common';
import { AuditModule } from '../../../audit/audit.module';
import { CacheModule } from '../../../cache/cache.module';
import { AuthModule } from '../../../auth/auth.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { EvolutionModule } from '../../../adapters/evolution/evolution.module';
import { InstanceModule } from '../../instance/instance.module';
import { MessageModule } from '../../message/message.module';
import { AdminInstancesController } from './admin-instances.controller';
import { AdminInstancesService } from './admin-instances.service';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    CacheModule,
    PrismaModule,
    EvolutionModule,
    InstanceModule,
    MessageModule,
  ],
  controllers: [AdminInstancesController],
  providers: [AdminInstancesService],
})
export class AdminInstancesModule {}
