import { ConflictException } from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';

const terminal = ['committed', 'released', 'failed'];

/** Unknown states and leases are not evidence that a remote effect has ended. */
export async function pendingProvisionings(
  tx: Prisma.TransactionClient,
  productId?: string,
  vpsProviderId?: string,
) {
  return tx.instanceProvisioning.count({
    where: {
      productId,
      vpsProviderId,
      OR: [
        { state: { notIn: terminal } },
        { leaseOwner: { not: null } },
        { leaseExpiresAt: { not: null } },
      ],
    },
  });
}

/** Only unresolved delivery that could belong to this product is a blocker. */
export async function pendingDeliveries(
  tx: Prisma.TransactionClient,
  productId: string,
  providerIds: string[],
) {
  const events = await tx.pendingRelayEvent.findMany({
    where: {
      state: { not: 'delivered' },
      OR: [{ vpsProviderId: { in: providerIds } }, { vpsProviderId: null }],
    },
  });
  for (const event of events) {
    if (event.instanceId) {
      const instance = await tx.instance.findUnique({
        where: { id: event.instanceId },
      });
      if (instance) {
        if (instance.productId === productId) return true;
        else continue;
      }
    }
    const evidence = event.originEvidence as {
      provisioningId?: string;
      providerIds?: string[];
    } | null;
    if (evidence?.provisioningId) {
      const ticket = await tx.instanceProvisioning.findUnique({
        where: { id: evidence.provisioningId },
      });
      if (ticket) {
        if (ticket.productId === productId) return true;
        else continue;
      }
    }
    const origins = event.vpsProviderId
      ? [event.vpsProviderId]
      : evidence?.providerIds;
    if (origins?.length && !origins.some((id) => providerIds.includes(id)))
      continue;
    const identities: Prisma.InstanceWhereInput[] = [];
    if (event.instanceName)
      identities.push({ instanceName: event.instanceName });
    if (event.providerInstanceId)
      identities.push({ providerInstanceId: event.providerInstanceId });
    if (identities.length) {
      const matches = await tx.instance.findMany({
        where: {
          vpsProviderId: { in: origins?.length ? origins : providerIds },
          OR: identities,
        },
      });
      if (
        matches.length &&
        matches.every((item) => item.productId !== productId)
      )
        continue;
    }
    return true;
  }
  const jobs = await tx.batchJob.findMany({
    where: {
      productId,
      status: { notIn: ['completed', 'failed', 'cancelled'] },
    },
    include: { instance: true },
  });
  return jobs.some(
    (job) => !job.instance || providerIds.includes(job.instance.vpsProviderId),
  );
}

export async function legacyBlockers(
  tx: Prisma.TransactionClient,
  product: Product,
  targetId: string,
) {
  const blockers: string[] = [];
  const provider = await tx.vpsProvider.findUnique({
    where: { id: targetId },
    include: { vps: true },
  });
  const links = await tx.productEvolution.findMany({
    where: { productId: product.id },
  });
  if (
    !provider?.isActive ||
    !provider.vps.isActive ||
    provider.adapterType !== product.adapterType ||
    !links.some((link) => link.vpsProviderId === targetId)
  )
    blockers.push('target_unavailable');
  if (
    await tx.instance.count({
      where: { productId: product.id, vpsProviderId: { not: targetId } },
    })
  )
    blockers.push('instances_outside_target');
  if (await pendingProvisionings(tx, product.id))
    blockers.push('provisioning_pending');
  // Target deliveries retain their route. Other destinations must have no unresolved delivery.
  if (
    await pendingDeliveries(
      tx,
      product.id,
      links.map((link) => link.vpsProviderId).filter((id) => id !== targetId),
    )
  )
    blockers.push('delivery_pending');
  return blockers;
}

export async function detachBlockers(
  tx: Prisma.TransactionClient,
  product: Product,
  providerId: string,
) {
  const blockers: string[] = [];
  if (product.vpsProviderId === providerId) blockers.push('default_provider');
  if (
    await tx.instance.count({
      where: { productId: product.id, vpsProviderId: providerId },
    })
  )
    blockers.push('instances_present');
  if (await pendingProvisionings(tx, product.id, providerId))
    blockers.push('provisioning_pending');
  if (await pendingDeliveries(tx, product.id, [providerId]))
    blockers.push('delivery_pending');
  return blockers;
}

export function assertNoBlockers(blockers: string[]) {
  if (blockers.length)
    throw new ConflictException({
      message: 'Operação ainda não segura; consulte as pendências',
      blockers,
    });
}

export async function detachEmptyLink(
  tx: Prisma.TransactionClient,
  product: Product,
  providerId: string,
) {
  assertNoBlockers(await detachBlockers(tx, product, providerId));
  await tx.instanceProvisioning.updateMany({
    where: {
      productId: product.id,
      vpsProviderId: providerId,
      state: { in: terminal },
      leaseOwner: null,
      leaseExpiresAt: null,
      linkProductId: product.id,
      linkVpsProviderId: providerId,
    },
    data: { linkProductId: null, linkVpsProviderId: null },
  });
  await tx.productEvolution.delete({
    where: {
      productId_vpsProviderId: {
        productId: product.id,
        vpsProviderId: providerId,
      },
    },
  });
}
