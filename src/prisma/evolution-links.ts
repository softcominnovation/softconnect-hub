import { BadRequestException, ConflictException } from '@nestjs/common';
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

/** Administrative assignment of an observed session; never creates a remote session. */
export async function importLinkedInstance(
  prisma: PrismaService,
  data: Prisma.InstanceUncheckedCreateInput,
  source: {
    providerUrl: string;
    providerApiKey: string;
    configurationRevision: number;
  },
) {
  return prisma.$transaction(async (tx) => {
    const product = await lockProduct(tx, data.productId);
    const provider = await lockProvider(tx, data.vpsProviderId);
    if (!product.isActive) throw new BadRequestException('Produto inativo');
    if (
      provider.providerUrl !== source.providerUrl ||
      provider.providerApiKey !== source.providerApiKey ||
      provider.configurationRevision !== source.configurationRevision
    ) {
      throw new ConflictException(
        'Origem alterada durante a consulta; consulte novamente',
      );
    }
    const link = await tx.productEvolution.findUnique({
      where: {
        productId_vpsProviderId: {
          productId: data.productId,
          vpsProviderId: data.vpsProviderId,
        },
      },
    });
    if (!link)
      throw new BadRequestException('Provider não vinculado ao produto');
    const pending = await tx.instanceProvisioning.findFirst({
      where: {
        state: { in: OPEN_PROVISIONING_STATES },
        OR: [
          { productId: data.productId, instanceName: data.instanceName },
          {
            vpsProviderId: data.vpsProviderId,
            instanceName: data.instanceName,
          },
          ...(data.providerInstanceId
            ? [
                {
                  vpsProviderId: data.vpsProviderId,
                  providerInstanceId: data.providerInstanceId,
                },
              ]
            : []),
        ],
      },
    });
    if (pending)
      throw new ConflictException('Instância ainda em provisionamento');
    const existing = await tx.instance.findMany({
      where: {
        OR: [
          { productId: data.productId, instanceName: data.instanceName },
          {
            vpsProviderId: data.vpsProviderId,
            instanceName: data.instanceName,
          },
          {
            vpsProviderId: data.vpsProviderId,
            providerInstanceId: data.providerInstanceId,
          },
        ],
      },
    });
    if (existing.length) {
      const same =
        existing.length === 1 &&
        existing[0].productId === data.productId &&
        existing[0].vpsProviderId === data.vpsProviderId &&
        existing[0].instanceName === data.instanceName &&
        existing[0].providerInstanceId === data.providerInstanceId;
      if (!same)
        throw new ConflictException(
          'Sessão já atribuída ou identidade em conflito',
        );
      return { result: 'skipped' as const, instance: existing[0] };
    }
    const instance = await tx.instance.create({ data });
    await advanceOccupancy(tx, data.vpsProviderId);
    return { result: 'created' as const, instance };
  });
}
