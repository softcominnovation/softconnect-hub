import { NotFoundException } from '@nestjs/common';
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
  },
};

const mockConfig = {
  getOrThrow: jest.fn().mockReturnValue(MOCK_ENCRYPTION_KEY),
};

jest.mock('../common/crypto.util', () => ({
  decryptAES256GCM: jest.fn().mockReturnValue('decrypted-api-key'),
  hashSHA256: jest.fn().mockReturnValue('hash'),
  generateApiKey: jest.fn().mockReturnValue('key'),
  encryptAES256GCM: jest.fn().mockReturnValue('encrypted'),
}));

describe('InstanceResolverService', () => {
  let service: InstanceResolverService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstanceResolverService,
        { provide: CacheService, useValue: mockCache },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<InstanceResolverService>(InstanceResolverService);
    jest.clearAllMocks();
  });

  describe('resolve', () => {
    it('should return cached data on Redis HIT', async () => {
      const cached = {
        providerUrl: 'https://evo.example.com',
        providerApiKey: 'decrypted-api-key',
        vpsId: 'vps-1',
        instanceId: 'inst-1',
        adapterType: 'evolution',
      };
      mockCache.get.mockResolvedValueOnce(cached);

      const result = await service.resolve('prod-1', 'test-instance');

      expect(mockCache.get).toHaveBeenCalledWith(
        'instance:prod-1:test-instance',
      );
      expect(mockPrisma.instance.findFirst).not.toHaveBeenCalled();
      expect(result).toEqual(cached);
    });

    it('should query Postgres on Redis MISS and cache the result', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockPrisma.instance.findFirst.mockResolvedValueOnce(mockInstance);
      mockCache.setWithTTL.mockResolvedValueOnce(undefined);

      const result = await service.resolve('prod-1', 'test-instance');

      expect(mockCache.get).toHaveBeenCalledWith(
        'instance:prod-1:test-instance',
      );
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
        'instance:prod-1:test-instance',
        expect.objectContaining({ instanceId: 'inst-1', vpsId: 'vps-1' }),
        300,
      );
      expect(result.adapterType).toBe('evolution');
      expect(result.instanceId).toBe('inst-1');
    });

    it('should throw NotFoundException when instance is not found', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockPrisma.instance.findFirst.mockResolvedValueOnce(null);

      await expect(service.resolve('prod-1', 'ghost-instance')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
