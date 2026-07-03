import { Module } from '@nestjs/common';
import { ProviderModule } from '../../providers/provider.module';
import { ResolverModule } from '../../resolver/resolver.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

@Module({
  imports: [ProviderModule, ResolverModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
