import {
  Injectable,
  HttpException,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { QrRequestContext } from '../../common/qr-request-context';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import { EvolutionInventoryService } from './evolution-inventory.service';
import { EvolutionProvisioningService } from './evolution-provisioning.service';
import {
  advanceOccupancy,
  lockProvider,
  OPEN_PROVISIONING_STATES,
} from './evolution-locks';
import { normalizeInventory, remoteToken } from './evolution-occupancy';
import { decodePayload } from './provisioning-payload';

@Injectable()
export class EvolutionRecoveryService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(EvolutionRecoveryService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;
  private execution?: QrRequestContext;
  private administrativePreparation?: () => Promise<void>;
  private administrativeRunning = false;

  registerAdministrativePreparation(run: () => Promise<void>) {
    this.administrativePreparation = run;
  }

  async scanAdministrativePreparation() {
    if (
      this.stopped ||
      this.administrativeRunning ||
      !this.administrativePreparation
    )
      return;
    this.administrativeRunning = true;
    try {
      await this.administrativePreparation();
    } catch {
      this.logger.warn('event=evolution_preparation_scan_failed');
    } finally {
      this.administrativeRunning = false;
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: EvolutionProvisioningService,
    private readonly inventory: EvolutionInventoryService,
    private readonly adapters: AdapterResolverService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get<string>('RUNTIME_MODE', 'api') !== 'api') return;
    this.timer = setInterval(
      () => {
        void this.scan();
        // Independent bounded lane: neither a slow creation recovery nor an
        // administrative preparation can starve the other on this replica.
        void this.scanAdministrativePreparation();
      },
      this.config.get<number>('EVOLUTION_RECOVERY_INTERVAL_MS', 15000),
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.execution?.abort('request_timeout');
  }

  private budget() {
    const limit = this.config.get<number>(
      'EVOLUTION_RECOVERY_TIMEOUT_MS',
      30000,
    );
    return new QrRequestContext(limit, limit);
  }

  async scan() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const due = {
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: new Date() } }],
      };
      const rows = await this.prisma.instanceProvisioning.findMany({
        where: { ...due, state: { in: OPEN_PROVISIONING_STATES } },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 5,
      });
      for (const row of rows) {
        if (this.stopped) break;
        await this.recover(row.id);
      }
      const inventories = await this.prisma.evolutionReconciliation.findMany({
        where: { ...due, status: { in: ['pending', 'running'] } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 5,
      });
      for (const item of inventories) {
        if (this.stopped) break;
        const execution = (this.execution = this.budget());
        const timer = setTimeout(
          () => execution.abort('request_timeout'),
          execution.remainingMs,
        );
        try {
          await this.inventory.refresh(item.vpsProviderId, execution);
        } catch {
          this.logger.warn('event=evolution_inventory_unconfirmed');
        } finally {
          clearTimeout(timer);
          this.execution = undefined;
        }
      }
    } catch {
      this.logger.warn('event=evolution_recovery_scan_failed');
    } finally {
      this.running = false;
    }
  }

  async recover(id: string) {
    const execution = (this.execution = this.budget());
    const timer = setTimeout(
      () => execution.abort('request_timeout'),
      execution.remainingMs,
    );
    let ticket: Awaited<ReturnType<EvolutionRecoveryService['claim']>> = null;
    try {
      ticket = await this.claim(id, execution);
      if (!ticket) return;
      const provider = await this.prisma.vpsProvider.findUniqueOrThrow({
        where: { id: ticket.vpsProviderId },
      });
      const payload = decodePayload(
        ticket.encryptedRequest,
        this.config.getOrThrow<string>('ENCRYPTION_KEY'),
      );
      const adapter = this.adapters.resolve(provider.adapterType);
      const ctx = this.provisioning.context(provider, execution);
      execution.assertActive();
      const rows = await adapter.fetchInstances(ctx);
      const sessions = normalizeInventory(rows);
      const index = sessions.findIndex(
        (item) => item.instanceName === ticket!.instanceName,
      );
      // An empty snapshot after a possibly effective POST is not proof of failure.
      if (index < 0) {
        if (ticket.state === 'cleanup_pending' && ticket.instanceId)
          await this.provisioning.removeConfirmed(
            ticket.instanceId,
            ticket.productId,
            ticket.vpsProviderId,
            ticket,
          );
        return;
      }
      const session = sessions[index];
      const knownId =
        !!ticket.providerInstanceId &&
        ticket.providerInstanceId === session.providerInstanceId;
      // Client tokens can be shared by many sessions. Only a generated token is
      // sufficient evidence when the POST's remote ID was never received.
      const uniqueToken =
        !payload.clientToken && payload.token === remoteToken(rows[index]);
      if (!session.providerInstanceId || (!knownId && !uniqueToken)) return;
      if (
        ticket.providerInstanceId &&
        ticket.providerInstanceId !== session.providerInstanceId
      )
        return;
      execution.assertActive();
      if (ticket.state === 'cleanup_pending') {
        await this.provisioning.assertOwned(ticket);
        await adapter.deleteInstance(ctx, ticket.instanceName);
        if (ticket.instanceId)
          await this.provisioning.removeConfirmed(
            ticket.instanceId,
            ticket.productId,
            ticket.vpsProviderId,
            ticket,
          );
        return;
      }
      await this.provisioning.recordCreated(ticket, {
        instanceName: ticket.instanceName,
        instanceId: session.providerInstanceId,
        status: session.status ?? 'disconnected',
      });
      if (!payload.webhookApplied && payload.webhook) {
        if (!adapter.applyInstanceDefaults) return;
        execution.assertActive();
        await this.provisioning.assertOwned(ticket);
        try {
          await adapter.applyInstanceDefaults(ctx, ticket.instanceName, {
            webhook: payload.webhook,
          });
        } catch (error) {
          if (
            !execution.signal.aborted &&
            error instanceof HttpException &&
            ![408, 504].includes(error.getStatus())
          )
            await this.provisioning.markCleanup(ticket);
          throw error;
        }
        await this.provisioning.markWebhookApplied(ticket);
      }
      await this.provisioning.finish(ticket);
    } catch {
      this.logger.warn('event=evolution_provisioning_unconfirmed');
    } finally {
      clearTimeout(timer);
      this.execution = undefined;
      if (ticket) {
        try {
          await this.provisioning.abandon(ticket);
        } catch {
          this.logger.warn('event=evolution_recovery_release_failed');
        }
      }
    }
  }

  private async claim(id: string, execution: QrRequestContext) {
    const candidate = await this.prisma.instanceProvisioning.findUnique({
      where: { id },
    });
    if (!candidate) return null;
    return this.prisma.$transaction(async (tx) => {
      await lockProvider(tx, candidate.vpsProviderId);
      const row = await tx.instanceProvisioning.findUniqueOrThrow({
        where: { id },
      });
      if (
        !OPEN_PROVISIONING_STATES.includes(row.state) ||
        (row.leaseExpiresAt && row.leaseExpiresAt.getTime() > Date.now())
      )
        return null;
      execution.assertActive();
      if (row.state === 'reserved') {
        await tx.instanceProvisioning.update({
          where: { id },
          data: {
            state: 'released',
            linkProductId: null,
            linkVpsProviderId: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            encryptedRequest: null,
            errorCode: 'expired_before_send',
            revision: { increment: 1 },
          },
        });
        await advanceOccupancy(tx, row.vpsProviderId);
        return null;
      }
      return tx.instanceProvisioning.update({
        where: { id },
        data: {
          leaseOwner: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + execution.remainingMs + 5000),
          revision: { increment: 1 },
        },
      });
    });
  }
}
