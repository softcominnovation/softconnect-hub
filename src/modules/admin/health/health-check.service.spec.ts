import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { VpsServer } from '@prisma/client';
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
  vpsServer: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  healthCheck: {
    create: jest.fn(),
  },
};

const mockCache = {
  setWithTTL: jest.fn(),
};

const mockConfig = {
  getOrThrow: jest.fn().mockReturnValue('a'.repeat(32)),
};

const makeVps = (overrides: Partial<VpsServer> = {}): VpsServer =>
  ({
    id: 'vps-1',
    label: 'EvoLab',
    subdomain: 'evo.test.com',
    ip: '1.2.3.4',
    providerUrl: 'http://provider.test',
    providerApiKey: 'encrypted-key',
    adapterType: 'evolution',
    managerType: null,
    managerUrl: null,
    managerApiKey: null,
    isHealthy: true,
    lastHealthAt: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as VpsServer;

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

  describe('checkVps — healthy response', () => {
    it('should create a healthy HealthCheck record', async () => {
      mockedAxios.get = jest.fn().mockResolvedValue({ status: 200 });
      mockPrisma.healthCheck.create.mockResolvedValue({});
      mockPrisma.vpsServer.update.mockResolvedValue({});

      await service.checkVps(makeVps());

      expect(mockPrisma.healthCheck.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ vpsId: 'vps-1', status: 'healthy' }),
        }),
      );
    });

    it('should mark VPS as healthy again on recovery', async () => {
      mockedAxios.get = jest.fn().mockResolvedValue({ status: 200 });
      mockPrisma.healthCheck.create.mockResolvedValue({});

      const vps = makeVps({ isHealthy: false });
      mockPrisma.vpsServer.update.mockResolvedValue({});

      await service.checkVps(vps);

      expect(mockPrisma.vpsServer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ isHealthy: true }),
        }),
      );
      expect(mockCache.setWithTTL).toHaveBeenCalledWith(
        'vps:health:vps-1',
        { isHealthy: true },
        expect.any(Number),
      );
    });
  });

  describe('checkVps — unhealthy response', () => {
    it('should create an unhealthy HealthCheck record on error', async () => {
      mockedAxios.get = jest.fn().mockRejectedValue(new Error('timeout'));
      mockPrisma.healthCheck.create.mockResolvedValue({});

      await service.checkVps(makeVps());

      expect(mockPrisma.healthCheck.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            vpsId: 'vps-1',
            status: 'unhealthy',
          }),
        }),
      );
    });

    it('should mark VPS as unhealthy after 3 consecutive failures', async () => {
      mockedAxios.get = jest.fn().mockRejectedValue(new Error('timeout'));
      mockPrisma.healthCheck.create.mockResolvedValue({});
      mockPrisma.vpsServer.update.mockResolvedValue({});

      const vps = makeVps({ isHealthy: true });

      await service.checkVps(vps);
      await service.checkVps(vps);
      await service.checkVps(vps);

      expect(mockPrisma.vpsServer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ isHealthy: false }),
        }),
      );
      expect(mockCache.setWithTTL).toHaveBeenCalledWith(
        'vps:health:vps-1',
        { isHealthy: false },
        expect.any(Number),
      );
    });

    it('should NOT update VPS before reaching threshold of 3', async () => {
      mockedAxios.get = jest.fn().mockRejectedValue(new Error('timeout'));
      mockPrisma.healthCheck.create.mockResolvedValue({});

      const vps = makeVps({ isHealthy: true });

      await service.checkVps(vps);
      await service.checkVps(vps);

      expect(mockPrisma.vpsServer.update).not.toHaveBeenCalled();
    });
  });

  describe('getHealthStatus', () => {
    it('should return a consolidated status list', async () => {
      mockPrisma.vpsServer.findMany.mockResolvedValue([
        {
          ...makeVps(),
          healthChecks: [
            {
              status: 'healthy',
              responseMs: 50,
              errorMsg: null,
              checkedAt: new Date(),
            },
          ],
        },
      ]);

      const result = await service.getHealthStatus();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        vpsId: 'vps-1',
        isHealthy: true,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        lastCheck: expect.objectContaining({ status: 'healthy' }),
      });
    });

    it('should return lastCheck as null when no checks exist', async () => {
      mockPrisma.vpsServer.findMany.mockResolvedValue([
        { ...makeVps(), healthChecks: [] },
      ]);

      const result = await service.getHealthStatus();

      expect(result[0].lastCheck).toBeNull();
    });
  });
});
