import { Injectable } from '@nestjs/common';
import { AdapterRegistryService } from './adapter-registry.service';
import { WhatsAppProvider } from './whatsapp-provider.interface';

@Injectable()
export class AdapterResolverService {
  constructor(private readonly registry: AdapterRegistryService) {}

  resolve(adapterType: string): WhatsAppProvider {
    return this.registry.get(adapterType);
  }
}
