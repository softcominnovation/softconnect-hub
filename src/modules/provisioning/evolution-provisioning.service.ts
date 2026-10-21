import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InstanceProvisioning, Prisma, VpsProvider } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { CacheService } from '../../cache/cache.service';
import { invalidateInstanceCache } from '../../cache/instance-cache';
import { relayWebhook } from '../webhook/relay-configuration';
import { decryptAES256GCM, hashSHA256 } from '../../common/crypto.util';
import { QrRequestContext } from '../../common/qr-request-context';
import { canonicalEvolutionEndpoint } from '../../prisma/evolution-identity';
import { ensureEvolutionLink } from '../../prisma/evolution-links';
import { PrismaService } from '../../prisma/prisma.service';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import type {
  CreateInstanceDto,
  InstanceCreatedDto,
} from '../../providers/whatsapp-provider.interface';
import { EvolutionInventoryService } from './evolution-inventory.service';
import {
  advanceOccupancy,
  lockProduct,
  lockProvider,
  OPEN_PROVISIONING_STATES,
} from './evolution-locks';
import { normalizeInventory } from './evolution-occupancy';
import {
  decodePayload,
  encodePayload,
  ProvisioningPayload,
} from './provisioning-payload';

export type ProvisioningTicket = Pick<
  InstanceProvisioning,
  'id' | 'productId' | 'vpsProviderId' | 'leaseOwner'
>;
export type PreparedProvisioning = {
  ticket: ProvisioningTicket;
  provider: VpsProvider;
  payload: ProvisioningPayload;
};

@Injectable()
export class EvolutionProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: EvolutionInventoryService,
    private readonly adapters: AdapterResolverService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  private get key() {
    return this.config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  context(provider: VpsProvider, execution: QrRequestContext) {
    return {
      providerUrl: provider.providerUrl,
      providerApiKey: decryptAES256GCM(provider.providerApiKey, this.key),
      execution,
      strictInventory: true,
    };
  }

  private unavailable() {
    return new ServiceUnavailableException(
      'Nenhuma Evolution disponível para nova instância',
    );
  }

  private async assertControlledIdentity(
    tx: Prisma.TransactionClient,
    provider: VpsProvider,
  ) {
    const canonical = canonicalEvolutionEndpoint(provider.providerUrl);
    if (
      !canonical ||
      provider.canonicalEndpoint !== canonical ||
      provider.identityStatus !== 'verified'
    )
      throw this.unavailable();
    const others = await tx.vpsProvider.findMany({
      where: { id: { not: provider.id } },
      select: { providerUrl: true },
    });
    if (
      others.some(
        (item) => canonicalEvolutionEndpoint(item.providerUrl) === canonical,
      )
    )
      throw this.unavailable();
  }

  private async admission(
    tx: Prisma.TransactionClient,
    productId: string,
    providerId: string,
    ownReservation = false,
  ) {
    const product = await lockProduct(tx, productId);
    const provider = await lockProvider(tx, providerId);
    const capacity = product.allocationMode === 'capacity';
    if (!product.isActive) throw new BadRequestException('Produto inativo');
    if (!capacity && !product.vpsProviderId)
      throw new BadRequestException('Produto sem VpsProvider associado');
    if (!capacity && product.vpsProviderId !== provider.id)
      throw this.unavailable();
    if (
      capacity &&
      !this.config.get<boolean>('EVOLUTION_ALLOCATION_ENABLED', false)
    )
      throw this.unavailable();
    if (!provider.isActive) {
      if (!capacity)
        throw new NotFoundException('VpsProvider nao encontrado ou inativo');
      throw this.unavailable();
    }
    if (provider.adapterType !== product.adapterType)
      throw new BadRequestException(
        'Incompatibilidade de adapter entre produto e provider',
      );
    if (!capacity) await ensureEvolutionLink(tx, productId, providerId, true);
    const link = await tx.productEvolution.findUnique({
      where: {
        productId_vpsProviderId: { productId, vpsProviderId: providerId },
      },
    });
    if (!provider.acceptingNewInstances || !link?.acceptingNewInstances)
      throw this.unavailable();
    if (capacity || provider.maxInstances !== null) {
      await this.assertControlledIdentity(tx, provider);
      if (!provider.vps.isActive || !this.inventory.isFresh(provider))
        throw this.unavailable();
      if (
        capacity &&
        product.hubRelay &&
        provider.callbackReadiness !== 'ready'
      )
        throw this.unavailable();
      const used = await this.inventory.readOccupancy(tx, providerId);
      if (
        used.ambiguous ||
        (provider.maxInstances !== null &&
          used.effective + (ownReservation ? 0 : 1) > provider.maxInstances)
      )
        throw this.unavailable();
    }
    return { product, provider };
  }

  async prepare(
    productId: string,
    dto: CreateInstanceDto,
    execution: QrRequestContext,
  ): Promise<PreparedProvisioning> {
    execution.assertActive();
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Produto não encontrado');
    if (!product.isActive) throw new BadRequestException('Produto inativo');
    const pending = await this.prisma.instanceProvisioning.findFirst({
      where: {
        productId,
        instanceName: dto.instanceName,
        state: { in: OPEN_PROVISIONING_STATES },
      },
    });
    if (pending)
      throw new ConflictException(
        'Criação ainda em resolução para esta instância',
      );
    const existing = await this.prisma.instance.findFirst({
      where: { productId, instanceName: dto.instanceName },
    });
    const checked = new Set<string>();
    if (existing) {
      const host = await this.prisma.vpsProvider.findUniqueOrThrow({
        where: { id: existing.vpsProviderId },
      });
      execution.assertActive();
      const remote = normalizeInventory(
        await this.adapters
          .resolve(host.adapterType)
          .fetchInstances(this.context(host, execution)),
      );
      if (remote.some((item) => item.instanceName === existing.instanceName))
        throw new ConflictException(
          `Instância "${dto.instanceName}" já existe neste produto e no provider (id: ${existing.id})`,
        );
      execution.assertActive();
      await this.removeConfirmed(existing.id, productId, host.id);
      checked.add(host.id);
    }
    const capacity = product.allocationMode === 'capacity';
    if (!capacity && !product.vpsProviderId)
      throw new BadRequestException('Produto sem VpsProvider associado');
    if (
      capacity &&
      !this.config.get<boolean>('EVOLUTION_ALLOCATION_ENABLED', false)
    )
      throw this.unavailable();
    const candidates = capacity
      ? (
          await this.prisma.productEvolution.findMany({
            where: { productId, acceptingNewInstances: true },
            orderBy: [{ allocationPriority: 'asc' }, { vpsProviderId: 'asc' }],
          })
        ).map((item) => item.vpsProviderId)
      : [product.vpsProviderId!];
    const webhook = await this.prisma.productDefaultWebhook.findUnique({
      where: { productId },
    });
    const token = dto.token || randomBytes(32).toString('hex');
    const payload: ProvisioningPayload = {
      token,
      clientToken: dto.token,
      request: { ...dto, token },
      webhookApplied: !webhook,
      webhook: webhook
        ? {
            enabled: webhook.enabled,
            url: webhook.url,
            headers: (webhook.headers ?? undefined) as
              | Record<string, string>
              | undefined,
            byEvents: webhook.byEvents,
            base64: webhook.base64,
            events: webhook.events,
          }
        : undefined,
    };
    for (const providerId of candidates) {
      execution.assertActive();
      let provider = await this.prisma.vpsProvider.findUnique({
        where: { id: providerId },
      });
      if (!provider?.isActive) {
        if (capacity) continue;
        throw new NotFoundException('VpsProvider nao encontrado ou inativo');
      }
      try {
        if (capacity || provider.maxInstances !== null) {
          if (!this.inventory.isFresh(provider))
            provider = await this.inventory.refresh(providerId, execution);
        } else if (!checked.has(providerId)) {
          const remote = normalizeInventory(
            await this.adapters
              .resolve(provider.adapterType)
              .fetchInstances(this.context(provider, execution)),
          );
          if (remote.some((item) => item.instanceName === dto.instanceName))
            throw new ConflictException(
              'Instância já existe no provider; remova-a ou importe-a antes de criar',
            );
        }
        execution.assertActive();
        const observedProvider = provider;
        if (product.hubRelay) {
          const supplied = (
            dto as CreateInstanceDto & {
              webhook?: ProvisioningPayload['webhook'];
            }
          ).webhook;
          const output = await this.prisma.webhookConfig.findFirst({
            where: { productId, isActive: true },
          });
          payload.webhook = await relayWebhook(
            this.prisma,
            this.config,
            providerId,
            payload.webhook ??
              supplied ?? {
                enabled: true,
                url: '',
                events: output?.events ?? [],
              },
          );
          payload.webhookApplied = false;
          if (supplied)
            payload.request = {
              ...payload.request,
              webhook: payload.webhook,
            } as CreateInstanceDto;
        }
        const result = await this.prisma.$transaction(async (tx) => {
          const current = await this.admission(tx, productId, providerId);
          // A preflight against an old destination/policy cannot authorize a POST
          // against a newly edited one. The caller can retry a bounded request.
          if (
            current.product.allocationRevision !== product.allocationRevision ||
            current.product.allocationMode !== product.allocationMode ||
            current.product.vpsProviderId !== product.vpsProviderId ||
            current.provider.configurationRevision !==
              observedProvider.configurationRevision ||
            current.provider.providerUrl !== observedProvider.providerUrl ||
            current.provider.adapterType !== observedProvider.adapterType
          )
            throw this.unavailable();
          if (capacity) {
            const currentCandidates = await tx.productEvolution.findMany({
              where: { productId, acceptingNewInstances: true },
              orderBy: [
                { allocationPriority: 'asc' },
                { vpsProviderId: 'asc' },
              ],
            });
            if (
              JSON.stringify(
                currentCandidates.map((item) => item.vpsProviderId),
              ) !== JSON.stringify(candidates)
            )
              throw this.unavailable();
          }
          execution.assertActive();
          const conflict = await tx.instance.findFirst({
            where: {
              instanceName: dto.instanceName,
              OR: [{ productId }, { vpsProviderId: providerId }],
            },
          });
          const unresolved = await tx.instanceProvisioning.findFirst({
            where: {
              instanceName: dto.instanceName,
              state: { in: OPEN_PROVISIONING_STATES },
              OR: [{ productId }, { vpsProviderId: providerId }],
            },
          });
          const external = await tx.evolutionInventoryEntry.findFirst({
            where: {
              vpsProviderId: providerId,
              instanceName: dto.instanceName,
            },
          });
          if (conflict || unresolved || external)
            throw new ConflictException(
              'Nome de instância já utilizado ou em resolução',
            );
          const ticket = await tx.instanceProvisioning.create({
            data: {
              productId,
              vpsProviderId: providerId,
              linkProductId: productId,
              linkVpsProviderId: providerId,
              instanceName: dto.instanceName,
              requestHash: hashSHA256(JSON.stringify(dto)),
              encryptedRequest: encodePayload(payload, this.key),
              leaseOwner: randomUUID(),
              leaseExpiresAt: new Date(
                Date.now() + execution.remainingMs + 5000,
              ),
            },
          });
          await advanceOccupancy(tx, providerId);
          return { ticket, provider: current.provider, payload };
        });
        return result;
      } catch (error) {
        execution.assertActive();
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException(
            'Nome de instância já utilizado ou em resolução',
          );
        if (capacity && error instanceof ServiceUnavailableException) continue;
        throw error;
      }
    }
    throw this.unavailable();
  }

  private async owned(
    tx: Prisma.TransactionClient,
    ticket: ProvisioningTicket,
  ) {
    const row = await tx.instanceProvisioning.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    if (
      row.leaseOwner !== ticket.leaseOwner ||
      !OPEN_PROVISIONING_STATES.includes(row.state)
    )
      throw new ConflictException(
        'Provisionamento já assumido por outro executor',
      );
    return row;
  }

  async assertOwned(ticket: ProvisioningTicket) {
    return this.prisma.$transaction(async (tx) => {
      await lockProvider(tx, ticket.vpsProviderId);
      const row = await this.owned(tx, ticket);
      if (!row.leaseExpiresAt || row.leaseExpiresAt.getTime() <= Date.now())
        throw new ConflictException('Lease de provisionamento vencida');
      return row;
    });
  }

  async markCreating(ticket: ProvisioningTicket, execution: QrRequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const { provider } = await this.admission(
        tx,
        ticket.productId,
        ticket.vpsProviderId,
        true,
      );
      const row = await this.owned(tx, ticket);
      execution.assertActive();
      if (
        row.state !== 'reserved' ||
        !row.leaseExpiresAt ||
        row.leaseExpiresAt.getTime() <= Date.now()
      )
        throw new ConflictException('Reserva não está disponível para envio');
      await tx.instanceProvisioning.update({
        where: { id: row.id },
        data: { state: 'creating', revision: { increment: 1 } },
      });
      return provider;
    });
  }

  async recordCreated(ticket: ProvisioningTicket, result: InstanceCreatedDto) {
    const recorded = await this.prisma.$transaction(async (tx) => {
      await lockProduct(tx, ticket.productId);
      await lockProvider(tx, ticket.vpsProviderId);
      const row = await this.owned(tx, ticket);
      const payload = decodePayload(row.encryptedRequest, this.key);
      if (!['creating', 'uncertain'].includes(row.state))
        throw new ConflictException(
          'Estado incompatível com criação confirmada',
        );
      if (row.instanceId)
        return tx.instance.findUniqueOrThrow({ where: { id: row.instanceId } });
      const instance = await tx.instance.create({
        data: {
          productId: row.productId,
          vpsProviderId: row.vpsProviderId,
          instanceName: row.instanceName,
          providerInstanceId: result.instanceId ?? null,
          instanceToken: payload.clientToken,
          hubToken: `hub_${row.productId}_${row.instanceName}`,
          status: 'disconnected',
        },
      });
      await tx.instanceProvisioning.update({
        where: { id: row.id },
        data: {
          instanceId: instance.id,
          providerInstanceId: result.instanceId ?? null,
          revision: { increment: 1 },
        },
      });
      await advanceOccupancy(tx, row.vpsProviderId);
      return instance;
    });
    await invalidateInstanceCache(this.cache, recorded);
    return recorded;
  }

  async markWebhookApplied(ticket: ProvisioningTicket) {
    await this.prisma.$transaction(async (tx) => {
      await lockProvider(tx, ticket.vpsProviderId);
      const row = await this.owned(tx, ticket);
      const payload = decodePayload(row.encryptedRequest, this.key);
      await tx.instanceProvisioning.update({
        where: { id: row.id },
        data: {
          encryptedRequest: encodePayload(
            { ...payload, webhookApplied: true },
            this.key,
          ),
          revision: { increment: 1 },
        },
      });
    });
  }

  async finish(ticket: ProvisioningTicket) {
    await this.prisma.$transaction(async (tx) => {
      await lockProduct(tx, ticket.productId);
      await lockProvider(tx, ticket.vpsProviderId);
      const row = await this.owned(tx, ticket);
      if (
        !['creating', 'uncertain'].includes(row.state) ||
        !row.instanceId ||
        !decodePayload(row.encryptedRequest, this.key).webhookApplied
      )
        throw new ConflictException('Criação ainda não confirmada');
      await tx.instanceProvisioning.update({
        where: { id: row.id },
        data: {
          state: 'committed',
          linkProductId: null,
          linkVpsProviderId: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          encryptedRequest: null,
          errorCode: null,
          revision: { increment: 1 },
        },
      });
      await tx.product.updateMany({
        where: {
          id: row.productId,
          allocationMode: 'capacity',
          capacityFirstAllocationAt: null,
        },
        data: { capacityFirstAllocationAt: new Date() },
      });
      await advanceOccupancy(tx, row.vpsProviderId);
    });
  }

  async markCleanup(ticket: ProvisioningTicket) {
    await this.prisma.$transaction(async (tx) => {
      await lockProvider(tx, ticket.vpsProviderId);
      const row = await this.owned(tx, ticket);
      if (!['creating', 'uncertain', 'cleanup_pending'].includes(row.state))
        throw new ConflictException('Estado incompatível com compensação');
      await tx.instanceProvisioning.update({
        where: { id: row.id },
        data: {
          state: 'cleanup_pending',
          errorCode: 'required_defaults_failed',
          revision: { increment: 1 },
        },
      });
    });
  }

  async assertDeletable(instanceId: string) {
    if (
      await this.prisma.instanceProvisioning.findFirst({
        where: {
          instanceId,
          state: { in: OPEN_PROVISIONING_STATES },
        },
      })
    )
      throw new ConflictException('Instância ainda em provisionamento');
  }

  async abandon(ticket: ProvisioningTicket) {
    await this.prisma.$transaction(async (tx) => {
      await lockProvider(tx, ticket.vpsProviderId);
      const row = await tx.instanceProvisioning.findUnique({
        where: { id: ticket.id },
      });
      if (
        !row ||
        row.leaseOwner !== ticket.leaseOwner ||
        !OPEN_PROVISIONING_STATES.includes(row.state)
      )
        return;
      const unsent = row.state === 'reserved';
      await tx.instanceProvisioning.update({
        where: { id: row.id },
        data: {
          state: unsent
            ? 'released'
            : row.state === 'cleanup_pending'
              ? 'cleanup_pending'
              : 'uncertain',
          ...(unsent
            ? {
                linkProductId: null,
                linkVpsProviderId: null,
                encryptedRequest: null,
              }
            : {}),
          errorCode: unsent ? 'not_sent' : 'result_not_confirmed',
          leaseOwner: null,
          leaseExpiresAt: new Date(
            Date.now() +
              this.config.get<number>('EVOLUTION_RECOVERY_INTERVAL_MS', 15000),
          ),
          revision: { increment: 1 },
        },
      });
      await advanceOccupancy(tx, row.vpsProviderId);
    });
  }

  async removeConfirmed(
    instanceId: string,
    productId: string,
    providerId: string,
    ticket?: ProvisioningTicket,
    expectedIdentity?: { remoteId: string; name: string },
    maintenanceCheck?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    const removed = await this.prisma.$transaction(async (tx) => {
      await lockProduct(tx, productId);
      await lockProvider(tx, providerId);
      if (maintenanceCheck) await maintenanceCheck(tx);
      if (ticket) await this.owned(tx, ticket);
      else if (
        await tx.instanceProvisioning.findFirst({
          where: { instanceId, state: { in: OPEN_PROVISIONING_STATES } },
        })
      )
        throw new ConflictException('Instância ainda em provisionamento');
      const instance = await tx.instance.findUnique({
        where: { id: instanceId, productId, vpsProviderId: providerId },
      });
      if (!instance) return null;
      if (
        expectedIdentity &&
        (instance.providerInstanceId !== expectedIdentity.remoteId ||
          instance.instanceName !== expectedIdentity.name)
      )
        throw new ConflictException(
          'Identidade da instância mudou; cadastro preservado',
        );
      await tx.evolutionInventoryEntry.deleteMany({
        where: {
          vpsProviderId: providerId,
          instanceName: instance.instanceName,
        },
      });
      await tx.instance.delete({ where: { id: instanceId } });
      if (ticket)
        await tx.instanceProvisioning.update({
          where: { id: ticket.id },
          data: {
            state: 'failed',
            linkProductId: null,
            linkVpsProviderId: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            encryptedRequest: null,
            errorCode: 'cleanup_confirmed',
            revision: { increment: 1 },
          },
        });
      await advanceOccupancy(tx, providerId);
      return instance;
    });
    if (removed) {
      await invalidateInstanceCache(this.cache, removed);
    }
    return removed;
  }
}
