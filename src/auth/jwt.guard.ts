import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyJwt } from '../common/crypto.util';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Record<string, unknown>>();
    const authHeader = (request.headers as Record<string, string>)[
      'authorization'
    ];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token JWT ausente ou mal formatado');
    }

    const token = authHeader.slice(7);
    try {
      const payload = verifyJwt(
        token,
        this.config.getOrThrow<string>('JWT_SECRET'),
      );
      request.admin = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Token JWT inválido ou expirado');
    }
  }
}
