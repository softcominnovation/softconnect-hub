import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, VpsProvider } from '@prisma/client';
import { canonicalEvolutionEndpoint } from '../../prisma/evolution-identity';
import { OPEN_PROVISIONING_STATES } from './evolution-locks';
import { readEvolutionOccupancy } from './evolution-inventory.service';
import { writerConfirmation } from './evolution-setup';

// Catalog/activation writers take this lock before product/provider row locks.
// It closes the race between checking aliases and enabling shared capacity.
export async function lockEvolutionCatalog(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(734921004::bigint)`;
}

export function assertRevision(actual: number, expected: number) {
  if (actual !== expected)
    throw new ConflictException('Configuração alterada; consulte novamente');
}

export async function isControlledEvolution(
  tx: Prisma.TransactionClient,
  provider: VpsProvider,
) {
  return (
    provider.maxInstances !== null ||
    !provider.acceptingNewInstances ||
    !!(await tx.productEvolution.findFirst({
      where: {
        vpsProviderId: provider.id,
        product: { allocationMode: 'capacity' },
      },
      select: { productId: true },
    }))
  );
}

export async function endpointAliases(
  tx: Prisma.TransactionClient,
  url: string,
  exceptId?: string,
) {
  const canonical = canonicalEvolutionEndpoint(url);
  if (!canonical) return [];
  const providers = await tx.vpsProvider.findMany({
    where: exceptId ? { id: { not: exceptId } } : {},
  });
  return providers.filter(
    (item) => canonicalEvolutionEndpoint(item.providerUrl) === canonical,
  );
}

export async function assertEndpointAvailable(
  tx: Prisma.TransactionClient,
  url: string,
  exceptId?: string,
  strict = false,
) {
  const aliases = await endpointAliases(tx, url, exceptId);
  for (const alias of aliases) {
    if (strict || (await isControlledEvolution(tx, alias)))
      throw new ConflictException(
        'Evolution já cadastrada; reutilize o provider existente por vínculo',
      );
  }
  return aliases;
}

export async function evolutionUsage(
  tx: Prisma.TransactionClient,
  providerId: string,
) {
  const [instances, pending, defaults, links, inventory, callbacks] =
    await Promise.all([
      tx.instance.count({ where: { vpsProviderId: providerId } }),
      tx.instanceProvisioning.count({
        where: {
          vpsProviderId: providerId,
          state: { in: OPEN_PROVISIONING_STATES },
        },
      }),
      tx.product.count({ where: { vpsProviderId: providerId } }),
      tx.productEvolution.count({ where: { vpsProviderId: providerId } }),
      tx.evolutionInventoryEntry.count({
        where: { vpsProviderId: providerId },
      }),
      tx.pendingRelayEvent.count({
        where: { vpsProviderId: providerId, state: { not: 'delivered' } },
      }),
    ]);
  return { instances, pending, defaults, links, inventory, callbacks };
}

export async function assertEvolutionUnused(
  tx: Prisma.TransactionClient,
  providerId: string,
  identityChange = false,
) {
  const use = await evolutionUsage(tx, providerId);
  if (
    use.instances ||
    use.pending ||
    use.defaults ||
    use.inventory ||
    use.callbacks ||
    (identityChange && use.links)
  )
    throw new ConflictException(
      'Evolution em uso; preserve o destino e pause novas admissões',
    );
}

export async function isEvolutionBaseConsolidated(
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  const [result] = await tx.$queryRaw<Array<{ ready: boolean }>>`
    SELECT (
      (SELECT count(*) FROM pg_constraint
        WHERE convalidated AND contype = 'f' AND (
          (conname = 'Product_id_vpsProviderId_fkey' AND conrelid = '"Product"'::regclass)
          OR (conname = 'Instance_productId_vpsProviderId_fkey' AND conrelid = '"Instance"'::regclass)
        )) = 2
      AND EXISTS (
        SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = 'Instance_provider_remote_identity_key'
          AND i.indrelid = '"Instance"'::regclass AND i.indisunique AND i.indisvalid
      )
    ) AS ready`;
  return result?.ready === true;
}

export async function assertWritersCompatible(
  tx: Prisma.TransactionClient,
  confirmed?: boolean,
) {
  if (
    (!confirmed && !(await writerConfirmation(tx))) ||
    !(await isEvolutionBaseConsolidated(tx))
  )
    throw new ConflictException(
      'Confirme a atualização de todos os escritores e a consolidação do banco',
    );
}

export function inventoryFresh(
  provider: VpsProvider,
  maxAgeMs: number,
  now = Date.now(),
) {
  return (
    provider.inventoryObservedAt !== null &&
    now - provider.inventoryObservedAt.getTime() <= maxAgeMs &&
    ['ready', 'unresolved'].includes(provider.inventoryStatus)
  );
}

export async function evolutionReadiness(
  tx: Prisma.TransactionClient,
  provider: VpsProvider,
  config: ConfigService,
  relay = false,
) {
  const blockers: string[] = [];
  const canonical = canonicalEvolutionEndpoint(provider.providerUrl);
  if (
    !canonical ||
    provider.canonicalEndpoint !== canonical ||
    provider.identityStatus !== 'verified'
  )
    blockers.push('identity_unverified');
  if ((await endpointAliases(tx, provider.providerUrl, provider.id)).length)
    blockers.push('endpoint_alias');
  if (!provider.isActive) blockers.push('provider_inactive');
  const vps = await tx.vpsServer.findUnique({ where: { id: provider.vpsId } });
  if (!vps?.isActive) blockers.push('vps_inactive');
  if (
    !provider.isHealthy ||
    !provider.lastHealthAt ||
    Date.now() - provider.lastHealthAt.getTime() >
      config.get<number>('EVOLUTION_HEALTH_MAX_AGE_MS', 180000)
  )
    blockers.push('health_unconfirmed');
  if (
    provider.inventoryStatus !== 'ready' ||
    !inventoryFresh(
      provider,
      config.get<number>('EVOLUTION_INVENTORY_MAX_AGE_MS', 300000),
    )
  )
    blockers.push('inventory_unconfirmed');
  if (relay && provider.callbackReadiness !== 'ready')
    blockers.push('callback_unconfirmed');
  const used = await readEvolutionOccupancy(tx, provider.id);
  if (used.ambiguous) blockers.push('occupancy_ambiguous');
  if (
    used.reservations.some(
      (item) =>
        item.linkProductId !== item.productId ||
        item.linkVpsProviderId !== item.vpsProviderId,
    )
  )
    blockers.push('provisioning_unresolved');
  return { blockers, used };
}
