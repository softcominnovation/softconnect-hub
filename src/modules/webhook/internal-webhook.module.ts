import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { QueueModule } from '../queue/queue.module';
import { InternalWebhookController } from '../queue/internal-webhook.controller';

@Module({
  imports: [AuthModule, QueueModule],
  controllers: [InternalWebhookController],
})
export class InternalWebhookModule {}
