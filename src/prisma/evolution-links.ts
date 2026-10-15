import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export async function ensureEvolutionLink(
  tx: Prisma.TransactionClient,
  productId: string,
  vpsProviderId: string,
  acceptingNewInstances: boolean,
): Promise<void> {
  await tx.productEvolution.createMany({
    data: { productId, vpsProviderId, acceptingNewInstances },
    skipDuplicates: true,
  });
}

export async function createLinkedInstance(
  prisma: PrismaService,
  data: Prisma.InstanceUncheckedCreateInput,
) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: data.productId },
      select: { vpsProviderId: true, allocationMode: true },
    });
    if (!product) throw new NotFoundException('Produto não encontrado');
    await ensureEvolutionLink(
      tx,
      data.productId,
      data.vpsProviderId,
      product.allocationMode === 'legacy' &&
        product.vpsProviderId === data.vpsProviderId,
    );
    return tx.instance.create({ data });
  });
}
