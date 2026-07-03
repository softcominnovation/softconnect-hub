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

const sampleEntry = (): AuditEntry => ({
  productId: 'prod-1',
  endpoint: '/message/sendText/inst1',
  method: 'POST',
  statusCode: 200,
  latencyMs: 12,
  ip: '127.0.0.1',
});

type ServiceInternals = {
  buffer: AuditEntry[];
  flushBatchSize: number;
  maxBufferSize: number;
  isUnderPressure: boolean;
  logger: { warn: jest.Mock; log: jest.Mock; error: jest.Mock };
};

async function buildModule(
  configOverrides: Record<string, number> = {},
): Promise<AuditService> {
  const cfg = {
    get: jest.fn().mockImplementation((key: string, def: number) => {
      if (key in configOverrides) return configOverrides[key];
      return def;
    }),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AuditService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: ConfigService, useValue: cfg },
    ],
  }).compile();

  return module.get<AuditService>(AuditService);
}

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(async () => {
    service = await buildModule();
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

describe('AuditService — backpressure / load shedding', () => {
  // maxBufferSize=5 para saturar o buffer rapidamente nos testes
  let service: AuditService;

  beforeEach(async () => {
    service = await buildModule({ AUDIT_BUFFER_MAX_SIZE: 5 });
    jest.clearAllMocks();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should discard entries when buffer reaches maxBufferSize', () => {
    const internals = service as unknown as ServiceInternals;
    const max = internals.maxBufferSize;

    for (let i = 0; i < max + 10; i++) {
      service.log(sampleEntry());
    }

    expect(internals.buffer.length).toBe(max);
  });

  it('should emit warn log only once per pressure episode', () => {
    const internals = service as unknown as ServiceInternals;
    const warnSpy = jest
      .spyOn(internals.logger, 'warn')
      .mockImplementation(() => undefined);

    const max = internals.maxBufferSize;

    for (let i = 0; i < max + 5; i++) {
      service.log(sampleEntry());
    }

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('Audit buffer cheio');
  });

  it('should log recovery and accept entries again after buffer is drained', async () => {
    const internals = service as unknown as ServiceInternals;
    const logSpy = jest
      .spyOn(internals.logger, 'log')
      .mockImplementation(() => undefined);

    mockPrisma.auditLog.createMany.mockResolvedValue({
      count: internals.maxBufferSize,
    });

    const max = internals.maxBufferSize;

    // Encher o buffer além do limite — ativa pressão
    for (let i = 0; i < max + 2; i++) {
      service.log(sampleEntry());
    }

    expect(internals.isUnderPressure).toBe(true);

    // Drenar o buffer
    await service.flush();
    expect(internals.buffer.length).toBe(0);

    // Próximo log deve registrar recuperação e aceitar o entry
    service.log(sampleEntry());

    expect(internals.isUnderPressure).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(
      'Audit buffer normalizado — registros voltando a ser aceitos.',
    );
    expect(internals.buffer.length).toBe(1);
  });
});
