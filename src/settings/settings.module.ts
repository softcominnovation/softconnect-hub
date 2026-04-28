import { Module } from '@nestjs/common';
import { ProviderModule } from '../providers/provider.module';
import { ResolverModule } from '../resolver/resolver.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [ProviderModule, ResolverModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
