import { ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service';

function makeRedis(overrides: Record<string, jest.Mock> = {}) {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    disconnect: jest.fn(),
    ...overrides,
  };
}

function makeConfig(url = 'redis://localhost:6379/0'): ConfigService {
  return { getOrThrow: () => url } as unknown as ConfigService;
}

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => makeRedis());
});

describe('CacheService', () => {
  let service: CacheService;
  let redisMock: ReturnType<typeof makeRedis>;

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require('ioredis') as jest.Mock;
    redisMock = makeRedis();
    Redis.mockImplementation(() => redisMock);
    service = new CacheService(makeConfig());
  });

  it('get retorna null quando chave não existe', async () => {
    redisMock.get.mockResolvedValue(null);
    const result = await service.get('key');
    expect(result).toBeNull();
  });

  it('get retorna objeto parseado quando chave existe', async () => {
    redisMock.get.mockResolvedValue(JSON.stringify({ foo: 'bar' }));
    const result = await service.get<{ foo: string }>('key');
    expect(result).toEqual({ foo: 'bar' });
  });

  it('set armazena valor como JSON sem TTL', async () => {
    await service.set('key', { x: 1 });
    expect(redisMock.set).toHaveBeenCalledWith('key', JSON.stringify({ x: 1 }));
  });

  it('setWithTTL armazena valor com EX TTL', async () => {
    await service.setWithTTL('key', { x: 1 }, 60);
    expect(redisMock.set).toHaveBeenCalledWith(
      'key',
      JSON.stringify({ x: 1 }),
      'EX',
      60,
    );
  });

  it('del chama redis.del com a chave correta', async () => {
    await service.del('key');
    expect(redisMock.del).toHaveBeenCalledWith('key');
  });
});
