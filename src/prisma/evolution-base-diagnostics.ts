import { PrismaClient } from '@prisma/client';
import { canonicalEvolutionEndpoint } from './evolution-identity';

export async function diagnoseEvolutionBase(prisma: PrismaClient) {
  const [products, providers, instances, links] = await Promise.all([
    prisma.product.findMany({ select: { id: true, vpsProviderId: true } }),
    prisma.vpsProvider.findMany({
      select: { id: true, providerUrl: true, identityStatus: true },
    }),
    prisma.instance.findMany({
      select: {
        productId: true,
        vpsProviderId: true,
        instanceName: true,
        providerInstanceId: true,
      },
    }),
    prisma.productEvolution.findMany({
      select: { productId: true, vpsProviderId: true },
    }),
  ]);
  const pair = (product: string, provider: string) =>
    JSON.stringify([product, provider]);
  const linkKeys = new Set(
    links.map((l) => pair(l.productId, l.vpsProviderId)),
  );
  const productIds = new Set(products.map((p) => p.id));
  const providerIds = new Set(providers.map((p) => p.id));
  const expectedLinks = new Set(
    products
      .filter((p) => p.vpsProviderId !== null)
      .map((p) => pair(p.id, p.vpsProviderId!)),
  );
  for (const i of instances)
    expectedLinks.add(pair(i.productId, i.vpsProviderId));
  const duplicateGroups = (keys: string[]) => {
    const counts = new Map<string, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [...counts.values()].filter((n) => n > 1).length;
  };
  const endpoints = providers.map((p) =>
    canonicalEvolutionEndpoint(p.providerUrl),
  );
  return {
    products: products.length,
    providers: providers.length,
    instances: instances.length,
    sharedProviders: duplicateGroups(
      [...expectedLinks].map((key) => (JSON.parse(key) as string[])[1]),
    ),
    missingLinks: [...expectedLinks].filter((key) => !linkKeys.has(key)).length,
    orphanReferences:
      products.filter(
        (p) => p.vpsProviderId && !providerIds.has(p.vpsProviderId),
      ).length +
      instances.filter(
        (i) =>
          !productIds.has(i.productId) || !providerIds.has(i.vpsProviderId),
      ).length,
    duplicateProductNames: duplicateGroups(
      instances.map((i) => pair(i.productId, i.instanceName)),
    ),
    duplicateProviderNames: duplicateGroups(
      instances.map((i) => pair(i.vpsProviderId, i.instanceName)),
    ),
    duplicateRemoteIds: duplicateGroups(
      instances
        .filter((i) => i.providerInstanceId !== null)
        .map((i) => pair(i.vpsProviderId, i.providerInstanceId!)),
    ),
    endpointAliasGroups: duplicateGroups(
      endpoints.filter((endpoint): endpoint is string => endpoint !== null),
    ),
    invalidEndpoints: endpoints.filter((endpoint) => endpoint === null).length,
    pendingIdentity: providers.filter((p) => p.identityStatus !== 'verified')
      .length,
  };
}
