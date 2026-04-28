import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProviderModule } from '../../providers/provider.module';
import { QueueModule } from '../queue/queue.module';
import { ResolverModule } from '../../resolver/resolver.module';
import { MessageBatchController, MessageController } from './message.controller';
import { MessageService } from './message.service';

@Module({
  imports: [ProviderModule, ResolverModule, PrismaModule, QueueModule],
  controllers: [MessageController, MessageBatchController],
  providers: [MessageService],
})
export class MessageModule {}
