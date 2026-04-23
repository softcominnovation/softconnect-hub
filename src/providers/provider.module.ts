import { Module } from '@nestjs/common';
import { AdapterRegistryService } from './adapter-registry.service';
import { AdapterResolverService } from './adapter-resolver.service';

@Module({
  providers: [AdapterRegistryService, AdapterResolverService],
  exports: [AdapterRegistryService, AdapterResolverService],
})
export class ProviderModule {}
