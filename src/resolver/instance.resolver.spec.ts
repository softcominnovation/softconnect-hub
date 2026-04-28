import { Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { InstanceResolverService } from './instance.resolver';

const MOCK_ENCRYPTION_KEY = 'a'.repeat(64);

const mockVps = {
  providerUrl: 'https://evo.example.com',
  providerApiKey: 'encrypted-key',
};

const mockInstance = {
  id: 'inst-1',
  productId: 'prod-1',
  vpsId: 'vps-1',
  instanceName: 'test-instance',
  isActive: true,
  vps: mockVps,
  product: { adapterType: 'evolution' },
};

const mockCache = {
  get: jest.fn(),
  setWithTTL: jest.fn(),
};

const mockPrisma = {
  instance: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
};

function makeConfig(cacheDebug = false) {
  return {
    getOrThrow: jest.fn().mockReturnValue(MOCK_ENCRYPTION_KEY),
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'CACHE_DEBUG') return cacheDebug;
      return undefined;
    }),
  };
}

jest.mock('../common/crypto.util', () => ({
  decryptAES256GCM: jest.fn().mockReturnValue('decrypted-api-key'),
  hashSHA256: jest.fn().mockReturnValue('hash'),
  generateApiKey: jest.fn().mockReturnValue('key'),
  encryptAES256GCM: jest.fn().mockReturnValue('encrypted'),
}));

describe('InstanceResolverService', () => {
  let service: InstanceResolverService;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstanceResolverService,
        { provide: CacheService, useValue: mockCache },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: makeConfig() },
      ],
    }).compile();

    service = module.get<InstanceResolverService>(InstanceResolverService);
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  describe('resolve', () => {
    it('should return cached data on Redis HIT', async () => {
      const cached = {
        providerUrl: 'https://evo.example.com',
        providerApiKey: 'decrypted-api-key',
        vpsId: 'vps-1',
        instanceId: 'inst-1',
        instanceName: 'test-instance',
        adapterType: 'evolution',
      };
      mockCache.get.mockResolvedValueOnce(cached);

      const result = await service.resolve('prod-1', 'test-instance');

      expect(mockCache.get).toHaveBeenCalledWith('instance:prod-1:test-instance');
      expect(mockPrisma.instance.findFirst).not.toHaveBeenCalled();
      expect(result).toEqual(cached);
    });

    it('should query Postgres on Redis MISS and cache the result', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockPrisma.instance.findFirst.mockResolvedValueOnce(mockInstance);
      mockCache.setWithTTL.mockResolvedValueOnce(undefined);

      const result = await service.resolve('prod-1', 'test-instance');

      expect(mockPrisma.instance.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            productId: 'prod-1',
            instanceName: 'test-instance',
            isActive: true,
          },
        }),
      );
      expect(mockCache.setWithTTL).toHaveBeenCalledWith(
        'instance:inst-1',
        expect.objectContaining({ instanceId: 'inst-1', vpsId: 'vps-1', instanceName: 'test-instance' }),
        300,
      );
      expect(result.adapterType).toBe('evolution');
      expect(result.instanceId).toBe('inst-1');
      expect(result.instanceName).toBe('test-instance');
    });

    it('should throw NotFoundException when instance is not found', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockPrisma.instance.findFirst.mockResolvedValueOnce(null);

      await expect(service.resolve('prod-1', 'ghost-instance')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('resolveById', () => {
    it('should return cached data on Redis HIT', async () => {
      const cached = {
        providerUrl: 'https://evo.example.com',
        providerApiKey: 'decrypted-api-key',
        vpsId: 'vps-1',
        instanceId: 'inst-1',
        instanceName: 'test-instance',
        adapterType: 'evolution',
      };
      mockCache.get.mockResolvedValueOnce(cached);

      const result = await service.resolveById('prod-1', 'inst-1');

      expect(mockCache.get).toHaveBeenCalledWith('instance:inst-1');
      expect(mockPrisma.instance.findFirst).not.toHaveBeenCalled();
      expect(result).toEqual(cached);
    });

    it('should query Postgres on Redis MISS and cache the result', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockPrisma.instance.findFirst.mockResolvedValueOnce(mockInstance);
      mockCache.setWithTTL.mockResolvedValueOnce(undefined);

      const result = await service.resolveById('prod-1', 'inst-1');

      expect(mockPrisma.instance.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inst-1', productId: 'prod-1', isActive: true },
        }),
      );
      expect(mockCache.setWithTTL).toHaveBeenCalledWith(
        'instance:inst-1',
        expect.objectContaining({ instanceId: 'inst-1', instanceName: 'test-instance' }),
        300,
      );
      expect(result.instanceName).toBe('test-instance');
    });

    it('should throw NotFoundException when instance is not found', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockPrisma.instance.findFirst.mockResolvedValueOnce(null);

      await expect(service.resolveById('prod-1', 'inst-999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when productId does not match (cross-product access)', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockPrisma.instance.findFirst.mockResolvedValueOnce(null);

      await expect(service.resolveById('prod-OTHER', 'inst-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('resolve — CACHE_DEBUG=true', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          InstanceResolverService,
          { provide: CacheService, useValue: mockCache },
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ConfigService, useValue: makeConfig(true) },
        ],
      }).compile();

      service = module.get<InstanceResolverService>(InstanceResolverService);
      jest.clearAllMocks();
    });

    it('should log CACHE HIT when key is found in Redis', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log');
      const cached = {
        providerUrl: 'https://evo.example.com',
        providerApiKey: 'decrypted-api-key',
        vpsId: 'vps-1',
        instanceId: 'inst-1',
        instanceName: 'test-instance',
        adapterType: 'evolution',
      };
      mockCache.get.mockResolvedValueOnce(cached);

      await service.resolve('prod-1', 'test-instance');

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[CACHE HIT]'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('instance:prod-1:test-instance'),
      );
    });

    it('should log CACHE MISS and CACHE SET on DB fallback', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log');
      mockCache.get.mockResolvedValueOnce(null);
      mockPrisma.instance.findFirst.mockResolvedValueOnce(mockInstance);
      mockCache.setWithTTL.mockResolvedValueOnce(undefined);

      await service.resolve('prod-1', 'test-instance');

      const messages = logSpy.mock.calls.map((c) => c[0] as string);
      expect(messages.some((m) => m.includes('[CACHE MISS]'))).toBe(true);
      expect(messages.some((m) => m.includes('[CACHE SET]'))).toBe(true);
    });
  });
});
