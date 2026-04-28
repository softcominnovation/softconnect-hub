import { Test, TestingModule } from '@nestjs/testing';
import { AdminActivityService } from './activity.service';
import { PrismaService } from '../../../prisma/prisma.service';

const mockPrisma = {
  adminActivityLog: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

describe('AdminActivityService', () => {
  let service: AdminActivityService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminActivityService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AdminActivityService>(AdminActivityService);
  });

  describe('record', () => {
    it('should call prisma.adminActivityLog.create and not await', () => {
      mockPrisma.adminActivityLog.create.mockResolvedValue({});
      service.record('user-1', 'LOGIN', 'detail', '127.0.0.1');
      expect(mockPrisma.adminActivityLog.create).toHaveBeenCalledWith({
        data: {
          adminUserId: 'user-1',
          action: 'LOGIN',
          detail: 'detail',
          ip: '127.0.0.1',
        },
      });
    });

    it('should not throw even if prisma rejects', () => {
      mockPrisma.adminActivityLog.create.mockRejectedValue(
        new Error('db error'),
      );
      expect(() => service.record('user-1', 'LOGIN')).not.toThrow();
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      const rows = [
        { id: '1', action: 'LOGIN', adminUser: { email: 'a@b.com' } },
      ];
      mockPrisma.adminActivityLog.findMany.mockResolvedValue(rows);
      mockPrisma.adminActivityLog.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 });
      expect(result.data).toEqual(rows);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });
  });
});
