import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { decryptAES256GCM } from '../../common/crypto.util';
import { QrRequestContext } from '../../common/qr-request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import { lockProvider, OPEN_PROVISIONING_STATES } from './evolution-locks';
import {
  normalizeInventory,
  occupancy,
  remoteToken,
  sameSession,
} from './evolution-occupancy';
import { decodePayload } from './provisioning-payload';

@Injectable()
export class EvolutionInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: AdapterResolverService,
    private readonly config: ConfigService,
  ) {}

  isFresh(provider: {
    isHealthy: boolean;
    lastHealthAt: Date | null;
    inventoryStatus: string;
    inventoryObservedAt: Date | null;
  }) {
    const now = Date.now();
    return (
      provider.isHealthy &&
      !!provider.lastHealthAt &&
      now - provider.lastHealthAt.getTime() <=
        this.config.get<number>('EVOLUTION_HEALTH_MAX_AGE_MS', 180000) &&
      provider.inventoryStatus === 'ready' &&
      !!provider.inventoryObservedAt &&
      now - provider.inventoryObservedAt.getTime() <=
        this.config.get<number>('EVOLUTION_INVENTORY_MAX_AGE_MS', 300000)
    );
  }

  async request(providerId: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockProvider(tx, providerId);
      const active = await tx.evolutionReconciliation.findFirst({
        where: {
          vpsProviderId: providerId,
          status: { in: ['pending', 'running'] },
        },
      });
      return (
        active ??
        tx.evolutionReconciliation.create({
          data: { vpsProviderId: providerId },
        })
      );
    });
  }

  async refresh(providerId: string, execution: QrRequestContext) {
    execution.assertActive();
    const owner = randomUUID();
    const { provider, operation } = await this.prisma.$transaction(
      async (tx) => {
        const provider = await lockProvider(tx, providerId);
        const active = await tx.evolutionReconciliation.findFirst({
          where: {
            vpsProviderId: providerId,
            status: { in: ['pending', 'running'] },
          },
        });
        if (
          active?.leaseExpiresAt &&
          active.leaseExpiresAt.getTime() > Date.now()
        )
          throw new ServiceUnavailableException('Reconciliação em andamento');
        const data = {
          status: 'running',
          leaseOwner: owner,
          leaseExpiresAt: new Date(Date.now() + execution.remainingMs + 5000),
          observedOccupancyRevision: provider.occupancyRevision,
          collectionStartedAt: new Date(),
          collectionFinishedAt: null,
          errorCode: null,
        };
        const operation = active
          ? await tx.evolutionReconciliation.update({
              where: { id: active.id },
              data: { ...data, revision: { increment: 1 } },
            })
          : await tx.evolutionReconciliation.create({
              data: { ...data, vpsProviderId: providerId },
            });
        return { provider, operation };
      },
    );
    try {
      execution.assertActive();
      const key = this.config.getOrThrow<string>('ENCRYPTION_KEY');
      const rows = await this.adapters
        .resolve(provider.adapterType)
        .fetchInstances({
          providerUrl: provider.providerUrl,
          providerApiKey: decryptAES256GCM(provider.providerApiKey, key),
          execution,
          strictInventory: true,
        });
      execution.assertActive();
      const remote = normalizeInventory(rows);
      return await this.prisma.$transaction(async (tx) => {
        const current = await lockProvider(tx, providerId);
        const lease = await tx.evolutionReconciliation.findUniqueOrThrow({
          where: { id: operation.id },
        });
        if (lease.leaseOwner !== owner || lease.status !== 'running')
          throw new ServiceUnavailableException('Reconciliação substituída');
        if (
          current.occupancyRevision !== operation.observedOccupancyRevision ||
          current.configurationRevision !== provider.configurationRevision ||
          current.providerUrl !== provider.providerUrl ||
          current.providerApiKey !== provider.providerApiKey
        )
          throw new ServiceUnavailableException(
            'Inventário mudou durante a coleta',
          );
        execution.assertActive();
        const [instances, reservations] = await Promise.all([
          tx.instance.findMany({ where: { vpsProviderId: providerId } }),
          tx.instanceProvisioning.findMany({
            where: {
              vpsProviderId: providerId,
              state: { in: OPEN_PROVISIONING_STATES },
            },
          }),
        ]);
        let unknownCount = 0;
        let conflictCount = 0;
        for (let index = 0; index < remote.length; index++) {
          const session = remote[index];
          const local = instances.find(
            (item) => item.instanceName === session.instanceName,
          );
          if (local) {
            if (!sameSession(local, session)) conflictCount++;
            continue;
          }
          const pending = reservations.find(
            (item) => item.instanceName === session.instanceName,
          );
          let proven =
            !!pending?.providerInstanceId &&
            pending.providerInstanceId === session.providerInstanceId;
          if (pending && !proven) {
            try {
              const evidence = decodePayload(pending.encryptedRequest, key);
              proven =
                !evidence.clientToken &&
                evidence.token === remoteToken(rows[index]);
            } catch {
              proven = false;
            }
          }
          if (!proven) unknownCount++;
        }
        const absentInstanceIds = instances
          .filter(
            (item) => !remote.some((session) => sameSession(item, session)),
          )
          .map((item) => item.id);
        const observedAt = new Date();
        const inventoryRevision = current.inventoryRevision + 1;
        await tx.evolutionInventoryEntry.deleteMany({
          where: { vpsProviderId: providerId },
        });
        if (remote.length)
          await tx.evolutionInventoryEntry.createMany({
            data: remote.map((item) => ({
              ...item,
              vpsProviderId: providerId,
              identityKey: item.providerInstanceId
                ? `id:${item.providerInstanceId}`
                : `name:${item.instanceName}`,
              inventoryRevision,
              observedAt,
            })),
          });
        const updated = await tx.vpsProvider.update({
          where: { id: providerId },
          data: {
            inventoryRevision,
            inventoryObservedAt: observedAt,
            inventoryStatus:
              unknownCount || conflictCount ? 'unresolved' : 'ready',
            isHealthy: true,
            lastHealthAt: observedAt,
          },
        });
        await tx.evolutionReconciliation.update({
          where: { id: operation.id },
          data: {
            status: 'completed',
            collectionFinishedAt: observedAt,
            leaseOwner: null,
            leaseExpiresAt: null,
            revision: { increment: 1 },
            result: {
              inventoryRevision,
              unknownCount,
              conflictCount,
              absentInstanceIds,
            },
          },
        });
        return updated;
      });
    } catch (error) {
      await this.prisma.evolutionReconciliation.updateMany({
        where: { id: operation.id, leaseOwner: owner, status: 'running' },
        data: {
          status: 'failed',
          errorCode: execution.reason ?? 'inventory_not_confirmed',
          collectionFinishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          revision: { increment: 1 },
        },
      });
      throw error;
    }
  }

  async readOccupancy(tx: Prisma.TransactionClient, providerId: string) {
    const [provider, remote, instances, reservations, reconciliation] =
      await Promise.all([
        tx.vpsProvider.findUniqueOrThrow({ where: { id: providerId } }),
        tx.evolutionInventoryEntry.findMany({
          where: { vpsProviderId: providerId },
        }),
        tx.instance.findMany({ where: { vpsProviderId: providerId } }),
        tx.instanceProvisioning.findMany({
          where: {
            vpsProviderId: providerId,
            state: { in: OPEN_PROVISIONING_STATES },
          },
        }),
        tx.evolutionReconciliation.findFirst({
          where: { vpsProviderId: providerId, status: 'completed' },
          orderBy: { collectionFinishedAt: 'desc' },
        }),
      ]);
    const result = reconciliation?.result as {
      inventoryRevision?: number;
      absentInstanceIds?: string[];
    } | null;
    const absence = new Set(
      result?.inventoryRevision === provider.inventoryRevision
        ? instances
            .filter(
              (item) =>
                reconciliation?.collectionStartedAt &&
                item.updatedAt <= reconciliation.collectionStartedAt &&
                result.absentInstanceIds?.includes(item.id),
            )
            .map((item) => item.id)
        : [],
    );
    return {
      ...occupancy(remote, instances, reservations, absence),
      instances,
      reservations,
      remote,
    };
  }
}
