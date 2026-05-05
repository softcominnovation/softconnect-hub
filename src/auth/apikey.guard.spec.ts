import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthCachePayload, ApiKeyGuard } from './apikey.guard';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashSHA256 } from '../common/crypto.util';

const RAW_KEY = 'sk_test_abc123';
const KEY_HASH = hashSHA256(RAW_KEY);

const PAYLOAD: AuthCachePayload = {
  productId: 'prod-1',
  isActive: true,
  origins: [],
  hubRelay: false,
  adapterType: 'evolution',
  vpsId: 'vps-1',
  batchWebhookEnabled: false,
  batchWebhookUrl: null,
};

function makeContext(apikey?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { apikey } }),
    }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let cache: jest.Mocked<CacheService>;
  let prisma: jest.Mocked<Pick<PrismaService, 'product'>>;

  beforeEach(() => {
    cache = {
      get: jest.fn(),
      setWithTTL: jest.fn(),
    } as unknown as jest.Mocked<CacheService>;

    prisma = {
      product: {
        findUnique: jest.fn(),
      },
    } as unknown as jest.Mocked<Pick<PrismaService, 'product'>>;

    guard = new ApiKeyGuard(cache, prisma as unknown as PrismaService);
  });

  it('HIT no Redis — retorna payload cacheado sem consultar banco', async () => {
    cache.get.mockResolvedValue(PAYLOAD);

    const ctx = makeContext(RAW_KEY);
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(cache.get).toHaveBeenCalledWith(`auth:${KEY_HASH}`);
    expect(prisma.product.findUnique).not.toHaveBeenCalled();
  });

  it('MISS no Redis — busca Postgres e cacheia resultado', async () => {
    cache.get.mockResolvedValue(null);
    (prisma.product.findUnique as jest.Mock).mockResolvedValue({
      id: 'prod-1',
      isActive: true,
      origins: [],
      hubRelay: false,
      adapterType: 'evolution',
      vpsId: 'vps-1',
      batchWebhookEnabled: false,
      batchWebhookUrl: null,
    });

    const ctx = makeContext(RAW_KEY);
    await guard.canActivate(ctx);

    expect(prisma.product.findUnique).toHaveBeenCalled();
    expect(cache.setWithTTL).toHaveBeenCalledWith(
      `auth:${KEY_HASH}`,
      expect.objectContaining({ productId: 'prod-1' }),
      60,
    );
  });

  it('lança UnauthorizedException quando apikey ausente', async () => {
    const ctx = makeContext();
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('lança UnauthorizedException quando apikey não encontrada no banco', async () => {
    cache.get.mockResolvedValue(null);
    (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);

    const ctx = makeContext(RAW_KEY);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('lança UnauthorizedException quando produto inativo', async () => {
    cache.get.mockResolvedValue({ ...PAYLOAD, isActive: false });

    const ctx = makeContext(RAW_KEY);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});
