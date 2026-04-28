import { Module } from '@nestjs/common';
import { ProviderModule } from '../providers/provider.module';
import { ResolverModule } from '../resolver/resolver.module';
import { ProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';

@Module({
  imports: [ProviderModule, ResolverModule],
  controllers: [ProxyController],
  providers: [ProxyService],
})
export class ProxyModule {}
