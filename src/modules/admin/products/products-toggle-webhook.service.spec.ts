import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductsService } from './products.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheService } from '../../../cache/cache.service';
import { AdapterResolverService } from '../../../providers/adapter-resolver.service';

jest.mock('../../../common/crypto.util', () => ({
  decryptAES256GCM: jest.fn().mockReturnValue('decrypted-api-key'),
  generateApiKey: jest.fn().mockReturnValue('new-api-key'),
  hashSHA256: jest.fn().mockReturnValue('hashed-key'),
}));

const mockVps = {
  id: 'vps-1',
  providerUrl: 'https://evo.example.com',
  providerApiKey: 'encrypted-key',
};

const mockInstance = (overrides = {}) => ({
  id: 'inst-1',
  instanceName: 'my-instance',
  productId: 'prod-1',
  isActive: true,
  vps: mockVps,
  ...overrides,
});

const mockPrisma = {
  product: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  instance: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  webhookConfig: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockCache = { get: jest.fn(), del: jest.fn(), setWithTTL: jest.fn() };

const mockConfig = {
  getOrThrow: jest.fn().mockReturnValue('a'.repeat(64)),
  get: jest.fn().mockReturnValue('http://localhost:3000'),
};

const mockToggleWebhook = jest.fn();
const mockAdapterResolver = {
  resolve: jest.fn().mockReturnValue({ toggleWebhook: mockToggleWebhook }),
};

describe('ProductsService — toggleWebhookBulk', () => {
  let service: ProductsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: mockCache },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AdapterResolverService, useValue: mockAdapterResolver },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  it('should throw NotFoundException when product does not exist', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(null);

    await expect(service.toggleWebhookBulk('prod-x', true)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should throw NotFoundException when instanceId not found in product', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({
      adapterType: 'evolution',
    });
    mockPrisma.instance.findFirst.mockResolvedValue(null);

    await expect(
      service.toggleWebhookBulk('prod-1', true, 'inst-x'),
    ).rejects.toThrow(NotFoundException);
  });

  it('should return synced=0 when no active instances exist', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({
      adapterType: 'evolution',
    });
    mockPrisma.instance.findMany.mockResolvedValue([]);

    const result = await service.toggleWebhookBulk('prod-1', false);

    expect(result).toEqual({ synced: 0, failed: 0, enabled: false });
    expect(mockToggleWebhook).not.toHaveBeenCalled();
  });

  it('should call toggleWebhook for all instances and return synced count', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({
      adapterType: 'evolution',
    });
    mockPrisma.instance.findMany.mockResolvedValue([
      mockInstance({ id: 'inst-1', instanceName: 'inst-1' }),
      mockInstance({ id: 'inst-2', instanceName: 'inst-2' }),
    ]);
    mockToggleWebhook.mockResolvedValue(undefined);

    const result = await service.toggleWebhookBulk('prod-1', true);

    expect(result).toEqual({ synced: 2, failed: 0, enabled: true });
    expect(mockToggleWebhook).toHaveBeenCalledTimes(2);
    expect(mockToggleWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ providerUrl: mockVps.providerUrl }),
      'inst-1',
      { enabled: true },
    );
  });

  it('should call toggleWebhook only for specified instanceId', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({
      adapterType: 'evolution',
    });
    mockPrisma.instance.findFirst.mockResolvedValue(
      mockInstance({ id: 'inst-1' }),
    );
    mockPrisma.instance.findMany.mockResolvedValue([
      mockInstance({ id: 'inst-1', instanceName: 'inst-1' }),
    ]);
    mockToggleWebhook.mockResolvedValue(undefined);

    const result = await service.toggleWebhookBulk('prod-1', false, 'inst-1');

    expect(result).toEqual({ synced: 1, failed: 0, enabled: false });
    expect(mockToggleWebhook).toHaveBeenCalledTimes(1);
  });

  it('should accumulate errors and continue processing remaining instances', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({
      adapterType: 'evolution',
    });
    mockPrisma.instance.findMany.mockResolvedValue([
      mockInstance({ id: 'inst-1', instanceName: 'inst-1' }),
      mockInstance({ id: 'inst-2', instanceName: 'inst-2' }),
    ]);
    mockToggleWebhook
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(undefined);

    const result = await service.toggleWebhookBulk('prod-1', false);

    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.enabled).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0].instanceName).toBe('inst-1');
  });

  it('should extract HttpException.getResponse() for error details', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({
      adapterType: 'evolution',
    });
    mockPrisma.instance.findMany.mockResolvedValue([
      mockInstance({ id: 'inst-1', instanceName: 'inst-1' }),
    ]);
    const httpErr = new HttpException(
      { status: 404, message: 'not found on evolution' },
      404,
    );
    mockToggleWebhook.mockRejectedValue(httpErr);

    const result = await service.toggleWebhookBulk('prod-1', false);

    expect(result.failed).toBe(1);
    expect(result.errors![0].error).toContain('not found on evolution');
  });

  it('should not include errors key when all instances succeed', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({
      adapterType: 'evolution',
    });
    mockPrisma.instance.findMany.mockResolvedValue([
      mockInstance({ id: 'inst-1', instanceName: 'inst-1' }),
    ]);
    mockToggleWebhook.mockResolvedValue(undefined);

    const result = await service.toggleWebhookBulk('prod-1', true);

    expect(result.errors).toBeUndefined();
  });
});
