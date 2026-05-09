import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { IpWhitelistGuard } from './ip-whitelist.guard';
import { PrismaService } from '../prisma/prisma.service';

function makeContext(ip: string, forwarded?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        ip,
        headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('IpWhitelistGuard', () => {
  let guard: IpWhitelistGuard;
  let prisma: { vpsServer: { findFirst: jest.Mock } };

  beforeEach(() => {
    prisma = { vpsServer: { findFirst: jest.fn() } };
    guard = new IpWhitelistGuard(prisma as unknown as PrismaService);
  });

  it('passa quando IP está na whitelist', async () => {
    prisma.vpsServer.findFirst.mockResolvedValue({ id: 'vps-1' });

    const ctx = makeContext('192.168.1.10');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.vpsServer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ip: '192.168.1.10', isActive: true, providers: { some: { isActive: true } } },
      }),
    );
  });

  it('usa X-Forwarded-For quando disponível', async () => {
    prisma.vpsServer.findFirst.mockResolvedValue({ id: 'vps-1' });

    const ctx = makeContext('', '10.0.0.1, 10.0.0.2');
    await guard.canActivate(ctx);

    expect(prisma.vpsServer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ip: '10.0.0.1', isActive: true, providers: { some: { isActive: true } } } }),
    );
  });

  it('lança ForbiddenException quando IP não autorizado', async () => {
    prisma.vpsServer.findFirst.mockResolvedValue(null);

    const ctx = makeContext('1.2.3.4');
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
