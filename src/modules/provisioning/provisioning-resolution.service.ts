import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InstanceProvisioning, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readEvidence } from '../../common/create-outcome';
import { QrRequestContext } from '../../common/qr-request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import {
  advanceOccupancy,
  lockProduct,
  lockProvider,
  OPEN_PROVISIONING_STATES,
} from './evolution-locks';
import { normalizeInventory } from './evolution-occupancy';
import { EvolutionProvisioningService } from './evolution-provisioning.service';
import { EvolutionRecoveryService } from './evolution-recovery.service';

export interface ResolutionInput {
  expectedRevision: number;
  action: 'reconcile' | 'release_absent';
  reason: string;
  acknowledgeUncertainOutcome?: boolean;
  confirmExecutorsDrained?: boolean;
}

@Injectable()
export class ProvisioningResolutionService {
  private readonly logger = new Logger(ProvisioningResolutionService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: EvolutionProvisioningService,
    private readonly recovery: EvolutionRecoveryService,
    private readonly adapters: AdapterResolverService,
    private readonly config: ConfigService,
  ) {}

  private view(row: InstanceProvisioning) {
    return {
      id: row.id,
      productId: row.productId,
      vpsProviderId: row.vpsProviderId,
      instanceName: row.instanceName,
      state: row.state,
      revision: row.revision,
      instanceId: row.instanceId,
      providerInstanceId: row.providerInstanceId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      leaseExpiresAt: row.leaseExpiresAt,
      errorCode: row.errorCode,
      evidence: readEvidence(row.outcomeEvidence),
      actions: OPEN_PROVISIONING_STATES.includes(row.state)
        ? [
            'reconcile',
            ...(row.state === 'uncertain' && !row.instanceId
              ? ['release_absent']
              : []),
          ]
        : [],
    };
  }

  async list(
    providerId: string,
    query: { state: 'open' | 'all'; limit: number; cursor?: string },
  ) {
    if (
      !(await this.prisma.vpsProvider.findUnique({ where: { id: providerId } }))
    )
      throw new NotFoundException('Evolution não encontrada');
    const rows = await this.prisma.instanceProvisioning.findMany({
      where: {
        vpsProviderId: providerId,
        ...(query.state === 'open'
          ? { state: { in: OPEN_PROVISIONING_STATES } }
          : {}),
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return {
      items: rows.slice(0, query.limit).map((row) => this.view(row)),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null,
    };
  }

  private async noLocalConflict(
    tx: Prisma.TransactionClient,
    row: InstanceProvisioning,
  ) {
    const identities = [
      { productId: row.productId, instanceName: row.instanceName },
      { vpsProviderId: row.vpsProviderId, instanceName: row.instanceName },
    ];
    const remoteId =
      row.providerInstanceId ??
      readEvidence(row.outcomeEvidence).create?.remoteId;
    if (
      row.instanceId ||
      (await tx.instance.findFirst({
        where: {
          OR: [
            ...identities,
            ...(remoteId
              ? [
                  {
                    vpsProviderId: row.vpsProviderId,
                    providerInstanceId: remoteId,
                  },
                ]
              : []),
          ],
        },
      })) ||
      (await tx.instanceProvisioning.findFirst({
        where: {
          id: { not: row.id },
          state: { in: OPEN_PROVISIONING_STATES },
          OR: identities,
        },
      }))
    )
      throw new ConflictException(
        'Há identidade ou operação associada; reconcilie a instância',
      );
  }

  async resolve(
    providerId: string,
    id: string,
    input: ResolutionInput,
    actor: string,
  ) {
    const candidate = await this.prisma.instanceProvisioning.findFirst({
      where: { id, vpsProviderId: providerId },
    });
    if (!candidate)
      throw new NotFoundException('Provisionamento não encontrado');
    const budget = Math.min(
      this.config.get<number>('EVOLUTION_RECOVERY_TIMEOUT_MS', 30000),
      Math.max(1000, this.config.get<number>('PROXY_TIMEOUT_MS', 15000) - 2000),
    );
    const execution = new QrRequestContext(budget, budget);
    const claimed = await this.prisma.$transaction(async (tx) => {
      await lockProduct(tx, candidate.productId);
      const provider = await lockProvider(tx, providerId);
      const row = await tx.instanceProvisioning.findUniqueOrThrow({
        where: { id },
      });
      if (
        row.revision !== input.expectedRevision ||
        !OPEN_PROVISIONING_STATES.includes(row.state)
      )
        throw new ConflictException(
          'Estado ou revisão alterado; consulte novamente',
        );
      if (
        row.leaseOwner &&
        row.leaseExpiresAt &&
        row.leaseExpiresAt.getTime() > Date.now()
      )
        throw new ConflictException('Há executor ativo; aguarde sua conclusão');
      const evidence = readEvidence(row.outcomeEvidence);
      if (input.action === 'release_absent') {
        if (row.state !== 'uncertain' || !input.acknowledgeUncertainOutcome)
          throw new ConflictException(
            'A resolução exige pendência incerta e confirmação explícita',
          );
        const deadline = evidence.create?.deadlineAt;
        if (deadline && Date.parse(deadline) > Date.now())
          throw new ConflictException('Prazo original ainda em andamento');
        if (!deadline && !input.confirmExecutorsDrained)
          throw new ConflictException(
            'Confirme a drenagem dos executores antigos',
          );
        await this.noLocalConflict(tx, row);
      }
      execution.assertActive();
      const ticket = await tx.instanceProvisioning.update({
        where: { id },
        data: {
          leaseOwner: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + execution.remainingMs + 5000),
          revision: { increment: 1 },
          ...(input.action === 'reconcile'
            ? {
                outcomeEvidence: {
                  ...evidence,
                  resolution: {
                    action: input.action,
                    actor,
                    reason: input.reason,
                    observedAt: new Date().toISOString(),
                    expectedRevision: input.expectedRevision,
                    acknowledged: false,
                    executorsDrained: false,
                  },
                },
              }
            : {}),
        },
      });
      return { ticket, provider };
    });
    const { ticket, provider } = claimed;
    try {
      if (input.action === 'reconcile') {
        await this.recovery.recover(id, ticket, execution);
      } else {
        const remote = normalizeInventory(
          await this.adapters
            .resolve(provider.adapterType)
            .fetchInstances(this.provisioning.context(provider, execution)),
        );
        const remoteId =
          ticket.providerInstanceId ??
          readEvidence(ticket.outcomeEvidence).create?.remoteId;
        if (
          remote.some(
            (row) =>
              row.instanceName === ticket.instanceName ||
              (remoteId && row.providerInstanceId === remoteId),
          )
        )
          throw new ConflictException(
            'Instância presente na Evolution; liberação recusada',
          );
        execution.assertActive();
        await this.prisma.$transaction(async (tx) => {
          await lockProduct(tx, ticket.productId);
          const currentProvider = await lockProvider(tx, providerId);
          const row = await tx.instanceProvisioning.findUniqueOrThrow({
            where: { id },
          });
          if (
            row.revision !== ticket.revision ||
            row.leaseOwner !== ticket.leaseOwner ||
            row.state !== 'uncertain' ||
            !row.leaseExpiresAt ||
            row.leaseExpiresAt.getTime() <= Date.now() ||
            currentProvider.configurationRevision !==
              provider.configurationRevision ||
            currentProvider.occupancyRevision !== provider.occupancyRevision ||
            currentProvider.providerUrl !== provider.providerUrl ||
            currentProvider.providerApiKey !== provider.providerApiKey
          )
            throw new ConflictException(
              'Estado alterado durante consulta; repita a verificação',
            );
          await this.noLocalConflict(tx, row);
          execution.assertActive();
          await tx.instanceProvisioning.update({
            where: { id },
            data: {
              state: 'released',
              errorCode: 'admin_confirmed_remote_absence',
              linkProductId: null,
              linkVpsProviderId: null,
              leaseOwner: null,
              leaseExpiresAt: null,
              encryptedRequest: null,
              revision: { increment: 1 },
              outcomeEvidence: {
                ...readEvidence(row.outcomeEvidence),
                recovery: {
                  code: 'remote_absence_confirmed',
                  observedAt: new Date().toISOString(),
                },
                resolution: {
                  action: input.action,
                  actor,
                  reason: input.reason,
                  observedAt: new Date().toISOString(),
                  expectedRevision: input.expectedRevision,
                  acknowledged: true,
                  executorsDrained: input.confirmExecutorsDrained === true,
                },
              },
            },
          });
          await advanceOccupancy(tx, providerId);
        });
      }
      this.logger.log(
        `event=provisioning_resolution provisioningId=${id} action=${input.action}`,
      );
      return this.view(
        await this.prisma.instanceProvisioning.findUniqueOrThrow({
          where: { id },
        }),
      );
    } finally {
      // Do not destroy uncertainty evidence on failed administrative queries.
      await this.prisma.instanceProvisioning.updateMany({
        where: {
          id,
          leaseOwner: ticket.leaseOwner,
          state: { in: OPEN_PROVISIONING_STATES },
        },
        data: {
          leaseOwner: null,
          leaseExpiresAt: new Date(),
          revision: { increment: 1 },
        },
      });
    }
  }
}
