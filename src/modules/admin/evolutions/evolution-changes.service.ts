import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvolutionChange, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { CacheService } from '../../../cache/cache.service';
import { decryptAES256GCM } from '../../../common/crypto.util';
import { QrRequestContext } from '../../../common/qr-request-context';
import { PrismaService } from '../../../prisma/prisma.service';
import { canonicalEvolutionEndpoint } from '../../../prisma/evolution-identity';
import {
  assertRevision,
  lockEvolutionCatalog,
} from '../../provisioning/evolution-controls';
import { EvolutionInventoryService } from '../../provisioning/evolution-inventory.service';
import { lockProduct, lockProvider } from '../../provisioning/evolution-locks';
import { EvolutionRecoveryService } from '../../provisioning/evolution-recovery.service';
import { detachEmptyLink } from '../../provisioning/evolution-reversal';
import { ProductsService } from '../products/products.service';
import {
  CallbackCheckDto,
  EvolutionChangeInput,
} from './evolution-changes.dto';
import {
  canonicalJson,
  ChangeDiagnostics,
  ChangeSnapshot,
  changeSnapshot,
  check,
  evaluateChange,
  normalizeDraft,
} from './evolution-change-checks';
import { recordEvolutionActivity } from './evolution-setup.service';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const terminal = ['applied', 'cancelled', 'expired', 'failed'];
interface CallbackWork {
  instanceId: string;
  providerId: string;
  state: 'queued' | 'syncing' | 'configured' | 'uncertain';
  actor: string;
}

@Injectable()
export class EvolutionChangesService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly active = new Map<string, QrRequestContext>();
  private stopped = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
    private readonly inventory: EvolutionInventoryService,
    private readonly recovery: EvolutionRecoveryService,
    private readonly products: ProductsService,
  ) {}

  onApplicationBootstrap() {
    this.recovery.registerAdministrativePreparation(() => this.processNext());
  }
  onModuleDestroy() {
    this.stopped = true;
    for (const execution of this.active.values())
      execution.abort('request_timeout');
  }

  private async row(
    productId: string,
    id: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const row = await tx.evolutionChange.findFirst({
      where: { id, productId },
    });
    if (!row)
      throw new NotFoundException('Preparação não encontrada neste produto');
    return row;
  }
  private async lock(
    tx: Prisma.TransactionClient,
    productId: string,
    draft: EvolutionChangeInput,
  ) {
    await lockEvolutionCatalog(tx);
    const product = await lockProduct(tx, productId);
    const snapshot = await changeSnapshot(tx, product, draft);
    for (const provider of snapshot.providers)
      await lockProvider(tx, provider.id);
    return { product, snapshot: await changeSnapshot(tx, product, draft) };
  }
  private validateDraft(draft: EvolutionChangeInput, snapshot: ChangeSnapshot) {
    assertRevision(snapshot.product.revision, draft.expectedRevision);
    const linked = new Set([
      ...snapshot.links.map((l) => l.vpsProviderId),
      ...draft.links.map((l) => l.vpsProviderId),
    ]);
    for (const item of draft.links) {
      const previous = snapshot.links.find(
        (link) => link.vpsProviderId === item.vpsProviderId,
      );
      if (
        previous
          ? item.expectedRevision !== previous.configurationRevision
          : item.expectedRevision !== undefined
      )
        throw new ConflictException('Revise os vínculos do rascunho');
    }
    for (const item of [
      ...draft.providerUpdates,
      ...draft.confirmations.identities,
      ...draft.confirmations.sharedLimits,
    ]) {
      if (!linked.has(item.vpsProviderId))
        throw new ConflictException(
          'Mudança global exige vínculo explícito no produto',
        );
      assertRevision(
        snapshot.providers.find((p) => p.id === item.vpsProviderId)!.revision,
        item.expectedRevision,
      );
    }
    for (const identity of draft.confirmations.identities)
      if (
        snapshot.providers.find((p) => p.id === identity.vpsProviderId)!
          .identityStatus === 'verified'
      )
        throw new ConflictException(
          'Identidade já confirmada; atualize o rascunho',
        );
    for (const impact of draft.confirmations.sharedLimits)
      if (
        !draft.providerUpdates.some(
          (p) =>
            p.vpsProviderId === impact.vpsProviderId &&
            p.maxInstances === impact.maxInstances,
        )
      )
        throw new ConflictException(
          'Aceite de limite não corresponde ao rascunho',
        );
  }
  async create(productId: string, input: EvolutionChangeInput, actor: string) {
    const draft = normalizeDraft(input);
    const hash = createHash('sha256')
      .update(canonicalJson(draft))
      .digest('hex');
    const row = await this.prisma.$transaction(async (tx) => {
      const { snapshot } = await this.lock(tx, productId, draft);
      const previous = await tx.evolutionChange.findUnique({
        where: {
          productId_requestId: { productId, requestId: draft.requestId },
        },
      });
      if (previous) {
        if (previous.requestHash !== hash)
          throw new ConflictException(
            'requestId já utilizado com outro conteúdo',
          );
        return previous;
      }
      this.validateDraft(draft, snapshot);
      return tx.evolutionChange.create({
        data: {
          productId,
          requestId: draft.requestId,
          requestHash: hash,
          action: draft.action,
          actor,
          draft: json(draft),
          snapshot: json(snapshot),
          executionDeadline: new Date(Date.now() + 120000),
          expiresAt: new Date(Date.now() + 1800000),
        },
      });
    });
    return this.view(row);
  }
  private view(row: EvolutionChange) {
    const diagnostics = row.diagnostics as unknown as ChangeDiagnostics | null;
    const expired = row.status === 'expired';
    return {
      operationId: row.id,
      productId: row.productId,
      action: row.action,
      status: row.status,
      revision: row.revision,
      stage: row.stage,
      actor: row.actor,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      executionDeadline: row.executionDeadline,
      expiresAt: row.expiresAt,
      affectedProducts: diagnostics?.affectedProducts ?? [row.productId],
      checks: expired
        ? [check('preparation_required')]
        : (diagnostics?.checks ?? [
            check(
              row.status === 'running'
                ? 'collection_running'
                : 'executor_pending',
              undefined,
              false,
            ),
          ]),
      requiredActions: expired
        ? [{ code: 'prepare_again', destination: 'draft-review' }]
        : row.status === 'cancelled'
          ? []
          : (diagnostics?.requiredActions ?? []),
      draft: row.draft,
      callback: row.callback,
      result: row.result,
    };
  }
  private async expire(row: EvolutionChange) {
    if (terminal.includes(row.status)) return row;
    if (
      row.expiresAt.getTime() <= Date.now() ||
      (['queued', 'running'].includes(row.status) &&
        row.executionDeadline.getTime() <= Date.now())
    ) {
      await this.prisma.evolutionChange.updateMany({
        where: { id: row.id, revision: row.revision, status: row.status },
        data: {
          status: 'expired',
          stage: 'prepare_again',
          leaseOwner: null,
          leaseExpiresAt: null,
          revision: { increment: 1 },
        },
      });
      return this.row(row.productId, row.id);
    }
    return row;
  }
  async get(productId: string, id: string) {
    let row = await this.expire(await this.row(productId, id));
    if (['ready', 'action_required'].includes(row.status)) {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const product = await tx.product.findUniqueOrThrow({
            where: { id: productId },
          });
          return evaluateChange(
            tx,
            this.config,
            product,
            row.draft as unknown as EvolutionChangeInput,
            row.snapshot as unknown as ChangeSnapshot,
          );
        },
        { isolationLevel: 'RepeatableRead' },
      );
      if (
        row.status === 'action_required' &&
        row.executionDeadline.getTime() <= Date.now()
      ) {
        result.checks.push(check('preparation_required'));
        result.requiredActions.push({
          code: 'prepare_again',
          destination: 'draft-review',
        });
        result.ready = false;
      }
      const callback = row.callback as unknown as CallbackWork | null;
      if (callback?.state === 'uncertain') {
        result.checks.push(
          check('callback_sync_uncertain', callback.providerId, false),
        );
      }
      const prior = row.diagnostics as unknown as ChangeDiagnostics | null;
      for (const item of prior?.checks ?? []) {
        if (
          ![
            'credential_unreadable',
            'credential_invalid',
            'inventory_timeout',
            'inventory_incomplete',
            'provider_unavailable',
            'inventory_in_progress',
          ].includes(item.code)
        )
          continue;
        const provider = item.providerId
          ? await this.prisma.vpsProvider.findUnique({
              where: { id: item.providerId },
            })
          : null;
        if (!provider || !this.inventory.isFresh(provider)) {
          result.checks.push(item);
          result.requiredActions.push({
            code: item.code,
            providerId: item.providerId,
            destination: 'draft-review',
          });
          result.ready = false;
        }
      }
      const stable = (d: ChangeDiagnostics | null) =>
        d
          ? canonicalJson({
              ...d,
              checks: d.checks.map((c) => ({
                code: c.code,
                message: c.message,
                providerId: c.providerId,
                blocking: c.blocking,
              })),
            })
          : '';
      if (
        stable(result) !== stable(prior) ||
        row.status !== (result.ready ? 'ready' : 'action_required')
      )
        await this.prisma.evolutionChange.updateMany({
          where: { id, revision: row.revision, status: row.status },
          data: {
            diagnostics: json(result),
            status: result.ready ? 'ready' : 'action_required',
            stage: result.ready ? 'review' : 'required_actions',
            revision: { increment: 1 },
          },
        });
      row = await this.row(productId, id);
    }
    return this.view(row);
  }
  async list(productId: string) {
    if (
      !(await this.prisma.product.findUnique({
        where: { id: productId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Produto não encontrado');
    const rows = await this.prisma.evolutionChange.findMany({
      where: { productId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 25,
    });
    return {
      items: await Promise.all(rows.map((row) => this.get(productId, row.id))),
    };
  }
  async cancel(productId: string, id: string, revision: number, actor: string) {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockProduct(tx, productId);
      const current = await this.row(productId, id, tx);
      if (current.status === 'cancelled') return current;
      if (current.status === 'applied')
        throw new ConflictException(
          'Configuração aplicada; prepare uma reversão',
        );
      assertRevision(current.revision, revision);
      await recordEvolutionActivity(tx, actor, 'evolution.change.cancel', {
        operationId: id,
      });
      return tx.evolutionChange.update({
        where: { id },
        data: {
          status: 'cancelled',
          stage: 'cancelled',
          leaseOwner: null,
          leaseExpiresAt: null,
          revision: { increment: 1 },
        },
      });
    });
    this.active.get(id)?.abort('client_disconnected');
    return this.view(row);
  }
  async callbackCheck(
    productId: string,
    id: string,
    dto: CallbackCheckDto,
    actor: string,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const product = await lockProduct(tx, productId);
      const current = await this.row(productId, id, tx);
      assertRevision(current.revision, dto.expectedOperationRevision);
      if (
        !dto.confirmWebhookUpdate ||
        !product.hubRelay ||
        current.status !== 'action_required' ||
        current.executionDeadline.getTime() <= Date.now()
      )
        throw new ConflictException(
          'Prepare novamente antes de configurar o webhook',
        );
      const instance = await tx.instance.findFirst({
        where: { id: dto.instanceId, productId, isActive: true },
      });
      const diagnostics =
        current.diagnostics as unknown as ChangeDiagnostics | null;
      if (
        !instance ||
        !diagnostics?.requiredActions.some(
          (action) =>
            action.code === 'confirm_instance_webhook' &&
            action.providerId === instance.vpsProviderId &&
            action.instanceIds?.includes(instance.id),
        )
      )
        throw new ConflictException(
          'Selecione uma instância própria indicada nesta preparação',
        );
      await recordEvolutionActivity(tx, actor, 'evolution.change.callback', {
        operationId: id,
        instanceId: instance.id,
      });
      return tx.evolutionChange.update({
        where: { id },
        data: {
          status: 'queued',
          stage: 'callback_queued',
          callback: json({
            instanceId: instance.id,
            providerId: instance.vpsProviderId,
            state: 'queued',
            actor,
          }),
          revision: { increment: 1 },
        },
      });
    });
    return this.view(row);
  }

  async apply(productId: string, id: string, revision: number, actor: string) {
    await this.expire(await this.row(productId, id));
    const result = await this.prisma.$transaction(
      async (tx) => {
        const initial = await this.row(productId, id, tx);
        const draft = initial.draft as unknown as EvolutionChangeInput;
        const { product, snapshot } = await this.lock(tx, productId, draft);
        const current = await this.row(productId, id, tx);
        if (current.status === 'applied') return current;
        assertRevision(current.revision, revision);
        if (
          current.status !== 'ready' ||
          current.expiresAt.getTime() <= Date.now()
        )
          throw new ConflictException('Preparação não está pronta ou expirou');
        const diagnostics = await evaluateChange(
          tx,
          this.config,
          product,
          draft,
          current.snapshot as unknown as ChangeSnapshot,
        );
        if (!diagnostics.ready)
          throw new ConflictException({
            message: 'Prepare novamente; as condições mudaram',
            checks: diagnostics.checks.filter((c) => c.blocking),
          });
        for (const update of draft.providerUpdates)
          await tx.vpsProvider.update({
            where: { id: update.vpsProviderId },
            data: {
              maxInstances: update.maxInstances,
              configurationRevision: { increment: 1 },
            },
          });
        for (const identity of draft.confirmations.identities) {
          const provider = await tx.vpsProvider.findUniqueOrThrow({
            where: { id: identity.vpsProviderId },
          });
          await tx.vpsProvider.update({
            where: { id: provider.id },
            data: {
              identityStatus: 'verified',
              canonicalEndpoint: canonicalEvolutionEndpoint(
                provider.providerUrl,
              ),
              configurationRevision: { increment: 1 },
            },
          });
        }
        for (const link of draft.links)
          await tx.productEvolution.upsert({
            where: {
              productId_vpsProviderId: {
                productId,
                vpsProviderId: link.vpsProviderId,
              },
            },
            create: {
              productId,
              vpsProviderId: link.vpsProviderId,
              allocationPriority: link.allocationPriority,
              acceptingNewInstances: link.acceptingNewInstances ?? false,
            },
            update: {
              allocationPriority: link.allocationPriority,
              acceptingNewInstances: link.acceptingNewInstances,
              configurationRevision: { increment: 1 },
            },
          });
        if (draft.action === 'single_destination') {
          await tx.productEvolution.updateMany({
            where: {
              productId,
              vpsProviderId: { not: draft.targetProviderId },
            },
            data: {
              acceptingNewInstances: false,
              configurationRevision: { increment: 1 },
            },
          });
          await tx.productEvolution.update({
            where: {
              productId_vpsProviderId: {
                productId,
                vpsProviderId: draft.targetProviderId!,
              },
            },
            data: {
              acceptingNewInstances: true,
              configurationRevision: { increment: 1 },
            },
          });
        }
        if (draft.action === 'detach')
          await detachEmptyLink(tx, product, draft.targetProviderId!);
        await tx.product.update({
          where: { id: productId },
          data: {
            allocationRevision: { increment: 1 },
            ...(draft.action === 'restore_legacy'
              ? {
                  allocationMode: 'legacy',
                  vpsProviderId: draft.targetProviderId,
                }
              : draft.action !== 'detach'
                ? { allocationMode: 'capacity' }
                : {}),
          },
        });
        const after = await changeSnapshot(
          tx,
          await tx.product.findUniqueOrThrow({ where: { id: productId } }),
          draft,
        );
        const audit = {
          operationId: id,
          actor,
          before: snapshot,
          after,
          affectedProducts: diagnostics.affectedProducts,
        };
        await recordEvolutionActivity(
          tx,
          actor,
          'evolution.change.apply',
          audit,
        );
        return tx.evolutionChange.update({
          where: { id },
          data: {
            status: 'applied',
            stage: 'applied',
            result: json(audit),
            diagnostics: json(diagnostics),
            revision: { increment: 1 },
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
      },
      { timeout: 15000 },
    );
    const affected = (
      result.result as unknown as { affectedProducts: string[] }
    ).affectedProducts;
    const products = await this.prisma.product.findMany({
      where: { id: { in: affected } },
      select: { apiKeyHash: true },
    });
    await Promise.all(
      products.map((p) => this.cache.del(`auth:${p.apiKeyHash}`)),
    );
    return this.view(result);
  }

  async processNext() {
    if (
      this.stopped ||
      this.config.get<string>('RUNTIME_MODE', 'api') !== 'api'
    )
      return;
    const ticket = await this.prisma.$transaction(async (tx) => {
      // SKIP LOCKED permits other replicas to process another draft without duplicate effects.
      const [candidate] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "EvolutionChange" WHERE status IN ('queued','running')
          AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= CURRENT_TIMESTAMP)
        ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!candidate) return null;
      const row = await tx.evolutionChange.findUniqueOrThrow({
        where: { id: candidate.id },
      });
      if (row.executionDeadline.getTime() <= Date.now()) {
        await tx.evolutionChange.update({
          where: { id: row.id },
          data: {
            status: 'expired',
            stage: 'prepare_again',
            revision: { increment: 1 },
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        return null;
      }
      return tx.evolutionChange.update({
        where: { id: row.id },
        data: {
          status: 'running',
          stage: 'checking',
          leaseOwner: randomUUID(),
          leaseExpiresAt: new Date(
            Math.min(Date.now() + 10000, row.executionDeadline.getTime()),
          ),
          revision: { increment: 1 },
        },
      });
    });
    if (!ticket) return;
    const duration = Math.max(
      1,
      ticket.executionDeadline.getTime() - Date.now(),
    );
    const execution = new QrRequestContext(
      duration,
      Math.min(duration, this.config.get<number>('PROXY_TIMEOUT_MS', 15000)),
    );
    this.active.set(ticket.id, execution);
    const timer = setTimeout(
      () => execution.abort('request_timeout'),
      duration,
    );
    const poll = setInterval(() => {
      void this.prisma.evolutionChange
        .updateMany({
          where: {
            id: ticket.id,
            status: 'running',
            leaseOwner: ticket.leaseOwner,
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            leaseExpiresAt: new Date(
              Math.min(Date.now() + 10000, ticket.executionDeadline.getTime()),
            ),
          },
        })
        .then((result) => {
          if (!result.count) execution.abort('client_disconnected');
        })
        .catch(() => execution.abort('request_timeout'));
    }, 1000);
    const remoteErrors: ReturnType<typeof check>[] = [];
    let callback = ticket.callback as unknown as CallbackWork | null;
    try {
      const draft = ticket.draft as unknown as EvolutionChangeInput;
      const snapshot = ticket.snapshot as unknown as ChangeSnapshot;
      const product = await this.prisma.product.findUniqueOrThrow({
        where: { id: ticket.productId },
      });
      if (
        canonicalJson(await changeSnapshot(this.prisma, product, draft)) !==
        canonicalJson(snapshot)
      )
        throw new ConflictException('configuration_changed');
      if (callback && ['queued', 'syncing'].includes(callback.state)) {
        execution.assertActive();
        const instance = await this.prisma.instance.findFirst({
          where: {
            id: callback.instanceId,
            productId: product.id,
            vpsProviderId: callback.providerId,
            isActive: true,
          },
        });
        if (!instance || !product.hubRelay)
          throw new ConflictException('configuration_changed');
        callback = { ...callback, state: 'syncing' };
        await this.prisma.evolutionChange.updateMany({
          where: {
            id: ticket.id,
            leaseOwner: ticket.leaseOwner,
            status: 'running',
          },
          data: { callback: json(callback) },
        });
        try {
          const outcome = await this.products.syncRelay(
            product.id,
            callback.instanceId,
            execution,
          );
          callback.state = outcome.synced === 1 ? 'configured' : 'uncertain';
        } catch {
          callback.state = 'uncertain';
        }
      }
      if (['configure_capacity', 'single_destination'].includes(draft.action))
        for (const reference of snapshot.providers) {
          execution.assertActive();
          const provider = await this.prisma.vpsProvider.findUniqueOrThrow({
            where: { id: reference.id },
          });
          const selected =
            draft.action === 'single_destination'
              ? reference.id === draft.targetProviderId
              : (draft.links.find((l) => l.vpsProviderId === reference.id)
                  ?.acceptingNewInstances ??
                snapshot.links.find((l) => l.vpsProviderId === reference.id)
                  ?.acceptingNewInstances ??
                false);
          const globalLimit = draft.providerUpdates.some(
            (u) => u.vpsProviderId === reference.id && u.maxInstances !== null,
          );
          if (
            (!selected && !globalLimit) ||
            !provider.isActive ||
            this.inventory.isFresh(provider)
          )
            continue;
          try {
            decryptAES256GCM(
              provider.providerApiKey,
              this.config.getOrThrow<string>('ENCRYPTION_KEY'),
            );
          } catch {
            remoteErrors.push(check('credential_unreadable', provider.id));
            continue;
          }
          // The existing collector owns its own lease; another operation may already be collecting.
          const active = await this.prisma.evolutionReconciliation.findFirst({
            where: {
              vpsProviderId: provider.id,
              status: 'running',
              leaseExpiresAt: { gt: new Date() },
            },
          });
          if (active) {
            remoteErrors.push(check('inventory_in_progress', provider.id));
            continue;
          }
          const callBudget = new QrRequestContext(
            Math.min(
              execution.remainingMs,
              this.config.get<number>('EVOLUTION_RECOVERY_TIMEOUT_MS', 30000),
            ),
            this.config.get<number>('PROXY_TIMEOUT_MS', 15000),
          );
          const abort = () =>
            callBudget.abort(execution.reason ?? 'request_timeout');
          execution.signal.addEventListener('abort', abort, { once: true });
          const callTimer = setTimeout(
            () => callBudget.abort('request_timeout'),
            callBudget.remainingMs,
          );
          try {
            await this.inventory.refresh(provider.id, callBudget);
          } catch (error) {
            remoteErrors.push(
              check(
                callBudget.signal.aborted ||
                  (error instanceof HttpException &&
                    [408, 504].includes(error.getStatus()))
                  ? 'inventory_timeout'
                  : error instanceof HttpException &&
                      [401, 403].includes(error.getStatus())
                    ? 'credential_invalid'
                    : error instanceof HttpException &&
                        error.getStatus() === 502
                      ? 'inventory_incomplete'
                      : 'provider_unavailable',
                provider.id,
              ),
            );
          } finally {
            clearTimeout(callTimer);
            execution.signal.removeEventListener('abort', abort);
          }
        }
      execution.assertActive();
      const diagnostics = await this.prisma.$transaction(
        async (tx) =>
          evaluateChange(
            tx,
            this.config,
            await tx.product.findUniqueOrThrow({ where: { id: product.id } }),
            draft,
            snapshot,
          ),
        { isolationLevel: 'RepeatableRead', timeout: 15000 },
      );
      diagnostics.checks.push(...remoteErrors);
      diagnostics.requiredActions.push(
        ...remoteErrors.map((e) => ({
          code: e.code,
          providerId: e.providerId,
          destination: 'draft-review',
        })),
      );
      if (callback?.state === 'uncertain')
        diagnostics.checks.push(
          check('callback_sync_uncertain', callback.providerId, false),
        );
      diagnostics.ready = !diagnostics.checks.some((c) => c.blocking);
      await this.prisma.evolutionChange.updateMany({
        where: {
          id: ticket.id,
          leaseOwner: ticket.leaseOwner,
          status: 'running',
        },
        data: {
          status: diagnostics.ready ? 'ready' : 'action_required',
          stage: diagnostics.ready ? 'review' : 'required_actions',
          diagnostics: json(diagnostics),
          callback: callback ? json(callback) : Prisma.DbNull,
          revision: { increment: 1 },
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    } catch (error) {
      await this.prisma.evolutionChange.updateMany({
        where: {
          id: ticket.id,
          leaseOwner: ticket.leaseOwner,
          status: 'running',
        },
        data: {
          status: execution.signal.aborted ? 'expired' : 'failed',
          stage: 'prepare_again',
          diagnostics: json({
            ready: false,
            affectedProducts: [ticket.productId],
            checks: [
              check(
                error instanceof ConflictException
                  ? 'configuration_changed'
                  : 'preparation_failed',
              ),
            ],
            requiredActions: [
              { code: 'prepare_again', destination: 'draft-review' },
            ],
          }),
          callback: callback ? json(callback) : Prisma.DbNull,
          revision: { increment: 1 },
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    } finally {
      clearInterval(poll);
      clearTimeout(timer);
      this.active.delete(ticket.id);
    }
  }
}
