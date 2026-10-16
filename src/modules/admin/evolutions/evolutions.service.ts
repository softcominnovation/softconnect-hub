import {
  assertNoBlockers,
  detachEmptyLink,
  legacyBlockers,
} from '../../provisioning/evolution-reversal';
import { writerConfirmation } from '../../provisioning/evolution-setup';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EvolutionReconciliation,
  Prisma,
  Product,
  VpsProvider,
} from '@prisma/client';
import { CacheService } from '../../../cache/cache.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  EvolutionInventoryService,
  readEvolutionOccupancy,
} from '../../provisioning/evolution-inventory.service';
import {
  lockProduct,
  lockProvider,
  OPEN_PROVISIONING_STATES,
} from '../../provisioning/evolution-locks';
import {
  assertRevision,
  assertWritersCompatible,
  evolutionReadiness,
  inventoryFresh,
  isEvolutionBaseConsolidated,
  lockEvolutionCatalog,
} from '../../provisioning/evolution-controls';
import { sameSession } from '../../provisioning/evolution-occupancy';
import { VpsProviderService } from '../vps/vps-provider.service';
import {
  AllocationDto,
  AttachEvolutionDto,
  CreateEvolutionDto,
  UpdateEvolutionDto,
  UpdateEvolutionLinkDto,
} from './evolution.dto';

@Injectable()
export class EvolutionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly providers: VpsProviderService,
    private readonly inventory: EvolutionInventoryService,
    private readonly cache: CacheService,
  ) {}

  private read<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(fn, { isolationLevel: 'RepeatableRead' });
  }

  private async provider(tx: Prisma.TransactionClient, id: string) {
    const provider = await tx.vpsProvider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException('Evolution não encontrada');
    return provider;
  }

  private async product(tx: Prisma.TransactionClient, id: string) {
    const product = await tx.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Produto não encontrado');
    return product;
  }

  private async link(
    tx: Prisma.TransactionClient,
    productId: string,
    providerId: string,
  ) {
    const link = await tx.productEvolution.findUnique({
      where: {
        productId_vpsProviderId: { productId, vpsProviderId: providerId },
      },
    });
    if (!link)
      throw new NotFoundException('Evolution não vinculada ao produto');
    return link;
  }

  private inventoryView(provider: VpsProvider) {
    const fresh = inventoryFresh(
      provider,
      this.config.get<number>('EVOLUTION_INVENTORY_MAX_AGE_MS', 300000),
    );
    return {
      status:
        provider.inventoryObservedAt &&
        !fresh &&
        ['ready', 'unresolved'].includes(provider.inventoryStatus)
          ? 'stale'
          : provider.inventoryStatus,
      asOf: provider.inventoryObservedAt,
      ageMs: provider.inventoryObservedAt
        ? Math.max(0, Date.now() - provider.inventoryObservedAt.getTime())
        : null,
      revision: provider.inventoryRevision,
      occupancyRevision: provider.occupancyRevision,
      fresh,
    };
  }

  private publicUrl(value: string) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/$/, '');
    } catch {
      return '';
    }
  }

  private async occupancyView(
    tx: Prisma.TransactionClient,
    provider: VpsProvider,
  ) {
    const used = await readEvolutionOccupancy(tx, provider.id);
    const inventory = this.inventoryView(provider);
    const known =
      inventory.fresh && inventory.status === 'ready' && !used.ambiguous;
    return {
      vpsProviderId: provider.id,
      instances: used.instances.length,
      reservations: used.reservations.length,
      effective: used.effective,
      byProduct: used.byProduct,
      maxInstances: provider.maxInstances,
      limitConfigured: provider.maxInstances !== null,
      available:
        provider.maxInstances === null || !known
          ? null
          : Math.max(0, provider.maxInstances - used.effective),
      overLimit:
        provider.maxInstances === null
          ? false
          : known
            ? used.effective > provider.maxInstances
            : null,
      asOf: inventory.asOf,
      inventory: { ...inventory, ambiguous: used.ambiguous },
    };
  }

  private async view(tx: Prisma.TransactionClient, provider: VpsProvider) {
    const links = await tx.productEvolution.findMany({
      where: { vpsProviderId: provider.id },
      select: {
        productId: true,
        vpsProviderId: true,
        allocationPriority: true,
        acceptingNewInstances: true,
        configurationRevision: true,
        product: { select: { id: true, name: true, allocationMode: true } },
      },
      orderBy: { productId: 'asc' },
    });
    return {
      id: provider.id,
      vpsId: provider.vpsId,
      label: provider.label,
      providerUrl: this.publicUrl(provider.providerUrl),
      adapterType: provider.adapterType,
      isActive: provider.isActive,
      maxInstances: provider.maxInstances,
      acceptingNewInstances: provider.acceptingNewInstances,
      configurationRevision: provider.configurationRevision,
      hasProviderCredential: !!provider.providerApiKey,
      identityStatus: provider.identityStatus,
      callbackReadiness: provider.callbackReadiness,
      health: {
        isHealthy: provider.isHealthy,
        asOf: provider.lastHealthAt,
        fresh:
          provider.lastHealthAt !== null &&
          Date.now() - provider.lastHealthAt.getTime() <=
            this.config.get<number>('EVOLUTION_HEALTH_MAX_AGE_MS', 180000),
      },
      inventory: this.inventoryView(provider),
      occupancy: await this.occupancyView(tx, provider),
      links,
    };
  }

  list(query: {
    search?: string;
    vpsId?: string;
    productId?: string;
    isActive?: boolean;
  }) {
    return this.read(async (tx) => {
      const providers = await tx.vpsProvider.findMany({
        where: {
          isActive: query.isActive ?? true,
          vpsId: query.vpsId,
          ...(query.productId
            ? { productEvolutions: { some: { productId: query.productId } } }
            : {}),
          ...(query.search
            ? {
                OR: [
                  {
                    label: {
                      contains: query.search,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    providerUrl: {
                      contains: query.search,
                      mode: 'insensitive' as const,
                    },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ label: 'asc' }, { id: 'asc' }],
      });
      return Promise.all(providers.map((provider) => this.view(tx, provider)));
    });
  }

  get(id: string) {
    return this.read(async (tx) => this.view(tx, await this.provider(tx, id)));
  }

  async create(dto: CreateEvolutionDto) {
    const created = await this.providers.createRecord(dto.vpsId, dto, true);
    return this.get(created.id);
  }

  async update(id: string, dto: UpdateEvolutionDto) {
    const provider = await this.read((tx) => this.provider(tx, id));
    await this.providers.updateRecord(provider.vpsId, id, dto, dto);
    return this.get(id);
  }

  async deactivate(id: string, expectedRevision: number) {
    const provider = await this.read((tx) => this.provider(tx, id));
    await this.providers.updateRecord(
      provider.vpsId,
      id,
      { isActive: false },
      { expectedRevision },
    );
    return this.get(id);
  }

  getOccupancy(id: string) {
    return this.read(async (tx) =>
      this.occupancyView(tx, await this.provider(tx, id)),
    );
  }

  private reconciliationView(operation: EvolutionReconciliation) {
    const result = operation.result as {
      inventoryRevision?: unknown;
      unknownCount?: unknown;
      conflictCount?: unknown;
    } | null;
    const numeric = (value: unknown) =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : null;
    return {
      operationId: operation.id,
      vpsProviderId: operation.vpsProviderId,
      status: operation.status,
      errorCode:
        operation.status === 'failed' ? 'inventory_not_confirmed' : null,
      createdAt: operation.createdAt,
      startedAt: operation.collectionStartedAt,
      finishedAt: operation.collectionFinishedAt,
      result: result
        ? {
            inventoryRevision: numeric(result.inventoryRevision),
            unknownCount: numeric(result.unknownCount),
            conflictCount: numeric(result.conflictCount),
          }
        : null,
    };
  }

  async reconcile(id: string, expectedRevision: number) {
    return this.reconciliationView(
      await this.inventory.request(id, expectedRevision),
    );
  }

  reconciliation(id: string, operationId: string) {
    return this.read(async (tx) => {
      await this.provider(tx, id);
      const operation = await tx.evolutionReconciliation.findFirst({
        where: { id: operationId, vpsProviderId: id },
      });
      if (!operation)
        throw new NotFoundException('Reconciliação não encontrada');
      return this.reconciliationView(operation);
    });
  }

  links(productId: string) {
    return this.read(async (tx) => {
      await this.product(tx, productId);
      const links = await tx.productEvolution.findMany({
        where: { productId },
        orderBy: [{ allocationPriority: 'asc' }, { vpsProviderId: 'asc' }],
      });
      return Promise.all(
        links.map(async (link) => ({
          link,
          evolution: await this.view(
            tx,
            await this.provider(tx, link.vpsProviderId),
          ),
        })),
      );
    });
  }

  async attach(productId: string, dto: AttachEvolutionDto) {
    const product = await this.prisma.$transaction(async (tx) => {
      const product = await lockProduct(tx, productId);
      assertRevision(product.allocationRevision, dto.expectedRevision);
      const provider = await lockProvider(tx, dto.vpsProviderId);
      if (!provider.isActive || provider.adapterType !== product.adapterType)
        throw new ConflictException('Provider inativo ou adapter incompatível');
      const where = {
        productId_vpsProviderId: { productId, vpsProviderId: provider.id },
      };
      if (!(await tx.productEvolution.findUnique({ where }))) {
        await tx.productEvolution.create({
          data: {
            productId,
            vpsProviderId: provider.id,
            acceptingNewInstances: false,
          },
        });
        return tx.product.update({
          where: { id: productId },
          data: { allocationRevision: { increment: 1 } },
        });
      }
      return product;
    });
    await this.cache.del(`auth:${product.apiKeyHash}`);
    return this.linkResponse(productId, dto.vpsProviderId);
  }

  private linkResponse(productId: string, providerId: string) {
    return this.read(async (tx) => ({
      link: await this.link(tx, productId, providerId),
      evolution: await this.view(tx, await this.provider(tx, providerId)),
      allocationRevision: (await this.product(tx, productId))
        .allocationRevision,
    }));
  }

  async updateLink(
    productId: string,
    providerId: string,
    dto: UpdateEvolutionLinkDto,
  ) {
    const product = await this.prisma.$transaction(async (tx) => {
      const product = await lockProduct(tx, productId);
      await lockProvider(tx, providerId);
      const link = await this.link(tx, productId, providerId);
      assertRevision(link.configurationRevision, dto.expectedRevision);
      await tx.productEvolution.update({
        where: {
          productId_vpsProviderId: { productId, vpsProviderId: providerId },
        },
        data: {
          allocationPriority: dto.allocationPriority,
          acceptingNewInstances: dto.acceptingNewInstances,
          configurationRevision: { increment: 1 },
        },
      });
      await tx.product.update({
        where: { id: productId },
        data: { allocationRevision: { increment: 1 } },
      });
      return product;
    });
    await this.cache.del(`auth:${product.apiKeyHash}`);
    return this.linkResponse(productId, providerId);
  }

  async detach(
    productId: string,
    providerId: string,
    expectedRevision: number,
  ) {
    const product = await this.prisma.$transaction(async (tx) => {
      const product = await lockProduct(tx, productId);
      await lockProvider(tx, providerId);
      const link = await this.link(tx, productId, providerId);
      assertRevision(link.configurationRevision, expectedRevision);
      await detachEmptyLink(tx, product, providerId);
      await tx.product.update({
        where: { id: productId },
        data: { allocationRevision: { increment: 1 } },
      });
      return product;
    });
    await this.cache.del(`auth:${product.apiKeyHash}`);
  }

  placements(productId: string) {
    return this.read(async (tx) => {
      await this.product(tx, productId);
      const instances = await tx.instance.findMany({
        where: { productId },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          vpsProviderId: true,
          vpsProvider: {
            select: { label: true, providerUrl: true, vpsId: true },
          },
        },
      });
      return instances.map((item) => ({
        instanceId: item.id,
        vpsProviderId: item.vpsProviderId,
        ...item.vpsProvider,
        providerUrl: this.publicUrl(item.vpsProvider.providerUrl),
      }));
    });
  }

  candidates(productId: string, providerId: string) {
    return this.read(async (tx) => {
      await this.product(tx, productId);
      await this.link(tx, productId, providerId);
      const provider = await this.provider(tx, providerId);
      const inventory = this.inventoryView(provider);
      if (
        !inventory.asOf ||
        !['ready', 'unresolved', 'stale'].includes(inventory.status)
      )
        return {
          items: [],
          asOf: inventory.asOf,
          inventoryStatus: inventory.status,
          conflictCount: 0,
        };
      const [entries, instances, pending] = await Promise.all([
        tx.evolutionInventoryEntry.findMany({
          where: {
            vpsProviderId: providerId,
            inventoryRevision: provider.inventoryRevision,
          },
          orderBy: { instanceName: 'asc' },
        }),
        tx.instance.findMany({
          where: { OR: [{ productId }, { vpsProviderId: providerId }] },
        }),
        tx.instanceProvisioning.findMany({
          where: {
            OR: [{ productId }, { vpsProviderId: providerId }],
            state: { in: OPEN_PROVISIONING_STATES },
          },
        }),
      ]);
      const items: Array<{
        providerInstanceId: string;
        instanceName: string;
        status: string | null;
        ownership: 'own' | 'unassigned';
        hubInstanceId?: string;
      }> = [];
      let conflictCount = 0;
      for (const entry of entries) {
        const matches = instances.filter(
          (item) =>
            (item.vpsProviderId === providerId &&
              (item.instanceName === entry.instanceName ||
                (!!entry.providerInstanceId &&
                  item.providerInstanceId === entry.providerInstanceId))) ||
            (item.productId === productId &&
              item.instanceName === entry.instanceName),
        );
        const reserved = pending.some(
          (item) =>
            (item.vpsProviderId === providerId &&
              (item.instanceName === entry.instanceName ||
                (!!entry.providerInstanceId &&
                  item.providerInstanceId === entry.providerInstanceId))) ||
            (item.productId === productId &&
              item.instanceName === entry.instanceName),
        );
        const own =
          matches.length === 1 &&
          matches[0].productId === productId &&
          matches[0].vpsProviderId === providerId &&
          sameSession(matches[0], entry);
        if (
          !entry.providerInstanceId ||
          reserved ||
          (matches.length > 0 && !own)
        ) {
          conflictCount++;
          continue;
        }
        items.push({
          providerInstanceId: entry.providerInstanceId,
          instanceName: entry.instanceName,
          status: entry.status,
          ownership: own ? 'own' : 'unassigned',
          ...(own ? { hubInstanceId: matches[0].id } : {}),
        });
      }
      return {
        items,
        asOf: inventory.asOf,
        inventoryStatus: inventory.status,
        conflictCount,
      };
    });
  }

  private async allocationView(tx: Prisma.TransactionClient, product: Product) {
    const databaseConsolidated = await isEvolutionBaseConsolidated(tx);
    const distributionEnabled = this.config.get<boolean>(
      'EVOLUTION_ALLOCATION_ENABLED',
      false,
    );
    const links = await tx.productEvolution.findMany({
      where: { productId: product.id },
      orderBy: [{ allocationPriority: 'asc' }, { vpsProviderId: 'asc' }],
    });
    const order = [] as Array<{
      vpsProviderId: string;
      allocationPriority: number;
      acceptingNewInstances: boolean;
      configurationRevision: number;
      eligible: boolean;
      blockers: string[];
      maxInstances: number | null;
    }>;
    for (const link of links) {
      const provider = await this.provider(tx, link.vpsProviderId);
      const { blockers, used } = await evolutionReadiness(
        tx,
        provider,
        this.config,
        product.hubRelay,
      );
      if (!link.acceptingNewInstances) blockers.push('link_paused');
      if (!provider.acceptingNewInstances) blockers.push('provider_paused');
      if (provider.adapterType !== product.adapterType)
        blockers.push('adapter_mismatch');
      if (
        provider.maxInstances !== null &&
        used.effective >= provider.maxInstances
      )
        blockers.push('capacity_full');
      order.push({
        vpsProviderId: provider.id,
        allocationPriority: link.allocationPriority,
        acceptingNewInstances: link.acceptingNewInstances,
        configurationRevision: link.configurationRevision,
        eligible: blockers.length === 0,
        blockers,
        maxInstances: provider.maxInstances,
      });
    }
    const blockers: string[] = [];
    if (!distributionEnabled) blockers.push('allocation_disabled');
    if (!databaseConsolidated) blockers.push('database_not_consolidated');
    if (!product.isActive) blockers.push('product_inactive');
    if (!order.some((item) => item.eligible))
      blockers.push('no_eligible_evolution');
    return {
      mode: product.allocationMode,
      configurationRevision: product.allocationRevision,
      defaultProviderId: product.vpsProviderId,
      capacityFirstAllocationAt: product.capacityFirstAllocationAt,
      distributionEnabled,
      databaseConsolidated,
      requiresWriterConfirmation: !(await writerConfirmation(tx)),
      blockers,
      order,
      ready: blockers.length === 0,
    };
  }

  allocation(productId: string) {
    return this.read(async (tx) =>
      this.allocationView(tx, await this.product(tx, productId)),
    );
  }

  async setAllocation(productId: string, dto: AllocationDto) {
    const product = await this.prisma.$transaction(async (tx) => {
      await lockEvolutionCatalog(tx);
      const product = await lockProduct(tx, productId);
      assertRevision(product.allocationRevision, dto.expectedRevision);
      if (dto.mode === product.allocationMode) return product;
      const links = await tx.productEvolution.findMany({
        where: { productId },
        orderBy: { vpsProviderId: 'asc' },
      });
      for (const link of links) await lockProvider(tx, link.vpsProviderId);
      if (dto.mode === 'capacity') {
        await assertWritersCompatible(tx, dto.writersCompatible);
        const readiness = await this.allocationView(tx, product);
        if (!readiness.ready)
          throw new ConflictException({
            statusCode: 409,
            message: 'Produto ainda não preparado para distribuição',
            blockers: readiness.blockers,
          });
      } else {
        if (!product.vpsProviderId)
          throw new ConflictException('Escolha um destino padrão');
        assertNoBlockers(
          await legacyBlockers(tx, product, product.vpsProviderId),
        );
      }
      return tx.product.update({
        where: { id: productId },
        data: {
          allocationMode: dto.mode,
          allocationRevision: { increment: 1 },
        },
      });
    });
    await this.cache.del(`auth:${product.apiKeyHash}`);
    return this.allocation(productId);
  }
}
