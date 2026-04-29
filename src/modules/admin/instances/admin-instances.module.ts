import { Module } from '@nestjs/common';
import { AuthModule } from '../../../auth/auth.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { InstanceModule } from '../../instance/instance.module';
import { MessageModule } from '../../message/message.module';
import { AdminInstancesController } from './admin-instances.controller';
import { AdminInstancesService } from './admin-instances.service';

@Module({
  imports: [AuthModule, PrismaModule, InstanceModule, MessageModule],
  controllers: [AdminInstancesController],
  providers: [AdminInstancesService],
})
export class AdminInstancesModule {}
