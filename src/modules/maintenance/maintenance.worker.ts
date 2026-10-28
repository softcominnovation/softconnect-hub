import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InstanceMaintenanceAction,
  InstanceMaintenanceObservation,
  Prisma,
  ProviderMaintenancePolicy,
  VpsProvider,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { invalidateInstanceCache } from '../../cache/instance-cache';
import {
  EvolutionMaintenanceClient,
  MaintenanceLogoutError,
} from '../../adapters/evolution/evolution.maintenance';
import { canonicalEvolutionEndpoint } from '../../prisma/evolution-identity';
import { EvolutionProvisioningService } from '../provisioning/evolution-provisioning.service';
import {
  lockProvider,
  OPEN_PROVISIONING_STATES,
} from '../provisioning/evolution-locks';
import {
  fingerprint,
  HEARTBEAT_KEY,
  LEASE_MS,
  maintenanceSettings,
  manualLeases,
  PENDING_ACTIONS,
} from './maintenance.config';
import {
  eligibleObservation,
  MaintenanceRemote,
  observeConnecting,
} from './maintenance.observation';
import { dispatchDisconnect } from './logout-recovery';

type Lease = {
  provider: VpsProvider;
  policy: ProviderMaintenancePolicy;
  owner: string;
  token: number;
};
type Cycle = { deadline: number; signal: AbortSignal; remaining: number };

@Injectable()
export class MaintenanceWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MaintenanceWorker.name);
  private timer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private heartbeatRunning?: Promise<void>;
  private abort?: AbortController;
  private stopped = false;
  private cursor = '';
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
    private readonly client: EvolutionMaintenanceClient,
    private readonly provisioning: EvolutionProvisioningService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get('RUNTIME_MODE') !== 'worker-maintenance') return;
    const tick = () => {
      if (!this.running && !this.stopped)
        this.running = this.scan()
          .catch(() => this.logger.error('event=maintenance_cycle_failed'))
          .finally(() => {
            this.running = undefined;
          });
    };
    this.timer = setInterval(tick, maintenanceSettings(this.config).interval);
    this.heartbeatTimer = setInterval(() => this.startHeartbeat(), 30000);
    this.startHeartbeat();
    tick();
  }
  private startHeartbeat() {
    if (!this.heartbeatRunning)
      this.heartbeatRunning = this.heartbeat().finally(() => {
        this.heartbeatRunning = undefined;
      });
  }
  private async heartbeat() {
    const settings = maintenanceSettings(this.config);
    try {
      await this.cache.setWithTTL(
        HEARTBEAT_KEY,
        {
          at: new Date().toISOString(),
          fingerprint: fingerprint(settings),
          enabled: settings.enabled,
        },
        90,
      );
    } catch {
      this.logger.warn('event=maintenance_heartbeat_unavailable');
    }
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearInterval(this.timer);
    clearInterval(this.heartbeatTimer);
    this.abort?.abort();
    await this.running;
    await this.heartbeatRunning;
  }

  async scan() {
    const settings = maintenanceSettings(this.config);
    if (!settings.enabled || this.stopped) return;
    const schema = await this.db.$queryRaw<
      Array<{ ready: boolean }>
    >`SELECT to_regclass('public."ProviderMaintenancePolicy"') IS NOT NULL AND to_regclass('public."InstanceMaintenanceObservation"') IS NOT NULL AND to_regclass('public."InstanceMaintenanceAction"') IS NOT NULL AND (SELECT count(*) FROM "_prisma_migrations" WHERE migration_name IN ('20261021000000_provider_maintenance','20261021010000_maintenance_destination') AND finished_at IS NOT NULL AND rolled_back_at IS NULL)=2 AS ready`;
    if (!schema[0]?.ready) {
      this.logger.warn('event=maintenance_waiting_for_migration');
      return;
    }
    const policies = await this.db.providerMaintenancePolicy.findMany({
      where: {
        enabled: true,
        provider: { isActive: true, adapterType: 'evolution' },
      },
      select: { providerId: true },
      orderBy: { providerId: 'asc' },
    });
    const ordered = [
      ...policies.filter((p) => p.providerId > this.cursor),
      ...policies.filter((p) => p.providerId <= this.cursor),
    ];
    this.abort = new AbortController();
    const timer = setTimeout(() => this.abort?.abort(), settings.cycleTimeout);
    const cycle: Cycle = {
      deadline: Date.now() + settings.cycleTimeout,
      signal: this.abort.signal,
      remaining: settings.maxActions,
    };
    let index = 0;
    try {
      await Promise.all(
        Array.from({ length: settings.concurrency }, async () => {
          while (
            index < ordered.length &&
            !cycle.signal.aborted &&
            !this.stopped
          ) {
            const id = ordered[index++].providerId;
            if (index === 1) this.cursor = id;
            try {
              await this.processProvider(id, cycle);
            } catch {
              this.logger.error(
                `event=maintenance_provider_failed providerId=${id}`,
              );
            }
          }
        }),
      );
      const cutoff = new Date(Date.now() - settings.retention * 86400000);
      const expired = await this.db.instanceMaintenanceAction.findMany({
        where: {
          state: { in: ['simulated', 'succeeded', 'failed', 'skipped'] },
          updatedAt: { lt: cutoff },
        },
        select: { id: true },
        take: 100,
      });
      if (expired.length)
        await this.db.instanceMaintenanceAction.deleteMany({
          where: {
            id: { in: expired.map((a) => a.id) },
            state: { notIn: PENDING_ACTIONS },
          },
        });
    } finally {
      clearTimeout(timer);
      this.abort = undefined;
    }
  }

  private async now(tx: Prisma.TransactionClient) {
    const [row] = await tx.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS now`;
    return row.now;
  }
  private async acquire(id: string): Promise<Lease | null> {
    return this.db.$transaction(async (tx) => {
      const provider = await lockProvider(tx, id);
      const policy = await tx.providerMaintenancePolicy.findUnique({
        where: { providerId: id },
      });
      const now = await this.now(tx);
      if (
        !policy?.enabled ||
        !provider.isActive ||
        provider.adapterType !== 'evolution' ||
        (policy.leaseUntil && policy.leaseUntil > now)
      )
        return null;
      const owner = randomUUID();
      const next = await tx.providerMaintenancePolicy.update({
        where: { providerId: id },
        data: {
          leaseOwner: owner,
          leaseUntil: new Date(now.getTime() + LEASE_MS),
          fencingToken: { increment: 1 },
          lastAttemptAt: now,
        },
      });
      return { provider, policy: next, owner, token: next.fencingToken };
    });
  }
  private async check(lease: Lease, tx: Prisma.TransactionClient = this.db) {
    const policy = await tx.providerMaintenancePolicy.findUnique({
      where: { providerId: lease.provider.id },
    });
    const provider = await tx.vpsProvider.findUnique({
      where: { id: lease.provider.id },
    });
    const now = await this.now(tx);
    if (
      this.stopped ||
      !maintenanceSettings(this.config).enabled ||
      !policy?.enabled ||
      !provider?.isActive ||
      provider.adapterType !== 'evolution' ||
      policy.revision !== lease.policy.revision ||
      policy.generation !== lease.policy.generation ||
      policy.leaseOwner !== lease.owner ||
      policy.fencingToken !== lease.token ||
      !policy.leaseUntil ||
      policy.leaseUntil <= now ||
      provider.configurationRevision !== lease.provider.configurationRevision
    )
      throw new Error('policy_or_lease_changed');
    return { policy, provider, now };
  }
  private async remote<T>(lease: Lease, cycle: Cycle, call: () => Promise<T>) {
    await this.check(lease);
    if (cycle.signal.aborted || Date.now() >= cycle.deadline)
      throw new Error('deadline');
    return call();
  }

  private async processProvider(id: string, cycle: Cycle) {
    const lease = await this.acquire(id);
    if (!lease) return;
    let renewal: Promise<unknown> | undefined;
    const timer = setInterval(() => {
      if (!renewal)
        renewal = this.db
          .$executeRaw`UPDATE "ProviderMaintenancePolicy" SET "leaseUntil"=clock_timestamp()+interval '180 seconds' WHERE "providerId"=${id} AND "leaseOwner"=${lease.owner} AND "fencingToken"=${lease.token} AND "leaseUntil">clock_timestamp()`
          .catch(() => 0)
          .finally(() => {
            renewal = undefined;
          });
    }, 30000);
    try {
      const endpoint = canonicalEvolutionEndpoint(lease.provider.providerUrl);
      if (!endpoint) throw new Error('provider_identity_invalid');
      const others = await this.db.vpsProvider.findMany({
        where: { adapterType: 'evolution', id: { not: id } },
        select: { providerUrl: true },
      });
      if (
        others.some(
          (p) => canonicalEvolutionEndpoint(p.providerUrl) === endpoint,
        )
      )
        throw new Error('provider_identity_ambiguous');
      const inventory = await this.remote(lease, cycle, () =>
        this.client.inventory(lease.provider, cycle.signal, cycle.deadline),
      );
      const pending = await this.db.instanceMaintenanceAction.findMany({
        where: {
          providerId: id,
          state: { in: PENDING_ACTIONS },
          OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: new Date() } }],
        },
        take: 20,
        orderBy: { createdAt: 'asc' },
      });
      for (const action of pending) {
        await this.confirm(lease, action, inventory, cycle);
      }
      const observations = await this.record(lease, inventory);
      for (const observation of observations) {
        if (cycle.remaining <= 0 || cycle.signal.aborted) {
          this.logger.log('event=maintenance_skip reason=cycle_action_limit');
          break;
        }
        if (
          eligibleObservation(
            observation,
            new Date(),
            lease.policy.connectingMaxAgeMinutes ??
              maintenanceSettings(this.config).age,
            maintenanceSettings(this.config).gap,
          )
        )
          await this.execute(lease, observation, cycle);
      }
      await this.check(lease);
      await this.db.providerMaintenancePolicy.updateMany({
        where: {
          providerId: id,
          leaseOwner: lease.owner,
          fencingToken: lease.token,
        },
        data: { lastSuccessAt: new Date(), lastErrorCode: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code =
        /^(inventory_invalid|provider_identity_invalid|provider_identity_ambiguous|policy_or_lease_changed|deadline|state_invalid|transport_unconfirmed|credential_or_transport_error|upstream_\d{3})$/.test(
          message,
        )
          ? message
          : 'verification_failed';
      await this.db.providerMaintenancePolicy
        .updateMany({
          where: {
            providerId: id,
            leaseOwner: lease.owner,
            fencingToken: lease.token,
          },
          data: { lastErrorCode: code },
        })
        .catch(() => undefined);
      this.logger.error(
        `event=maintenance_provider_failed providerId=${id} code=${code}`,
      );
    } finally {
      clearInterval(timer);
      await renewal;
      await this.db.providerMaintenancePolicy.updateMany({
        where: {
          providerId: id,
          leaseOwner: lease.owner,
          fencingToken: lease.token,
        },
        data: { leaseOwner: null, leaseUntil: null },
      });
    }
  }

  private async record(lease: Lease, inventory: MaintenanceRemote[]) {
    return this.db.$transaction(
      async (tx) => {
        await lockProvider(tx, lease.provider.id);
        const { policy, now } = await this.check(lease, tx);
        if (Object.keys(manualLeases(policy.manualLeases, now)).length)
          return [];
        const instances = await tx.instance.findMany({
          where: { vpsProviderId: lease.provider.id },
          take: 10001,
        });
        if (instances.length > 10000) throw new Error('inventory_invalid');
        const previous = await tx.instanceMaintenanceObservation.findMany({
          where: { providerId: lease.provider.id },
        });
        const byName = new Map(inventory.map((r) => [r.name, r]));
        const oldById = new Map(previous.map((r) => [r.instanceId, r]));
        const result: InstanceMaintenanceObservation[] = [];
        const generation = fingerprint([
          policy.generation,
          lease.provider.configurationRevision,
          policy.connectingMaxAgeMinutes ??
            maintenanceSettings(this.config).age,
        ]);
        for (const instance of instances) {
          const remote = byName.get(instance.instanceName);
          if (!remote) {
            await tx.instanceMaintenanceObservation.updateMany({
              where: { providerId: lease.provider.id, instanceId: instance.id },
              data: {
                connectingObservedSince: null,
                samples: 0,
                reason: 'identity_unproven',
                remoteStatus: 'unknown',
              },
            });
            continue;
          }
          if (instance.providerInstanceId !== remote.id) {
            await tx.instance.update({
              where: { id: instance.id },
              data: { providerInstanceId: remote.id },
            });
          }
          const data = observeConnecting(
            oldById.get(instance.id) ?? null,
            remote,
            generation,
            now,
            maintenanceSettings(this.config).gap,
          );
          result.push(
            await tx.instanceMaintenanceObservation.upsert({
              where: {
                providerId_instanceId: {
                  providerId: lease.provider.id,
                  instanceId: instance.id,
                },
              },
              create: {
                providerId: lease.provider.id,
                instanceId: instance.id,
                productId: instance.productId,
                ...data,
              },
              update: data,
            }),
          );
        }
        return result;
      },
      { timeout: 30000 },
    );
  }

  private async busy(
    tx: Prisma.TransactionClient,
    instanceId: string,
    providerId: string,
    name: string,
  ) {
    return !!(
      (await tx.instanceProvisioning.findFirst({
        where: {
          vpsProviderId: providerId,
          OR: [{ instanceId }, { instanceName: name }],
          state: { in: OPEN_PROVISIONING_STATES },
        },
      })) ||
      (await tx.instanceMaintenanceAction.findFirst({
        where: {
          providerId,
          instanceName: name,
          state: { in: PENDING_ACTIONS },
        },
      })) ||
      (await tx.batchJob.findFirst({
        where: { instanceId, status: 'processing' },
      })) ||
      (await tx.pendingRelayEvent.findFirst({
        where: { instanceId, state: { in: ['pending', 'waiting'] } },
      })) ||
      (await tx.evolutionChange.findFirst({
        where: {
          product: { evolutions: { some: { vpsProviderId: providerId } } },
          status: { in: ['queued', 'running', 'preparing', 'applying'] },
        },
      }))
    );
  }

  private async execute(
    lease: Lease,
    observation: InstanceMaintenanceObservation,
    cycle: Cycle,
  ) {
    if (
      await this.db.instanceMaintenanceAction.findUnique({
        where: {
          providerId_instanceId_episode_action: {
            providerId: lease.provider.id,
            instanceId: observation.instanceId,
            episode: observation.episode,
            action: lease.policy.action,
          },
        },
      })
    )
      return;
    if (
      cycle.deadline - Date.now() <
      maintenanceSettings(this.config).httpTimeout * 4
    )
      return;
    const inventory = await this.remote(lease, cycle, () =>
      this.client.inventory(lease.provider, cycle.signal, cycle.deadline),
    );
    if (
      !inventory.some(
        (r) =>
          r.name === observation.instanceName &&
          r.status === 'connecting',
      )
    )
      return;
    const state = await this.remote(lease, cycle, () =>
      this.client.state(
        lease.provider,
        observation.instanceName,
        cycle.signal,
        cycle.deadline,
      ),
    );
    const simulated =
      maintenanceSettings(this.config).dryRun ||
      lease.policy.mode === 'observe';
    const stuckClosed =
      state === 'close' && lease.policy.action === 'disconnect' && !simulated;
    if (state !== 'connecting' && !stuckClosed) {
      this.logger.log(
        `event=maintenance_skip reason=live_state state=${state} instance=${observation.instanceName}`,
      );
      await this.db.instanceMaintenanceObservation.updateMany({
        where: { id: observation.id, episode: observation.episode },
        data: {
          connectingObservedSince: null,
          samples: 0,
          reason: 'live_state_divergence',
        },
      });
      return;
    }
    if (cycle.remaining <= 0) return;
    cycle.remaining--;
    const action = await this.db.$transaction(async (tx) => {
      await lockProvider(tx, lease.provider.id);
      const { policy, now } = await this.check(lease, tx);
      if (Object.keys(manualLeases(policy.manualLeases, now)).length)
        return null;
      const current = await tx.instanceMaintenanceObservation.findUnique({
        where: { id: observation.id },
      });
      const instance = await tx.instance.findUnique({
        where: { id: observation.instanceId },
      });
      if (
        !current ||
        current.episode !== observation.episode ||
        !eligibleObservation(
          current,
          now,
          policy.connectingMaxAgeMinutes ??
            maintenanceSettings(this.config).age,
          maintenanceSettings(this.config).gap,
        ) ||
        !instance ||
        instance.vpsProviderId !== lease.provider.id ||
        instance.instanceName !== observation.instanceName ||
        instance.productId !== observation.productId ||
        (await this.busy(
          tx,
          instance.id,
          lease.provider.id,
          instance.instanceName,
        ))
      )
        return null;
      const key = {
        providerId: lease.provider.id,
        instanceId: instance.id,
        episode: observation.episode,
        action: policy.action,
      };
      if (
        await tx.instanceMaintenanceAction.findUnique({
          where: { providerId_instanceId_episode_action: key },
        })
      )
        return null;
      return tx.instanceMaintenanceAction.create({
        data: {
          ...key,
          productId: instance.productId,
          instanceName: instance.instanceName,
          remoteId: observation.remoteId,
          providerRevision: lease.provider.configurationRevision,
          destinationFingerprint: fingerprint(
            canonicalEvolutionEndpoint(lease.provider.providerUrl),
          ),
          policyRevision: policy.revision,
          state: simulated ? 'simulated' : 'dispatching',
        },
      });
    });
    if (!action) return;
    if (simulated) {
      this.logger.log(
        `event=maintenance_action result=simulated actionId=${action.id}`,
      );
      return;
    }
    try {
      if (action.action === 'disconnect') {
        const outcome = await dispatchDisconnect({
          name: action.instanceName,
          sawConnecting: true,
          expired: () => cycle.signal.aborted || Date.now() >= cycle.deadline,
          logout: () =>
            this.remote(lease, cycle, () =>
              this.client.act(
                lease.provider,
                action.instanceName,
                'disconnect',
                cycle.signal,
                cycle.deadline,
              ),
            ),
          state: () =>
            this.remote(lease, cycle, () =>
              this.client.state(
                lease.provider,
                action.instanceName,
                cycle.signal,
                cycle.deadline,
              ),
            ),
          connect: () =>
            this.remote(lease, cycle, () =>
              this.client.connect(
                lease.provider,
                action.instanceName,
                cycle.signal,
                cycle.deadline,
              ),
            ),
          report: (result, fields = {}) => {
            const detail = Object.entries(fields)
              .map(([key, value]) => `${key}=${value}`)
              .join(' ');
            this.logger.log(
              `event=maintenance_logout result=${result} actionId=${action.id} instance=${action.instanceName}${detail ? ` ${detail}` : ''}`,
            );
          },
        });
        if (outcome !== 'confirm') {
          this.logger.error(
            `event=maintenance_action result=${outcome === 'skipped_open' ? 'recovery_skipped' : 'recovery_failed'} actionId=${action.id} instance=${action.instanceName}`,
          );
          await this.db.instanceMaintenanceAction.update({
            where: { id: action.id },
            data:
              outcome === 'skipped_open'
                ? { state: 'skipped', reason: 'logout_recovery_open' }
                : { state: 'failed', reason: 'logout_recovery_failed' },
          });
          return;
        }
      } else {
        await this.remote(lease, cycle, () =>
          this.client.act(
            lease.provider,
            action.instanceName,
            action.action,
            cycle.signal,
            cycle.deadline,
          ),
        );
      }
      await this.db.instanceMaintenanceAction.update({
        where: { id: action.id },
        data: { state: 'confirming' },
      });
    } catch (error) {
      const status =
        error instanceof MaintenanceLogoutError ? error.status : '';
      const code = error instanceof Error ? error.message : 'logout_failed';
      this.logger.error(
        `event=maintenance_action result=logout_failed actionId=${action.id} instance=${action.instanceName} code=${code} status=${status}`,
      );
      await this.db.instanceMaintenanceAction.update({
        where: { id: action.id },
        data: { state: 'uncertain', reason: 'remote_result_unconfirmed' },
      });
    }
    try {
      const after = await this.remote(lease, cycle, () =>
        this.client.inventory(lease.provider, cycle.signal, cycle.deadline),
      );
      await this.confirm(lease, action, after, cycle);
    } catch {
      this.logger.error(
        `event=maintenance_action result=unconfirmed actionId=${action.id}`,
      );
    }
  }

  private async confirm(
    lease: Lease,
    action: InstanceMaintenanceAction,
    inventory: MaintenanceRemote[],
    cycle: Cycle,
  ) {
    await this.check(lease);
    const defer = () =>
      this.db.instanceMaintenanceAction.update({
        where: { id: action.id },
        data: {
          state:
            action.state === 'local_cleanup_pending'
              ? 'local_cleanup_pending'
              : 'uncertain',
          attempts: { increment: 1 },
          nextCheckAt: new Date(
            Date.now() +
              Math.min(3600000, 60000 * 2 ** Math.min(action.attempts, 6)),
          ),
          reason: 'remote_result_unconfirmed',
        },
      });
    if (
      action.destinationFingerprint !==
      fingerprint(canonicalEvolutionEndpoint(lease.provider.providerUrl))
    ) {
      await defer();
      return;
    }
    const original = inventory.find((r) => r.id === action.remoteId);
    const sameName = inventory.find((r) => r.name === action.instanceName);
    if (action.action === 'delete') {
      if (original || sameName) {
        await defer();
        return;
      }
      await this.db.instanceMaintenanceAction.update({
        where: { id: action.id },
        data: { state: 'local_cleanup_pending', reason: null },
      });
      try {
        await this.check(lease);
        await this.provisioning.removeConfirmed(
          action.instanceId,
          action.productId,
          action.providerId,
          undefined,
          { remoteId: action.remoteId, name: action.instanceName },
          async (tx) => {
            await this.check(lease, tx);
          },
        );
      } catch {
        this.logger.error(
          `event=maintenance_cleanup_pending actionId=${action.id}`,
        );
        return;
      }
    } else {
      if (!sameName) {
        await defer();
        return;
      }
      const state = await this.remote(lease, cycle, () =>
        this.client.state(
          lease.provider,
          action.instanceName,
          cycle.signal,
          cycle.deadline,
        ),
      );
      if (state !== 'close') {
        await defer();
        return;
      }
      const instance = await this.db.instance.findUnique({
        where: { id: action.instanceId },
      });
      if (instance && instance.instanceName === action.instanceName)
        await invalidateInstanceCache(this.cache, instance);
    }
    await this.check(lease);
    await this.db.instanceMaintenanceAction.update({
      where: { id: action.id },
      data: { state: 'succeeded', reason: null, nextCheckAt: null },
    });
    await this.db.instanceMaintenanceObservation.updateMany({
      where: { instanceId: action.instanceId },
      data: {
        connectingObservedSince: null,
        samples: 0,
        reason: 'action_confirmed',
      },
    });
    this.logger.log(
      `event=maintenance_action result=confirmed actionId=${action.id}`,
    );
  }
}
