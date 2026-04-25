import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/config.schema';
import { AdminActivityService } from '../activity/activity.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SAFE_SELECT = {
  id: true,
  name: true,
  email: true,
  type: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly activity: AdminActivityService,
  ) {}

  async bootstrap(
    dto: CreateUserDto,
    providedSecret: string | undefined,
    ip?: string,
  ): Promise<{ id: string }> {
    const allowBootstrap = this.config.get('ALLOW_BOOTSTRAP', { infer: true });
    if (!allowBootstrap) {
      throw new ForbiddenException('Bootstrap is disabled');
    }

    const adminSecret = this.config.get('ADMIN_SECRET', { infer: true });
    if (!providedSecret || providedSecret !== adminSecret) {
      throw new ForbiddenException('Invalid admin secret');
    }

    const existing = await this.prisma.adminUser.findFirst({
      where: { isActive: true },
    });
    if (existing) {
      throw new ConflictException('An active admin user already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.adminUser.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash,
        type: dto.type ?? 'admin',
      },
      select: SAFE_SELECT,
    });

    this.activity.record(user.id, 'BOOTSTRAP', undefined, ip);
    return { id: user.id };
  }

  async create(
    dto: CreateUserDto,
    actorId?: string,
    ip?: string,
  ): Promise<{ id: string }> {
    const existing = await this.prisma.adminUser.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.adminUser.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash,
        type: dto.type ?? 'admin',
      },
      select: SAFE_SELECT,
    });

    if (actorId) {
      this.activity.record(actorId, 'CREATE_USER', `userId:${user.id}`, ip);
    }
    return { id: user.id };
  }

  async findAll() {
    return this.prisma.adminUser.findMany({
      where: { isActive: true },
      select: SAFE_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, dto: UpdateUserDto, actorId?: string, ip?: string) {
    await this.assertExists(id);
    const user = await this.prisma.adminUser.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      select: SAFE_SELECT,
    });

    if (actorId) {
      this.activity.record(actorId, 'UPDATE_USER', `userId:${id}`, ip);
    }
    return user;
  }

  async deactivate(id: string, actorId?: string, ip?: string) {
    await this.assertExists(id);
    await this.prisma.adminUser.update({
      where: { id },
      data: { isActive: false },
    });

    if (actorId) {
      this.activity.record(actorId, 'DEACTIVATE_USER', `userId:${id}`, ip);
    }
    return { ok: true };
  }

  private async assertExists(id: string): Promise<void> {
    const user = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`AdminUser ${id} not found`);
    }
  }
}
