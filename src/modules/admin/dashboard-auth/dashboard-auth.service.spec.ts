import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { DashboardAuthService } from './dashboard-auth.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminActivityService } from '../activity/activity.service';

jest.mock('../../../common/crypto.util', () => ({
  signJwt: jest.fn().mockReturnValue('signed-token'),
}));

const mockPrisma = {
  adminUser: {
    findUnique: jest.fn(),
  },
};

const mockConfig = { getOrThrow: jest.fn().mockReturnValue('secret') };
const mockActivity = { record: jest.fn() };

describe('DashboardAuthService', () => {
  let service: DashboardAuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardAuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AdminActivityService, useValue: mockActivity },
      ],
    }).compile();

    service = module.get<DashboardAuthService>(DashboardAuthService);
  });

  describe('login', () => {
    it('should return access_token for valid credentials', async () => {
      const hash = await bcrypt.hash('password123', 12);
      mockPrisma.adminUser.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        passwordHash: hash,
        type: 'admin',
        isActive: true,
      });

      const result = await service.login('a@b.com', 'password123');
      expect(result.access_token).toBe('signed-token');
      expect(mockActivity.record).toHaveBeenCalledWith(
        'user-1',
        'LOGIN',
        undefined,
        undefined,
      );
    });

    it('should throw UnauthorizedException for unknown email', async () => {
      mockPrisma.adminUser.findUnique.mockResolvedValue(null);
      await expect(service.login('x@y.com', 'pass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for inactive user', async () => {
      const hash = await bcrypt.hash('password123', 12);
      mockPrisma.adminUser.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        passwordHash: hash,
        type: 'admin',
        isActive: false,
      });
      await expect(service.login('a@b.com', 'password123')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      const hash = await bcrypt.hash('correct', 12);
      mockPrisma.adminUser.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        passwordHash: hash,
        type: 'admin',
        isActive: true,
      });
      await expect(service.login('a@b.com', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getMe', () => {
    it('should return user without passwordHash', async () => {
      mockPrisma.adminUser.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Admin',
        email: 'a@b.com',
        type: 'admin',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getMe('user-1');
      expect(result).not.toHaveProperty('passwordHash');
    });
  });
});
