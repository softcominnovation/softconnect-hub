import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const OPEN_PROVISIONING_STATES = [
  'reserved',
  'creating',
  'uncertain',
  'cleanup_pending',
];

export async function lockProduct(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Product" WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) throw new NotFoundException('Produto não encontrado');
  return tx.product.findUniqueOrThrow({ where: { id } });
}

export async function lockProvider(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "VpsProvider" WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) throw new NotFoundException('VpsProvider não encontrado');
  return tx.vpsProvider.findUniqueOrThrow({
    where: { id },
    include: { vps: true },
  });
}

export async function advanceOccupancy(
  tx: Prisma.TransactionClient,
  providerId: string,
) {
  await tx.vpsProvider.update({
    where: { id: providerId },
    data: { occupancyRevision: { increment: 1 } },
  });
}
