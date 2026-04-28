import { Module } from '@nestjs/common';
import { ProviderModule } from '../../providers/provider.module';
import { ResolverModule } from '../../resolver/resolver.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [ProviderModule, ResolverModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
