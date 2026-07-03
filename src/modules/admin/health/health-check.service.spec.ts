import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from '../../../cache/cache.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { HealthCheckService } from './health-check.service';

jest.mock('axios');

import axios from 'axios';

const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('../../../common/crypto.util', () => ({
  decryptAES256GCM: jest.fn().mockReturnValue('plain-apikey'),
}));

const mockPrisma = {
  vpsProvider: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  vpsServer: {
    findMany: jest.fn(),
  },
  healthCheck: {
    create: jest.fn(),
  },
};

const mockCache = {
  setWithTTL: jest.fn(),
  get: jest.fn().mockResolvedValue(null),
};

const mockConfig = {
  getOrThrow: jest.fn().mockReturnValue('a'.repeat(32)),
};

const makeProvider = (overrides = {}) => ({
  id: 'provider-1',
  vpsId: 'vps-1',
  label: 'EvoLab Provider',
  providerUrl: 'http://provider.test',
  providerApiKey: 'encrypted-key',
  adapterType: 'evolution',
  isHealthy: true,
  lastHealthAt: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  vps: {
    id: 'vps-1',
    label: 'EvoLab',
    subdomain: 'evo.test.com',
    ip: '1.2.3.4',
    monitorUrl: null,
    monitorApiKey: null,
  },
  healthChecks: [],
  ...overrides,
});

async function buildService(): Promise<HealthCheckService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      HealthCheckService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: CacheService, useValue: mockCache },
      { provide: ConfigService, useValue: mockConfig },
    ],
  }).compile();

  return module.get<HealthCheckService>(HealthCheckService);
}

describe('HealthCheckService', () => {
  let service: HealthCheckService;

  beforeEach(async () => {
    service = await buildService();
    jest.clearAllMocks();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('checkProvider  healthy response', () => {
    it('should create a healthy HealthCheck record', async () => {
      mockedAxios.get = jest.fn().mockResolvedValue({ status: 200 });
      mockPrisma.healthCheck.create.mockResolvedValue({});
      mockPrisma.vpsProvider.update.mockResolvedValue({});

      await service.checkProvider(makeProvider());

      expect(mockPrisma.healthCheck.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ vpsProviderId: 'provider-1', status: 'healthy' }),
        }),
      );
    });

    it('should mark provider as healthy again on recovery', async () => {
      mockedAxios.get = jest.fn().mockResolvedValue({ status: 200 });
      mockPrisma.healthCheck.create.mockResolvedValue({});

      const provider = makeProvider({ isHealthy: false });
      mockPrisma.vpsProvider.update.mockResolvedValue({});

      await service.checkProvider(provider);

      expect(mockPrisma.vpsProvider.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ isHealthy: true }),
        }),
      );
    });
  });

  describe('checkProvider  unhealthy response', () => {
    it('should create an unhealthy HealthCheck record on error', async () => {
      mockedAxios.get = jest.fn().mockRejectedValue(new Error('timeout'));
      mockPrisma.healthCheck.create.mockResolvedValue({});

      await service.checkProvider(makeProvider());

      expect(mockPrisma.healthCheck.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            vpsProviderId: 'provider-1',
            status: 'unhealthy',
          }),
        }),
      );
    });

    it('should mark provider as unhealthy after 3 consecutive failures', async () => {
      mockedAxios.get = jest.fn().mockRejectedValue(new Error('timeout'));
      mockPrisma.healthCheck.create.mockResolvedValue({});
      mockPrisma.vpsProvider.update.mockResolvedValue({});

      const provider = makeProvider({ isHealthy: true });

      await service.checkProvider(provider);
      await service.checkProvider(provider);
      await service.checkProvider(provider);

      expect(mockPrisma.vpsProvider.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ isHealthy: false }),
        }),
      );
    });

    it('should NOT update provider before reaching threshold of 3', async () => {
      mockedAxios.get = jest.fn().mockRejectedValue(new Error('timeout'));
      mockPrisma.healthCheck.create.mockResolvedValue({});

      const provider = makeProvider({ isHealthy: true });

      await service.checkProvider(provider);
      await service.checkProvider(provider);

      expect(mockPrisma.vpsProvider.update).not.toHaveBeenCalled();
    });
  });

  describe('getHealthStatus', () => {
    it('should return a consolidated status list grouped by VPS', async () => {
      mockPrisma.vpsServer.findMany.mockResolvedValue([
        {
          id: 'vps-1',
          label: 'EvoLab',
          subdomain: 'evo.test.com',
          monitorUrl: null,
          isActive: true,
          providers: [
            {
              id: 'provider-1',
              label: 'EvoLab Provider',
              adapterType: 'evolution',
              providerUrl: 'http://provider.test',
              isHealthy: true,
              lastHealthAt: null,
              healthChecks: [
                {
                  status: 'healthy',
                  responseMs: 50,
                  errorMsg: null,
                  checkedAt: new Date(),
                },
              ],
            },
          ],
        },
      ]);

      const result = await service.getHealthStatus();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        vpsId: 'vps-1',
        label: 'EvoLab',
      });
      expect(result[0].providers).toHaveLength(1);
      expect(result[0].providers[0]).toMatchObject({
        providerId: 'provider-1',
        isHealthy: true,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        lastCheck: expect.objectContaining({ status: 'healthy' }),
      });
    });

    it('should return VPS with empty providers when none exist', async () => {
      mockPrisma.vpsServer.findMany.mockResolvedValue([
        {
          id: 'vps-1',
          label: 'EvoLab',
          subdomain: 'evo.test.com',
          monitorUrl: null,
          isActive: true,
          providers: [],
        },
      ]);

      const result = await service.getHealthStatus();

      expect(result).toHaveLength(1);
      expect(result[0].providers).toHaveLength(0);
    });
  });
});
