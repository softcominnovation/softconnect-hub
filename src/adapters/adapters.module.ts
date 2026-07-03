import { Module, OnModuleInit } from '@nestjs/common';
import { AdapterRegistryService } from '../providers/adapter-registry.service';
import { ProviderModule } from '../providers/provider.module';
import { EvolutionAdapter } from './evolution/evolution.adapter';
import { EvolutionModule } from './evolution/evolution.module';

@Module({
  imports: [ProviderModule, EvolutionModule],
})
export class AdaptersModule implements OnModuleInit {
  constructor(
    private readonly registry: AdapterRegistryService,
    private readonly evolutionAdapter: EvolutionAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register('evolution', this.evolutionAdapter);
  }
}
