import { BadRequestException } from '@nestjs/common';
import { AdapterRegistryService } from './adapter-registry.service';
import { AdapterResolverService } from './adapter-resolver.service';
import { WhatsAppProvider } from './whatsapp-provider.interface';

const mockAdapter = {} as WhatsAppProvider;

describe('AdapterResolverService', () => {
  let resolver: AdapterResolverService;
  let registry: AdapterRegistryService;

  beforeEach(() => {
    registry = new AdapterRegistryService();
    resolver = new AdapterResolverService(registry);
  });

  it('resolve retorna o adapter correto para o type registrado', () => {
    registry.register('evolution', mockAdapter);
    expect(resolver.resolve('evolution')).toBe(mockAdapter);
  });

  it('resolve propaga BadRequestException ao type não registrado', () => {
    expect(() => resolver.resolve('meta-cloud')).toThrow(BadRequestException);
    expect(() => resolver.resolve('meta-cloud')).toThrow(
      'Adapter "meta-cloud" não registrado',
    );
  });

  it('resolve retorna adapters diferentes para types diferentes', () => {
    const adapterA = { name: 'A' } as unknown as WhatsAppProvider;
    const adapterB = { name: 'B' } as unknown as WhatsAppProvider;

    registry.register('evolution', adapterA);
    registry.register('meta-cloud', adapterB);

    expect(resolver.resolve('evolution')).toBe(adapterA);
    expect(resolver.resolve('meta-cloud')).toBe(adapterB);
  });
});
