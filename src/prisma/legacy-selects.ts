import { Prisma, Product, VpsProvider } from '@prisma/client';

export const legacyProductSelect = {
  id: true,
  name: true,
  slug: true,
  adapterType: true,
  origins: true,
  hubRelay: true,
  batchWebhookEnabled: true,
  batchWebhookUrl: true,
  isActive: true,
  vpsProviderId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

export type LegacyProduct = Prisma.ProductGetPayload<{
  select: typeof legacyProductSelect;
}>;

export function legacyProduct(product: Product): LegacyProduct {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    adapterType: product.adapterType,
    origins: product.origins,
    hubRelay: product.hubRelay,
    batchWebhookEnabled: product.batchWebhookEnabled,
    batchWebhookUrl: product.batchWebhookUrl,
    isActive: product.isActive,
    vpsProviderId: product.vpsProviderId,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export const legacyProviderSelect = {
  id: true,
  vpsId: true,
  label: true,
  providerUrl: true,
  providerApiKey: true,
  adapterType: true,
  isHealthy: true,
  lastHealthAt: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.VpsProviderSelect;

export type LegacyProvider = Prisma.VpsProviderGetPayload<{
  select: typeof legacyProviderSelect;
}>;

export function legacyProvider(provider: VpsProvider): LegacyProvider {
  return {
    id: provider.id,
    vpsId: provider.vpsId,
    label: provider.label,
    providerUrl: provider.providerUrl,
    providerApiKey: provider.providerApiKey,
    adapterType: provider.adapterType,
    isHealthy: provider.isHealthy,
    lastHealthAt: provider.lastHealthAt,
    isActive: provider.isActive,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}
