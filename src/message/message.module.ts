import { Module } from '@nestjs/common';
import { ProviderModule } from '../providers/provider.module';
import { ResolverModule } from '../resolver/resolver.module';
import { MessageController } from './message.controller';
import { MessageService } from './message.service';

@Module({
  imports: [ProviderModule, ResolverModule],
  controllers: [MessageController],
  providers: [MessageService],
})
export class MessageModule {}
