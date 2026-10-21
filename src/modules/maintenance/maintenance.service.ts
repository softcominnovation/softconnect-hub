import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { lockProvider } from '../provisioning/evolution-locks';
import { MaintenancePolicyInput } from './maintenance.dto';
import {
  fingerprint,
  HEARTBEAT_KEY,
  maintenanceSettings,
  PENDING_ACTIONS,
} from './maintenance.config';
import { eligibleObservation } from './maintenance.observation';

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  private async readProvider(tx: Prisma.TransactionClient, id: string) {
    const provider = await tx.vpsProvider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException('Provider não encontrado');
    if (provider.adapterType !== 'evolution')
      throw new BadRequestException(
        'Manutenção disponível somente para Evolution',
      );
    return provider;
  }

  async scope(tx: Prisma.TransactionClient, id: string) {
    const links = await tx.productEvolution.findMany({
      where: { vpsProviderId: id },
      orderBy: { productId: 'asc' },
      include: { product: { select: { id: true, name: true } } },
    });
    return {
      affectedProducts: links.map((l) => l.product),
      scopeFingerprint: fingerprint(
        links.map((l) => [l.productId, l.configurationRevision]),
      ),
    };
  }

  async get(id: string) {
    const settings = maintenanceSettings(this.config);
    const data = await this.db.$transaction(async (tx) => {
      const provider = await this.readProvider(tx, id);
      const policy = await tx.providerMaintenancePolicy.findUnique({
        where: { providerId: id },
      });
      const scope = await this.scope(tx, id);
      const observations = await tx.instanceMaintenanceObservation.findMany({
        where: { providerId: id },
      });
      const pendingConfirmation = await tx.instanceMaintenanceAction.count({
        where: { providerId: id, state: { in: PENDING_ACTIONS } },
      });
      const age = policy?.connectingMaxAgeMinutes ?? settings.age;
      const now = new Date();
      return {
        provider,
        policy,
        scope,
        counts: {
          observedConnecting: observations.filter(
            (o) => o.remoteStatus === 'connecting',
          ).length,
          eligible: observations.filter((o) =>
            eligibleObservation(o, now, age, settings.gap),
          ).length,
          pendingConfirmation,
        },
      };
    });
    const heartbeat = await this.cache
      .get<{ at: string; fingerprint: string; enabled: boolean }>(HEARTBEAT_KEY)
      .catch(() => null);
    const matches =
      !!heartbeat && heartbeat.fingerprint === fingerprint(settings);
    const fresh = !!heartbeat && Date.now() - Date.parse(heartbeat.at) < 90000;
    const p = data.policy;
    const blockers: Array<{ code: string; message: string }> = [];
    if (!settings.enabled)
      blockers.push({
        code: 'master_disabled',
        message: 'Manutenção global desabilitada na API.',
      });
    if (!p?.enabled)
      blockers.push({
        code: 'provider_disabled',
        message: 'Verificação desabilitada neste provider.',
      });
    if (settings.dryRun)
      blockers.push({
        code: 'global_dry_run',
        message: 'Simulação global ativa: nenhuma instância será alterada.',
      });
    if (!data.provider.isActive)
      blockers.push({
        code: 'provider_inactive',
        message: 'Cadastro do provider inativo.',
      });
    if (!fresh)
      blockers.push({
        code: 'worker_unavailable',
        message: 'Worker sem confirmação recente.',
      });
    if (heartbeat && !matches)
      blockers.push({
        code: 'configuration_mismatch',
        message: 'API e worker usam configurações globais diferentes.',
      });
    if (p?.lastErrorCode)
      blockers.push({
        code: p.lastErrorCode,
        message:
          'Última verificação não foi concluída com segurança. Consulte o histórico e os logs do worker.',
      });
    return {
      providerId: id,
      revision: p?.revision ?? 0,
      providerRevision: data.provider.configurationRevision,
      ...data.scope,
      policy: {
        enabled: p?.enabled ?? false,
        mode: p?.mode ?? 'observe',
        action: p?.action ?? 'disconnect',
        connectingMaxAgeMinutes: p?.connectingMaxAgeMinutes ?? null,
      },
      effective: {
        enabled: settings.enabled && !!p?.enabled && data.provider.isActive,
        mode: settings.dryRun ? 'observe' : (p?.mode ?? 'observe'),
        connectingMaxAgeMinutes: p?.connectingMaxAgeMinutes ?? settings.age,
        intervalMs: settings.interval,
        maxObservationGapMs: settings.gap,
      },
      scope: 'hub_managed',
      worker: {
        status: !heartbeat
          ? 'unknown'
          : !fresh
            ? 'stale'
            : !heartbeat.enabled
              ? 'disabled'
              : 'online',
        lastSeenAt: heartbeat?.at ?? null,
        configurationMatches: matches,
      },
      monitoring: {
        lastAttemptAt: p?.lastAttemptAt ?? null,
        lastSuccessAt: p?.lastSuccessAt ?? null,
        nextCheckAt:
          p?.enabled && p.lastAttemptAt
            ? new Date(p.lastAttemptAt.getTime() + settings.interval)
            : null,
        lastErrorCode: p?.lastErrorCode ?? null,
        lastErrorMessage: p?.lastErrorCode
          ? 'Verificação não concluída; nenhuma conclusão remota foi presumida.'
          : null,
      },
      counts: data.counts,
      blockers,
    };
  }

  async update(id: string, input: MaintenancePolicyInput, actor: string) {
    await this.db.$transaction(async (tx) => {
      const provider = await lockProvider(tx, id);
      if (provider.adapterType !== 'evolution')
        throw new BadRequestException(
          'Manutenção disponível somente para Evolution',
        );
      const current = await tx.providerMaintenancePolicy.findUnique({
        where: { providerId: id },
      });
      const scope = await this.scope(tx, id);
      if (
        (current?.revision ?? 0) !== input.expectedRevision ||
        provider.configurationRevision !== input.expectedProviderRevision ||
        scope.scopeFingerprint !== input.expectedScopeFingerprint
      )
        throw new ConflictException(
          'Configuração ou produtos vinculados alterados; atualize a leitura antes de confirmar.',
        );
      const age =
        input.connectingMaxAgeMinutes ?? maintenanceSettings(this.config).age;
      const oldAge =
        current?.connectingMaxAgeMinutes ??
        maintenanceSettings(this.config).age;
      const needsConfirmation =
        input.enabled &&
        (!current?.enabled ||
          (input.mode === 'execute' &&
            (current.mode !== 'execute' ||
              current.action !== input.action ||
              age < oldAge)));
      if (
        needsConfirmation &&
        (!input.confirmation ||
          input.confirmation.action !== input.action ||
          (input.mode === 'execute' &&
            input.action === 'delete' &&
            !input.confirmation.acknowledgePermanentDeletion))
      )
        throw new BadRequestException(
          'Confirme a habilitação, a ação e o alcance nos produtos deste provider.',
        );
      const value = {
        enabled: input.enabled,
        mode: input.mode,
        action: input.action,
        connectingMaxAgeMinutes: input.connectingMaxAgeMinutes,
        actor,
        generation: randomUUID(),
      };
      await tx.providerMaintenancePolicy.upsert({
        where: { providerId: id },
        create: { providerId: id, ...value, revision: 1 },
        update: { ...value, revision: { increment: 1 } },
      });
      await tx.instanceMaintenanceObservation.updateMany({
        where: { providerId: id },
        data: {
          connectingObservedSince: null,
          samples: 0,
          reason: 'policy_changed',
        },
      });
    });
    return this.get(id);
  }

  async page(
    id: string,
    kind: 'observations' | 'actions',
    query: { cursor?: string; limit: number },
  ) {
    await this.readProvider(this.db, id);
    if (query.cursor) {
      const where = { id: query.cursor, providerId: id };
      const found =
        kind === 'actions'
          ? await this.db.instanceMaintenanceAction.findFirst({ where })
          : await this.db.instanceMaintenanceObservation.findFirst({ where });
      if (!found)
        throw new BadRequestException('Cursor inválido para este provider');
    }
    const options = {
      where: { providerId: id },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    };
    const settings = maintenanceSettings(this.config);
    const policy = await this.db.providerMaintenancePolicy.findUnique({
      where: { providerId: id },
    });
    const rows =
      kind === 'actions'
        ? await this.db.instanceMaintenanceAction.findMany({
            ...options,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          })
        : (
            await this.db.instanceMaintenanceObservation.findMany({
              ...options,
              orderBy: { id: 'asc' },
            })
          ).map((row) => ({
            ...row,
            eligible:
              settings.enabled &&
              !!policy?.enabled &&
              eligibleObservation(
                row,
                new Date(),
                policy.connectingMaxAgeMinutes ?? settings.age,
                settings.gap,
              ),
            observedConnectingMs:
              row.connectingObservedSince &&
              Date.now() - row.lastObservedAt.getTime() <= settings.gap
                ? Math.max(
                    0,
                    Date.now() - row.connectingObservedSince.getTime(),
                  )
                : null,
          }));
    const more = rows.length > query.limit;
    return {
      items: rows.slice(0, query.limit),
      nextCursor: more ? rows[query.limit - 1].id : null,
    };
  }
}
