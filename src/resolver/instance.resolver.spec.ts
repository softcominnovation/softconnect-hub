import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../cache/cache.service';
import {
  instanceCacheKey,
  invalidateInstanceCache,
} from '../cache/instance-cache';
import { encryptAES256GCM } from '../common/crypto.util';
import { PrismaService } from '../prisma/prisma.service';
import { InstanceResolverService } from './instance.resolver';

const key = 'a'.repeat(64);
const row = {
  id: 'hub-a',
  productId: 'product-a',
  instanceName: 'same-name',
  providerInstanceId: 'external-a',
  vpsProviderId: 'host-a',
  vpsProvider: {
    adapterType: 'evolution',
    providerUrl: 'https://a.invalid',
    providerApiKey: encryptAES256GCM('key-a', key),
    isActive: false,
    maxInstances: 1,
    acceptingNewInstances: false,
  },
};

describe('InstanceResolverService — product-scoped identity', () => {
  const values = new Map<string, unknown>();
  const cache = {
    get: jest.fn((id: string) => Promise.resolve(values.get(id) ?? null)),
    setWithTTL: jest.fn((id: string, value: unknown) => {
      values.set(id, value);
      return Promise.resolve();
    }),
    del: jest.fn((id: string) => {
      values.delete(id);
      return Promise.resolve();
    }),
  };
  const prisma = { instance: { findMany: jest.fn() } };
  let resolver: InstanceResolverService;
  beforeEach(() => {
    values.clear();
    jest.clearAllMocks();
    prisma.instance.findMany.mockResolvedValue([row]);
    resolver = new InstanceResolverService(
      cache as unknown as CacheService,
      prisma as unknown as PrismaService,
      new ConfigService({ ENCRYPTION_KEY: key, CACHE_DEBUG: true }),
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it.each(['id', 'name'] as const)(
    'uses the same scoped %s key on miss and hit, retaining TTL and host',
    async (kind) => {
      const id = kind === 'id' ? row.id : row.instanceName;
      const read = () =>
        kind === 'id'
          ? resolver.resolveById(row.productId, id)
          : resolver.resolve(row.productId, id);
      const first = await read();
      const hit = await read();
      expect(hit).toEqual(first);
      expect(first).toMatchObject({
        productId: row.productId,
        instanceId: row.id,
        vpsProviderId: row.vpsProviderId,
        providerApiKey: 'key-a',
      });
      expect(cache.setWithTTL).toHaveBeenCalledWith(
        instanceCacheKey(row.productId, kind, id),
        first,
        300,
      );
      expect(prisma.instance.findMany).toHaveBeenCalledTimes(1);
    },
  );

  it('accepts external ID only after checking all matching identities', async () => {
    const result = await resolver.resolveById(
      row.productId,
      row.providerInstanceId,
    );
    expect(result.instanceId).toBe(row.id);
    expect(prisma.instance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          productId: row.productId,
          isActive: true,
          OR: [
            { id: row.providerInstanceId },
            { providerInstanceId: row.providerInstanceId },
          ],
        },
        take: 2,
      }),
    );
    expect(cache.setWithTTL).toHaveBeenCalledTimes(1);
  });

  it('does not consume legacy unscoped cache entries', async () => {
    values.set(`instance:${row.id}`, { instanceId: 'foreign' });
    await resolver.resolveById(row.productId, row.id);
    expect(cache.get).toHaveBeenCalledWith(
      instanceCacheKey(row.productId, 'id', row.id),
    );
    expect(prisma.instance.findMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a cross-product cached payload and a foreign database result', async () => {
    const resolved = await resolver.resolveById(row.productId, row.id);
    values.set(instanceCacheKey('foreign', 'id', row.id), resolved);
    await expect(
      resolver.resolveById('foreign', row.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.instance.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ productId: 'foreign' }) as unknown,
      }),
    );
  });

  it('does not confuse names and IDs with the same text', async () => {
    await resolver.resolveById(row.productId, row.id);
    prisma.instance.findMany.mockResolvedValue([]);
    await expect(
      resolver.resolve(row.productId, row.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 409 for repeated external IDs across hosts without caching a winner', async () => {
    prisma.instance.findMany.mockResolvedValue([
      row,
      { ...row, id: 'hub-b', vpsProviderId: 'host-b' },
    ]);
    await expect(
      resolver.resolveById(row.productId, row.providerInstanceId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(cache.setWithTTL).not.toHaveBeenCalled();
  });

  it('returns 404 when the scoped instance is absent', async () => {
    prisma.instance.findMany.mockResolvedValue([]);
    await expect(
      resolver.resolveById(row.productId, row.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not accept a cache entry for another identifier', async () => {
    const resolved = await resolver.resolveById(row.productId, row.id);
    values.set(instanceCacheKey(row.productId, 'id', 'other'), resolved);
    prisma.instance.findMany.mockResolvedValue([]);
    await expect(
      resolver.resolveById(row.productId, 'other'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('invalidates the Hub ID, external ID and name aliases without touching other products', async () => {
    const other = instanceCacheKey('other', 'name', row.instanceName);
    values.set(other, { fixture: true });
    for (const [kind, id] of [
      ['id', row.id],
      ['id', row.providerInstanceId],
      ['name', row.instanceName],
    ] as const)
      values.set(instanceCacheKey(row.productId, kind, id), {});
    await invalidateInstanceCache(cache as unknown as CacheService, row);
    expect([...values.keys()]).toEqual([other]);
  });
});
