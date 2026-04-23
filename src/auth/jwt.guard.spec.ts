import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { signJwt } from '../common/crypto.util';
import { JwtGuard } from './jwt.guard';

const SECRET = 'test-secret-for-jwt-unit-tests-ok';

function makeContext(authHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { authorization: authHeader },
      }),
    }),
  } as unknown as ExecutionContext;
}

function makeConfig(secret = SECRET): ConfigService {
  return { getOrThrow: () => secret } as unknown as ConfigService;
}

describe('JwtGuard', () => {
  it('passa com token válido', () => {
    const token = signJwt({ sub: 'admin' }, SECRET, 3600);
    const guard = new JwtGuard(makeConfig());
    const ctx = makeContext(`Bearer ${token}`);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('lança UnauthorizedException quando header ausente', () => {
    const guard = new JwtGuard(makeConfig());
    expect(() => guard.canActivate(makeContext())).toThrow(
      UnauthorizedException,
    );
  });

  it('lança UnauthorizedException quando não começa com Bearer', () => {
    const token = signJwt({ sub: 'admin' }, SECRET, 3600);
    const guard = new JwtGuard(makeConfig());
    expect(() => guard.canActivate(makeContext(`Token ${token}`))).toThrow(
      UnauthorizedException,
    );
  });

  it('lança UnauthorizedException com secret errado', () => {
    const token = signJwt({ sub: 'admin' }, 'outro-secret', 3600);
    const guard = new JwtGuard(makeConfig());
    expect(() => guard.canActivate(makeContext(`Bearer ${token}`))).toThrow(
      UnauthorizedException,
    );
  });

  it('lança UnauthorizedException com token expirado', () => {
    const token = signJwt({ sub: 'admin' }, SECRET, -1);
    const guard = new JwtGuard(makeConfig());
    expect(() => guard.canActivate(makeContext(`Bearer ${token}`))).toThrow(
      UnauthorizedException,
    );
  });
});
