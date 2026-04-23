import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class IpWhitelistGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      ip?: string;
      headers: Record<string, string | string[]>;
    }>();

    const forwarded = request.headers['x-forwarded-for'];
    const rawIp = forwarded
      ? (Array.isArray(forwarded) ? forwarded[0] : forwarded)
          .split(',')[0]
          .trim()
      : (request.ip ?? '');

    const vps = await this.prisma.vpsServer.findFirst({
      where: { ip: rawIp, isActive: true },
      select: { id: true },
    });

    if (!vps) throw new ForbiddenException('IP não autorizado');

    return true;
  }
}
