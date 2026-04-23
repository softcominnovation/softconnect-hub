import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminUsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminActivityService } from '../activity/activity.service';

const mockPrisma = {
  adminUser: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

const mockConfig = {
  get: jest.fn().mockImplementation((key: string) => {
    if (key === 'ALLOW_BOOTSTRAP') return true;
    if (key === 'ADMIN_SECRET') return 'my-secret';
    return undefined;
  }),
};

const mockActivity = { record: jest.fn() };

describe('AdminUsersService', () => {
  let service: AdminUsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AdminActivityService, useValue: mockActivity },
      ],
    }).compile();

    service = module.get<AdminUsersService>(AdminUsersService);
  });

  describe('bootstrap', () => {
    const dto = { name: 'Admin', email: 'admin@test.com', password: 'pass123' };

    it('should create admin when no active user exists', async () => {
      mockPrisma.adminUser.findFirst.mockResolvedValue(null);
      mockPrisma.adminUser.create.mockResolvedValue({ id: 'new-id' });

      const result = await service.bootstrap(dto, 'my-secret');
      expect(result).toEqual({ id: 'new-id' });
      expect(mockActivity.record).toHaveBeenCalledWith('new-id', 'BOOTSTRAP', undefined, undefined);
    });

    it('should throw ConflictException if active user already exists', async () => {
      mockPrisma.adminUser.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(service.bootstrap(dto, 'my-secret')).rejects.toThrow(ConflictException);
    });

    it('should throw ForbiddenException for invalid secret', async () => {
      await expect(service.bootstrap(dto, 'wrong-secret')).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when bootstrap is disabled', async () => {
      mockConfig.get.mockImplementation((key: string): unknown => {
        if (key === 'ALLOW_BOOTSTRAP') return false;
        return undefined;
      });
      await expect(service.bootstrap(dto, 'my-secret')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('create', () => {
    const dto = { name: 'User', email: 'user@test.com', password: 'pass123' };

    it('should create user when email is unique', async () => {
      mockPrisma.adminUser.findUnique.mockResolvedValue(null);
      mockPrisma.adminUser.create.mockResolvedValue({ id: 'new-id' });

      const result = await service.create(dto);
      expect(result).toEqual({ id: 'new-id' });
    });

    it('should throw ConflictException for duplicate email', async () => {
      mockPrisma.adminUser.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('deactivate', () => {
    it('should set isActive to false', async () => {
      mockPrisma.adminUser.findUnique.mockResolvedValue({ id: 'user-1' });
      mockPrisma.adminUser.update.mockResolvedValue({ id: 'user-1', isActive: false });

      const result = await service.deactivate('user-1');
      expect(result).toEqual({ ok: true });
    });

    it('should throw NotFoundException for unknown id', async () => {
      mockPrisma.adminUser.findUnique.mockResolvedValue(null);
      await expect(service.deactivate('ghost-id')).rejects.toThrow(NotFoundException);
    });
  });
});
