import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import {
  advanceOccupancy,
  lockProduct,
  lockProvider,
  OPEN_PROVISIONING_STATES,
} from '../modules/provisioning/evolution-locks';

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
    const product = await lockProduct(tx, data.productId);
    await lockProvider(tx, data.vpsProviderId);
    const pending = await tx.instanceProvisioning.findFirst({
      where: {
        instanceName: data.instanceName,
        state: { in: OPEN_PROVISIONING_STATES },
        OR: [
          { productId: data.productId },
          { vpsProviderId: data.vpsProviderId },
        ],
      },
    });
    if (pending)
      throw new ConflictException('Instância ainda em provisionamento');
    await ensureEvolutionLink(
      tx,
      data.productId,
      data.vpsProviderId,
      product.allocationMode === 'legacy' &&
        product.vpsProviderId === data.vpsProviderId,
    );
    const instance = await tx.instance.create({ data });
    await advanceOccupancy(tx, data.vpsProviderId);
    return instance;
  });
}
