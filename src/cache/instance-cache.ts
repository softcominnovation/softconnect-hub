import type { CacheService } from './cache.service';

export function instanceCacheKey(
  productId: string,
  kind: 'id' | 'name',
  identifier: string,
): string {
  return `instance:v2:${encodeURIComponent(productId)}:${kind}:${encodeURIComponent(identifier)}`;
}

export async function invalidateInstanceCache(
  cache: CacheService,
  instance: {
    id: string;
    productId: string;
    instanceName: string;
    providerInstanceId?: string | null;
  },
): Promise<void> {
  const keys = new Set([
    instanceCacheKey(instance.productId, 'id', instance.id),
    instanceCacheKey(instance.productId, 'name', instance.instanceName),
    `instance:${instance.id}`,
    `instance:${instance.productId}:${instance.instanceName}`,
  ]);
  if (instance.providerInstanceId) {
    keys.add(
      instanceCacheKey(instance.productId, 'id', instance.providerInstanceId),
    );
    keys.add(`instance:${instance.providerInstanceId}`);
  }
  await Promise.all([...keys].map((key) => cache.del(key)));
}
