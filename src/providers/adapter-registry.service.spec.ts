import { BadRequestException } from '@nestjs/common';
import { AdapterRegistryService } from './adapter-registry.service';
import { WhatsAppProvider } from './whatsapp-provider.interface';

const mockAdapter = {} as WhatsAppProvider;

describe('AdapterRegistryService', () => {
  let registry: AdapterRegistryService;

  beforeEach(() => {
    registry = new AdapterRegistryService();
  });

  it('registra um adapter e recupera pelo type', () => {
    registry.register('evolution', mockAdapter);
    expect(registry.get('evolution')).toBe(mockAdapter);
  });

  it('retorna todos os types disponíveis após registro', () => {
    registry.register('evolution', mockAdapter);
    registry.register('meta-cloud', mockAdapter);
    expect(registry.getAvailableTypes()).toEqual(
      expect.arrayContaining(['evolution', 'meta-cloud']),
    );
    expect(registry.getAvailableTypes()).toHaveLength(2);
  });

  it('lança BadRequestException ao solicitar type não registrado', () => {
    expect(() => registry.get('inexistente')).toThrow(BadRequestException);
    expect(() => registry.get('inexistente')).toThrow(
      'Adapter "inexistente" não registrado',
    );
  });

  it('retorna lista vazia quando nenhum adapter foi registrado', () => {
    expect(registry.getAvailableTypes()).toHaveLength(0);
  });

  it('sobrescreve adapter ao registrar o mesmo type duas vezes', () => {
    const adapterV1 = { v: 1 } as unknown as WhatsAppProvider;
    const adapterV2 = { v: 2 } as unknown as WhatsAppProvider;

    registry.register('evolution', adapterV1);
    registry.register('evolution', adapterV2);

    expect(registry.get('evolution')).toBe(adapterV2);
    expect(registry.getAvailableTypes()).toHaveLength(1);
  });
});
