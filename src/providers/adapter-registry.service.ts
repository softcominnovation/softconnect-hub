import { BadRequestException, Injectable } from '@nestjs/common';
import { WhatsAppProvider } from './whatsapp-provider.interface';

@Injectable()
export class AdapterRegistryService {
  private readonly adapters = new Map<string, WhatsAppProvider>();

  register(type: string, adapter: WhatsAppProvider): void {
    this.adapters.set(type, adapter);
  }

  get(type: string): WhatsAppProvider {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new BadRequestException(`Adapter "${type}" não registrado`);
    }
    return adapter;
  }

  getAvailableTypes(): string[] {
    return Array.from(this.adapters.keys());
  }
}
