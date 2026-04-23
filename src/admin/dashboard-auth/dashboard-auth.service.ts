import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { signJwt } from '../../common/crypto.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminActivityService } from '../activity/activity.service';

@Injectable()
export class DashboardAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly activity: AdminActivityService,
  ) {}

  async login(
    email: string,
    password: string,
    ip?: string,
  ): Promise<{ access_token: string }> {
    const user = await this.prisma.adminUser.findUnique({ where: { email } });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const token = signJwt(
      { sub: user.id, email: user.email, type: user.type },
      this.config.getOrThrow<string>('JWT_SECRET'),
      this.config.getOrThrow<number>('ADMIN_JWT_EXPIRY'),
    );

    this.activity.record(user.id, 'LOGIN', undefined, ip);

    return { access_token: token };
  }

  async getMe(userId: string) {
    const user = await this.prisma.adminUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        type: true,
        isActive: true,
        createdAt: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    return user;
  }
}
