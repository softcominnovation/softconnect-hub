import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  assertRevision,
  evolutionUsage,
  inventoryFresh,
  isEvolutionBaseConsolidated,
  lockEvolutionCatalog,
} from '../../provisioning/evolution-controls';
import {
  databaseIdentity,
  EVOLUTION_REQUIREMENTS_VERSION,
  writerConfirmation,
} from '../../provisioning/evolution-setup';
import { lockProvider } from '../../provisioning/evolution-locks';
import { pendingProvisionings } from '../../provisioning/evolution-reversal';
import { RetirementDto, SetupConfirmationDto } from './evolution-changes.dto';

export async function recordEvolutionActivity(
  tx: Prisma.TransactionClient,
  actor: string,
  action: string,
  detail: object,
) {
  // Machine JWTs have no AdminUser FK. The operation/confirmation retains their actor.
  if (
    await tx.adminUser.findUnique({
      where: { id: actor },
      select: { id: true },
    })
  )
    await tx.adminActivityLog.create({
      data: { adminUserId: actor, action, detail: JSON.stringify(detail) },
    });
  else
    await tx.evolutionAdminEvent.create({
      data: {
        actor,
        action,
        detail: JSON.parse(JSON.stringify(detail)) as Prisma.InputJsonValue,
      },
    });
}

@Injectable()
export class EvolutionSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async state(tx: Prisma.TransactionClient = this.prisma) {
    const confirmation = await writerConfirmation(tx);
    const current = await tx.evolutionSetupConfirmation.findUnique({
      where: { requirementsVersion: EVOLUTION_REQUIREMENTS_VERSION },
    });
    return {
      distributionEnabled: this.config.get<boolean>(
        'EVOLUTION_ALLOCATION_ENABLED',
        false,
      ),
      databaseConsolidated: await isEvolutionBaseConsolidated(tx),
      requirementsVersion: EVOLUTION_REQUIREMENTS_VERSION,
      confirmationRequired: !confirmation,
      revision: current?.revision ?? 0,
      confirmation: confirmation
        ? { actor: confirmation.actor, confirmedAt: confirmation.confirmedAt }
        : null,
    };
  }

  async confirm(dto: SetupConfirmationDto, actor: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockEvolutionCatalog(tx);
      const state = await this.state(tx);
      assertRevision(state.revision, dto.expectedRevision);
      if (!dto.writersCompatible || !state.databaseConsolidated)
        throw new ConflictException(
          'Consolide o banco e confirme todos os escritores',
        );
      const data = {
        databaseIdentity: await databaseIdentity(tx),
        actor,
        confirmedAt: new Date(),
        revision: state.revision + 1,
      };
      await tx.evolutionSetupConfirmation.upsert({
        where: { requirementsVersion: EVOLUTION_REQUIREMENTS_VERSION },
        create: {
          requirementsVersion: EVOLUTION_REQUIREMENTS_VERSION,
          ...data,
        },
        update: data,
      });
      await recordEvolutionActivity(tx, actor, 'evolution.setup.confirm', {
        requirementsVersion: EVOLUTION_REQUIREMENTS_VERSION,
        revision: data.revision,
      });
      return this.state(tx);
    });
  }

  async removal(
    providerId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const provider = await tx.vpsProvider.findUnique({
      where: { id: providerId },
    });
    if (!provider) throw new NotFoundException('Evolution não encontrada');
    const usage = await evolutionUsage(tx, providerId);
    const ambiguousEvents = await tx.pendingRelayEvent.findMany({
      where: { vpsProviderId: null, state: { not: 'delivered' } },
      select: {
        originEvidence: true,
        instance: { select: { vpsProviderId: true } },
      },
    });
    // Legacy ingress can retain several candidate origins without selecting a
    // provider. Those pending deliveries still prevent retiring a candidate.
    usage.callbacks += ambiguousEvents.filter((event) => {
      if (event.instance) return event.instance.vpsProviderId === providerId;
      const evidence = event.originEvidence as {
        providerIds?: string[];
      } | null;
      return (
        !evidence?.providerIds?.length ||
        evidence.providerIds.includes(providerId)
      );
    }).length;
    const pending = await pendingProvisionings(tx, undefined, providerId);
    const reconciliation = await tx.evolutionReconciliation.count({
      where: {
        vpsProviderId: providerId,
        OR: [
          { status: { in: ['pending', 'running'] } },
          { leaseOwner: { not: null } },
          { leaseExpiresAt: { not: null } },
        ],
      },
    });
    const fresh =
      provider.inventoryStatus === 'ready' &&
      inventoryFresh(
        provider,
        this.config.get<number>('EVOLUTION_INVENTORY_MAX_AGE_MS', 300000),
      );
    const blockers = Object.entries({ ...usage, pending, reconciliation })
      .filter(([, count]) => count > 0)
      .map(([key]) => `${key}_present`);
    if (!fresh) blockers.push('inventory_unconfirmed');
    const instancesByProduct = await tx.instance.groupBy({
      by: ['productId'],
      where: { vpsProviderId: providerId },
      _count: { _all: true },
    });
    return {
      providerId,
      isActive: provider.isActive,
      revision: provider.configurationRevision,
      inventoryRevision: provider.inventoryRevision,
      inventoryObservedAt: provider.inventoryObservedAt,
      usage: { ...usage, pending, reconciliation },
      instancesByProduct,
      blockers,
      removable: !blockers.length,
    };
  }

  async retire(providerId: string, dto: RetirementDto, actor: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockEvolutionCatalog(tx);
      const provider = await lockProvider(tx, providerId);
      if (!provider.isActive) return this.removal(providerId, tx);
      assertRevision(provider.configurationRevision, dto.expectedRevision);
      assertRevision(provider.inventoryRevision, dto.expectedInventoryRevision);
      const readiness = await this.removal(providerId, tx);
      if (!readiness.removable)
        throw new ConflictException({
          message: 'Evolution ainda em uso ou sem inventário vazio recente',
          blockers: readiness.blockers,
        });
      await tx.vpsProvider.update({
        where: { id: providerId },
        data: { isActive: false, configurationRevision: { increment: 1 } },
      });
      await recordEvolutionActivity(tx, actor, 'evolution.retire', {
        providerId,
        before: true,
        after: false,
      });
      return this.removal(providerId, tx);
    });
    // Retirement requires zero product references; no authentication cache is removed.
    return result;
  }
}
