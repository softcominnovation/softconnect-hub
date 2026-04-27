import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import type { AuditEntry } from './audit.service';

const mockPrisma = {
  auditLog: {
    createMany: jest.fn(),
  },
};

const mockConfig = {
  get: jest.fn().mockImplementation((_key: string, def: number) => def),
};

const sampleEntry = (): AuditEntry => ({
  productId: 'prod-1',
  endpoint: '/message/sendText/inst1',
  method: 'POST',
  statusCode: 200,
  latencyMs: 12,
  ip: '127.0.0.1',
});

type ServiceInternals = { buffer: AuditEntry[]; flushBatchSize: number };

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should add an entry to the buffer', () => {
    service.log(sampleEntry());
    expect((service as unknown as ServiceInternals).buffer).toHaveLength(1);
  });

  it('should flush when buffer reaches batch size', async () => {
    mockPrisma.auditLog.createMany.mockResolvedValueOnce({ count: 1 });

    const batchSize = (service as unknown as ServiceInternals).flushBatchSize;

    for (let i = 0; i < batchSize; i++) {
      service.log(sampleEntry());
    }

    await new Promise((r) => setTimeout(r, 10));

    expect(mockPrisma.auditLog.createMany).toHaveBeenCalled();
    expect((service as unknown as ServiceInternals).buffer).toHaveLength(0);
  });

  it('should flush all buffered entries on explicit flush', async () => {
    mockPrisma.auditLog.createMany.mockResolvedValueOnce({ count: 2 });

    service.log(sampleEntry());
    service.log(sampleEntry());

    await service.flush();

    expect(mockPrisma.auditLog.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.arrayContaining([
          expect.objectContaining({ productId: 'prod-1' }),
        ]),
      }),
    );
    expect((service as unknown as ServiceInternals).buffer).toHaveLength(0);
  });

  it('should not call createMany when buffer is empty', async () => {
    await service.flush();
    expect(mockPrisma.auditLog.createMany).not.toHaveBeenCalled();
  });

  it('should silently discard Prisma errors to never block the app', async () => {
    mockPrisma.auditLog.createMany.mockRejectedValueOnce(new Error('DB down'));
    service.log(sampleEntry());
    await expect(service.flush()).resolves.toBeUndefined();
  });
});
