import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Product } from '@prisma/client';
import { canonicalEvolutionEndpoint } from '../../../prisma/evolution-identity';
import {
  evolutionReadiness,
  endpointAliases,
  isEvolutionBaseConsolidated,
} from '../../provisioning/evolution-controls';
import {
  detachBlockers,
  legacyBlockers,
} from '../../provisioning/evolution-reversal';
import { writerConfirmation } from '../../provisioning/evolution-setup';
import { EvolutionChangeInput } from './evolution-changes.dto';

export interface ChangeSnapshot {
  product: {
    revision: number;
    adapterType: string;
    hubRelay: boolean;
    isActive: boolean;
    defaultProviderId: string | null;
    mode: string;
  };
  links: Array<{
    vpsProviderId: string;
    configurationRevision: number;
    allocationPriority: number;
    acceptingNewInstances: boolean;
  }>;
  providers: Array<{
    id: string;
    revision: number;
    maxInstances: number | null;
    identityStatus: string;
    productIds: string[];
  }>;
}
export interface ChangeCheck {
  code: string;
  message: string;
  blocking: boolean;
  providerId?: string;
  observedAt: string;
}
export interface RequiredAction {
  code: string;
  providerId?: string;
  destination: string;
  instanceIds?: string[];
  productIds?: string[];
  instructions?: string[];
  suggestedProduct?: {
    allocationMode: 'legacy';
    hubRelay: true;
    vpsProviderId: string;
  };
}
export interface ChangeDiagnostics {
  checks: ChangeCheck[];
  requiredActions: RequiredAction[];
  affectedProducts: string[];
  ready: boolean;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function normalizeDraft(
  dto: EvolutionChangeInput,
): EvolutionChangeInput {
  const byId = <T extends { vpsProviderId: string }>(items: T[]) =>
    [...items].sort((a, b) => a.vpsProviderId.localeCompare(b.vpsProviderId));
  return {
    ...dto,
    links: byId(dto.links),
    providerUpdates: byId(dto.providerUpdates),
    confirmations: {
      identities: byId(dto.confirmations.identities),
      sharedLimits: byId(
        dto.confirmations.sharedLimits.map((item) => ({
          ...item,
          productIds: [...item.productIds].sort(),
        })),
      ),
    },
  };
}

export async function changeSnapshot(
  tx: Prisma.TransactionClient,
  product: Product,
  draft: EvolutionChangeInput,
): Promise<ChangeSnapshot> {
  const links = await tx.productEvolution.findMany({
    where: { productId: product.id },
    orderBy: { vpsProviderId: 'asc' },
    select: {
      vpsProviderId: true,
      configurationRevision: true,
      allocationPriority: true,
      acceptingNewInstances: true,
    },
  });
  const ids = [
    ...new Set([
      ...links.map((link) => link.vpsProviderId),
      ...draft.links.map((link) => link.vpsProviderId),
      ...draft.providerUpdates.map((item) => item.vpsProviderId),
      ...draft.confirmations.identities.map((item) => item.vpsProviderId),
      ...(draft.targetProviderId ? [draft.targetProviderId] : []),
    ]),
  ].sort();
  const providers: ChangeSnapshot['providers'] = [];
  for (const id of ids) {
    const provider = await tx.vpsProvider.findUnique({ where: { id } });
    if (!provider)
      throw new ConflictException('Evolution do rascunho não existe mais');
    const members = await tx.product.findMany({
      where: {
        OR: [
          { vpsProviderId: id },
          { evolutions: { some: { vpsProviderId: id } } },
        ],
      },
      select: { id: true },
    });
    const productIds = [
      ...new Set([
        ...members.map((p) => p.id),
        ...(draft.links.some((link) => link.vpsProviderId === id)
          ? [product.id]
          : []),
      ]),
    ].sort();
    providers.push({
      id,
      revision: provider.configurationRevision,
      maxInstances: provider.maxInstances,
      identityStatus: provider.identityStatus,
      productIds,
    });
  }
  return {
    product: {
      revision: product.allocationRevision,
      adapterType: product.adapterType,
      hubRelay: product.hubRelay,
      isActive: product.isActive,
      defaultProviderId: product.vpsProviderId,
      mode: product.allocationMode,
    },
    links,
    providers,
  };
}

const messages: Record<string, string> = {
  executor_pending:
    'Preparação na fila; a API fará as verificações automaticamente.',
  collection_running:
    'A API está verificando a configuração e consultando as Evolutions necessárias.',
  inventory_in_progress:
    'Outra verificação já está consultando esta Evolution; aguardando esse inventário.',
  inventory_incomplete:
    'A Evolution devolveu um inventário incompleto ou ambíguo; nenhum total foi presumido.',
  preparation_required:
    'O prazo desta tentativa terminou; prepare novamente com as evidências atuais.',
  preparation_failed:
    'A verificação não pôde ser concluída; a configuração ativa foi preservada.',
  callback_sync_uncertain:
    'Não foi possível confirmar a configuração do webhook. Antes de repetir, o Hub consultará o estado remoto.',
  distribution_disabled: 'Habilite a distribuição no ambiente da API.',
  database_not_consolidated: 'Conclua a preparação do banco no ambiente.',
  writers_unconfirmed:
    'O responsável deve confirmar a atualização das APIs e workers uma vez.',
  identity_unverified: 'Confirme qual instalação corresponde a esta Evolution.',
  endpoint_alias:
    'A mesma instalação aparece em mais de um cadastro; reutilize o cadastro existente.',
  callback_unconfirmed:
    'Ainda falta receber um evento autenticado desta Evolution.',
  inventory_unconfirmed:
    'É necessário confirmar um inventário recente e completo.',
  health_unconfirmed:
    'A Evolution ainda não tem confirmação recente de disponibilidade.',
  occupancy_ambiguous: 'Há sessões sem atribuição segura; revise o inventário.',
  no_capacity: 'Nenhum destino selecionado tem vaga disponível.',
  shared_limit_confirmation:
    'Revise o limite global e confirme os produtos afetados.',
  configuration_changed:
    'A configuração mudou; prepare novamente usando os dados atuais.',
  inventory_timeout: 'A coleta excedeu o prazo; tente preparar novamente.',
  credential_invalid: 'A Evolution recusou a credencial.',
  credential_unreadable: 'A API não conseguiu ler a credencial cadastrada.',
  provider_unavailable: 'Não foi possível consultar a Evolution.',
};
export function check(
  code: string,
  providerId?: string,
  blocking = true,
): ChangeCheck {
  return {
    code,
    providerId,
    blocking,
    message:
      messages[code] ??
      {
        provider_paused: 'A Evolution está pausada globalmente.',
        target_unavailable:
          'O destino escolhido não está disponível ou vinculado.',
        instances_outside_target:
          'Ainda existem instâncias em outros destinos; use destino único para novas criações.',
        default_provider: 'Este é o destino padrão do produto.',
        instances_present: 'Ainda há instâncias neste vínculo.',
        delivery_pending:
          'Existem entregas pendentes que dependem deste destino.',
        provisioning_pending: 'Aguarde a conclusão das criações em andamento.',
        capacity_full: 'Este destino atingiu seu limite.',
        provider_inactive: 'O cadastro está inativo.',
        vps_inactive: 'A VPS está inativa.',
        adapter_mismatch: 'O tipo de API é incompatível com o produto.',
        product_inactive: 'O produto está inativo.',
        provisioning_unresolved:
          'Há reservas cuja atribuição ainda precisa ser resolvida.',
        verified: 'Verificação concluída.',
      }[code] ??
      'A preparação exige revisão antes de continuar.',
    observedAt: new Date().toISOString(),
  };
}

export async function evaluateChange(
  tx: Prisma.TransactionClient,
  config: ConfigService,
  product: Product,
  draft: EvolutionChangeInput,
  snapshot: ChangeSnapshot,
): Promise<ChangeDiagnostics> {
  const checks: ChangeCheck[] = [];
  const requiredActions: RequiredAction[] = [];
  const add = (code: string, providerId?: string, blocking = true) =>
    checks.push(check(code, providerId, blocking));
  const current = await changeSnapshot(tx, product, draft);
  if (canonicalJson(current) !== canonicalJson(snapshot))
    add('configuration_changed');
  const affectedProducts = [
    ...new Set([
      product.id,
      ...snapshot.providers
        .filter(
          (p) =>
            draft.providerUpdates.some((u) => u.vpsProviderId === p.id) ||
            draft.confirmations.identities.some(
              (i) => i.vpsProviderId === p.id,
            ),
        )
        .flatMap((p) => p.productIds),
    ]),
  ].sort();
  if (draft.action === 'restore_legacy' || draft.action === 'detach') {
    const reasons =
      draft.action === 'restore_legacy'
        ? await legacyBlockers(tx, product, draft.targetProviderId!)
        : await detachBlockers(tx, product, draft.targetProviderId!);
    for (const reason of reasons) add(reason, draft.targetProviderId);
    if (
      !snapshot.links.some(
        (link) => link.vpsProviderId === draft.targetProviderId,
      )
    )
      add('target_unavailable', draft.targetProviderId);
  } else {
    if (!config.get<boolean>('EVOLUTION_ALLOCATION_ENABLED', false))
      add('distribution_disabled');
    if (!(await isEvolutionBaseConsolidated(tx)))
      add('database_not_consolidated');
    if (!(await writerConfirmation(tx))) add('writers_unconfirmed');
    if (!product.isActive) add('product_inactive');
    const links = new Map(
      snapshot.links.map((link) => [link.vpsProviderId, { ...link }]),
    );
    for (const item of draft.links)
      links.set(item.vpsProviderId, {
        configurationRevision: 0,
        allocationPriority: 0,
        acceptingNewInstances: false,
        ...links.get(item.vpsProviderId),
        ...item,
      });
    if (draft.action === 'single_destination') {
      if (!links.has(draft.targetProviderId!))
        add('target_unavailable', draft.targetProviderId);
      for (const [id, link] of links)
        link.acceptingNewInstances = id === draft.targetProviderId;
    }
    let vacant = false;
    for (const link of links.values()) {
      const original = await tx.vpsProvider.findUniqueOrThrow({
        where: { id: link.vpsProviderId },
      });
      const confirmation = draft.confirmations.identities.find(
        (item) => item.vpsProviderId === original.id,
      );
      const update = draft.providerUpdates.find(
        (item) => item.vpsProviderId === original.id,
      );
      const provider = {
        ...original,
        ...(update ? { maxInstances: update.maxInstances } : {}),
        ...(confirmation
          ? {
              identityStatus: 'verified',
              canonicalEndpoint: canonicalEvolutionEndpoint(
                original.providerUrl,
              ),
            }
          : {}),
      };
      const { blockers, used } = await evolutionReadiness(
        tx,
        provider,
        config,
        link.acceptingNewInstances && product.hubRelay,
      );
      if (!provider.acceptingNewInstances) blockers.push('provider_paused');
      if (
        provider.adapterType !== product.adapterType ||
        provider.adapterType !== 'evolution'
      )
        blockers.push('adapter_mismatch');
      const full =
        provider.maxInstances !== null &&
        used.effective >= provider.maxInstances;
      for (const code of blockers)
        add(code, provider.id, link.acceptingNewInstances);
      if (full) add('capacity_full', provider.id, false);
      if (!blockers.length && link.acceptingNewInstances && !full)
        vacant = true;
      if (!blockers.length) add('verified', provider.id, false);
      if (
        blockers.includes('callback_unconfirmed') &&
        link.acceptingNewInstances
      ) {
        const instances = await tx.instance.findMany({
          where: {
            productId: product.id,
            vpsProviderId: provider.id,
            isActive: true,
          },
          select: { id: true },
        });
        requiredActions.push(
          instances.length
            ? {
                code: 'confirm_instance_webhook',
                providerId: provider.id,
                destination: 'callback-check',
                instanceIds: instances.map((i) => i.id),
              }
            : {
                code: 'use_dedicated_test_product',
                providerId: provider.id,
                destination: 'test-product-setup',
                suggestedProduct: {
                  allocationMode: 'legacy',
                  hubRelay: true,
                  vpsProviderId: provider.id,
                },
                instructions: [
                  'Escolha ou cadastre um produto dedicado a testes com este destino padrão e relay habilitado.',
                  'Crie e conecte uma instância de teste por ação explícita na administração desse produto.',
                  'Aguarde um evento autenticado da Evolution e prepare novamente a configuração do produto original.',
                  'Mantenha os IDs do produto e da instância de teste para eventual limpeza explícita. Esses recursos contam na ocupação e no impacto do limite.',
                ],
              },
        );
      }
    }
    if (!vacant) add('no_capacity');
    // Even a paused link cannot certify an invalid/aliased physical identity.
    for (const identity of draft.confirmations.identities) {
      const provider = await tx.vpsProvider.findUniqueOrThrow({
        where: { id: identity.vpsProviderId },
      });
      if (!canonicalEvolutionEndpoint(provider.providerUrl))
        add('identity_unverified', provider.id);
      if ((await endpointAliases(tx, provider.providerUrl, provider.id)).length)
        add('endpoint_alias', provider.id);
    }
    // Setting a global limit also protects legacy products sharing a paused link.
    for (const update of draft.providerUpdates) {
      const observed = snapshot.providers.find(
        (p) => p.id === update.vpsProviderId,
      )!;
      if (
        update.maxInstances !== observed.maxInstances &&
        observed.productIds.length > 1
      ) {
        const accepted = draft.confirmations.sharedLimits.find(
          (i) => i.vpsProviderId === update.vpsProviderId,
        );
        if (
          !accepted ||
          accepted.expectedRevision !== observed.revision ||
          accepted.maxInstances !== update.maxInstances ||
          canonicalJson(accepted.productIds) !==
            canonicalJson(observed.productIds)
        ) {
          add('shared_limit_confirmation', update.vpsProviderId);
          requiredActions.push({
            code: 'confirm_shared_limit',
            providerId: update.vpsProviderId,
            destination: 'draft-review',
            productIds: observed.productIds,
          });
        }
      }
      if (update.maxInstances !== null) {
        const original = await tx.vpsProvider.findUniqueOrThrow({
          where: { id: update.vpsProviderId },
        });
        const confirmed = draft.confirmations.identities.some(
          (i) => i.vpsProviderId === original.id,
        );
        const state = await evolutionReadiness(
          tx,
          {
            ...original,
            ...(confirmed
              ? {
                  identityStatus: 'verified',
                  canonicalEndpoint: canonicalEvolutionEndpoint(
                    original.providerUrl,
                  ),
                }
              : {}),
          },
          config,
        );
        for (const code of state.blockers)
          if (
            !checks.some(
              (c) =>
                c.code === code && c.providerId === original.id && c.blocking,
            )
          )
            add(code, original.id);
      }
    }
  }
  for (const item of checks.filter(
    (c) =>
      c.blocking &&
      c.code !== 'callback_unconfirmed' &&
      c.code !== 'shared_limit_confirmation',
  ))
    requiredActions.push({
      code: item.code,
      providerId: item.providerId,
      destination: [
        'writers_unconfirmed',
        'distribution_disabled',
        'database_not_consolidated',
      ].includes(item.code)
        ? 'environment-setup'
        : 'draft-review',
    });
  return {
    checks,
    requiredActions,
    affectedProducts,
    ready: !checks.some((c) => c.blocking),
  };
}
