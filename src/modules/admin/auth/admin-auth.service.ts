import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { signJwt } from '../../../common/crypto.util';

@Injectable()
export class AdminAuthService {
  constructor(private readonly config: ConfigService) {}

  login(secret: string): { access_token: string } {
    const adminSecret = this.config.getOrThrow<string>('ADMIN_SECRET');

    if (secret !== adminSecret) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const jwtSecret = this.config.getOrThrow<string>('JWT_SECRET');
    const expiresIn = this.config.getOrThrow<number>('ADMIN_JWT_EXPIRY');

    const token = signJwt(
      { sub: 'admin', role: 'admin' },
      jwtSecret,
      expiresIn,
    );
    return { access_token: token };
  }
}
