import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VpsProvider } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import {
  decryptAES256GCM,
  encryptAES256GCM,
} from '../../../common/crypto.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { canonicalEvolutionEndpoint } from '../../../prisma/evolution-identity';
import { LegacyProvider, legacyProvider } from '../../../prisma/legacy-selects';
import { CacheService } from '../../../cache/cache.service';
import { invalidateInstanceCache } from '../../../cache/instance-cache';
import { CreateVpsProviderDto } from './dto/create-vps-provider.dto';
import { UpdateVpsProviderDto } from './dto/update-vps-provider.dto';
import {
  lockProvider,
  OPEN_PROVISIONING_STATES,
} from '../../provisioning/evolution-locks';
import {
  assertEndpointAvailable,
  assertEvolutionUnused,
  assertRevision,
  assertWritersCompatible,
  evolutionReadiness,
  isControlledEvolution,
  lockEvolutionCatalog,
} from '../../provisioning/evolution-controls';

export interface EvolutionProviderUpdate extends UpdateVpsProviderDto {
  expectedRevision: number;
  vpsId?: string;
  maxInstances?: number | null;
  acceptingNewInstances?: boolean;
  confirmIdentity?: boolean;
  writersCompatible?: boolean;
}

type DecryptedProvider = LegacyProvider;

@Injectable()
export class VpsProviderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  async create(
    vpsId: string,
    dto: CreateVpsProviderDto,
  ): Promise<DecryptedProvider> {
    return this.decrypt(await this.createRecord(vpsId, dto));
  }

  async createRecord(
    vpsId: string,
    dto: CreateVpsProviderDto,
    strict = false,
  ): Promise<VpsProvider> {
    return this.prisma.$transaction(async (tx) => {
      await lockEvolutionCatalog(tx);
      if (!(await tx.vpsServer.findUnique({ where: { id: vpsId } })))
        throw new NotFoundException('VPS não encontrada');
      await assertEndpointAvailable(tx, dto.providerUrl, undefined, strict);
      return tx.vpsProvider.create({
        data: {
          vpsId,
          label: dto.label,
          providerUrl: dto.providerUrl,
          canonicalEndpoint: canonicalEvolutionEndpoint(dto.providerUrl),
          providerApiKey: encryptAES256GCM(
            dto.providerApiKey,
            this.encryptionKey,
          ),
          adapterType: dto.adapterType ?? 'evolution',
        },
      });
    });
  }

  async findAll(vpsId: string): Promise<DecryptedProvider[]> {
    await this.assertVpsExists(vpsId);

    const providers = await this.prisma.vpsProvider.findMany({
      where: { vpsId, isActive: true },
    });

    return providers.map((p) => this.decrypt(p));
  }

  async update(
    vpsId: string,
    id: string,
    dto: UpdateVpsProviderDto,
  ): Promise<DecryptedProvider> {
    return this.decrypt(await this.updateRecord(vpsId, id, dto));
  }

  async updateRecord(
    vpsId: string,
    id: string,
    dto: UpdateVpsProviderDto,
    policy?: EvolutionProviderUpdate,
  ): Promise<VpsProvider> {
    const data: Prisma.VpsProviderUpdateInput = {};

    if (dto.label !== undefined) data.label = dto.label;
    if (dto.providerUrl !== undefined) {
      data.providerUrl = dto.providerUrl;
      data.canonicalEndpoint = canonicalEvolutionEndpoint(dto.providerUrl);
    }
    if (dto.adapterType !== undefined) data.adapterType = dto.adapterType;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.providerApiKey) {
      data.providerApiKey = encryptAES256GCM(
        dto.providerApiKey,
        this.encryptionKey,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await lockEvolutionCatalog(tx);
      const current = await lockProvider(tx, id);
      if (current.vpsId !== vpsId)
        throw new NotFoundException('Provider não encontrado na VPS');
      if (policy)
        assertRevision(current.configurationRevision, policy.expectedRevision);
      const changesDestination =
        (dto.providerUrl !== undefined &&
          dto.providerUrl !== current.providerUrl) ||
        (dto.adapterType !== undefined &&
          dto.adapterType !== current.adapterType) ||
        (policy?.vpsId !== undefined && policy.vpsId !== current.vpsId);
      const controlled = await isControlledEvolution(tx, current);
      if (
        (changesDestination || dto.isActive === false) &&
        (await tx.instanceMaintenanceAction.findFirst({
          where: {
            providerId: id,
            state: {
              in: [
                'dispatching',
                'confirming',
                'uncertain',
                'local_cleanup_pending',
              ],
            },
          },
        }))
      )
        throw new ConflictException(
          'Provider possui manutenção aguardando confirmação; destino preservado',
        );
      if (changesDestination && (policy || controlled))
        await assertEvolutionUnused(tx, id, true);
      if (dto.isActive === false && (policy || controlled))
        await assertEvolutionUnused(tx, id);
      if (
        changesDestination &&
        (await tx.instanceProvisioning.findFirst({
          where: {
            vpsProviderId: id,
            state: { in: OPEN_PROVISIONING_STATES },
          },
        }))
      )
        throw new ConflictException(
          'Provider possui provisionamentos pendentes; destino preservado',
        );
      if (changesDestination) {
        data.identityStatus = 'pending';
        data.callbackReadiness = 'pending';
      }
      if (dto.providerUrl !== undefined)
        await assertEndpointAvailable(
          tx,
          dto.providerUrl,
          id,
          !!policy || controlled,
        );
      if (policy?.vpsId !== undefined) {
        if (!(await tx.vpsServer.findUnique({ where: { id: policy.vpsId } })))
          throw new NotFoundException('VPS não encontrada');
        data.vps = { connect: { id: policy.vpsId } };
      }
      if (policy?.confirmIdentity) {
        const url = dto.providerUrl ?? current.providerUrl;
        const endpoint = canonicalEvolutionEndpoint(url);
        if (!endpoint)
          throw new BadRequestException('URL de Evolution inválida');
        await assertEndpointAvailable(tx, url, id, true);
        data.canonicalEndpoint = endpoint;
        data.identityStatus = 'verified';
      }
      if (policy?.maxInstances !== undefined)
        data.maxInstances = policy.maxInstances;
      if (policy?.acceptingNewInstances !== undefined)
        data.acceptingNewInstances = policy.acceptingNewInstances;
      if (policy?.acceptingNewInstances === false)
        await assertEndpointAvailable(
          tx,
          dto.providerUrl ?? current.providerUrl,
          id,
          true,
        );
      if (policy?.maxInstances !== undefined && policy.maxInstances !== null) {
        await assertWritersCompatible(tx, policy.writersCompatible);
        const prospective = {
          ...current,
          identityStatus: policy.confirmIdentity
            ? 'verified'
            : current.identityStatus,
          canonicalEndpoint: policy.confirmIdentity
            ? canonicalEvolutionEndpoint(dto.providerUrl ?? current.providerUrl)
            : current.canonicalEndpoint,
        };
        const { blockers } = await evolutionReadiness(
          tx,
          prospective,
          this.config,
        );
        if (changesDestination || dto.providerApiKey)
          blockers.push('configuration_changed');
        if (blockers.length)
          throw new ConflictException({
            statusCode: 409,
            message: 'Evolution ainda não preparada para limite',
            blockers,
          });
      }
      return tx.vpsProvider.update({
        where: { id },
        data: {
          ...data,
          configurationRevision: { increment: 1 },
          ...(changesDestination || dto.providerApiKey
            ? {
                inventoryStatus: 'unknown',
                inventoryObservedAt: null,
              }
            : {}),
        },
      });
    });

    if (
      dto.providerApiKey ||
      dto.providerUrl ||
      dto.adapterType ||
      dto.isActive !== undefined ||
      policy?.vpsId
    ) {
      await this.invalidateInstanceCachesForProvider(id);
    }

    return updated;
  }

  async deactivate(vpsId: string, id: string): Promise<DecryptedProvider> {
    return this.decrypt(
      await this.updateRecord(vpsId, id, { isActive: false }),
    );
  }

  private decrypt(provider: VpsProvider): DecryptedProvider {
    const key = this.encryptionKey;
    return {
      ...legacyProvider(provider),
      providerApiKey: decryptAES256GCM(provider.providerApiKey, key),
    };
  }

  private get encryptionKey(): string {
    return this.config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  private async assertVpsExists(vpsId: string): Promise<void> {
    const exists = await this.prisma.vpsServer.findUnique({
      where: { id: vpsId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`VPS ${vpsId} não encontrada`);
  }

  private async invalidateInstanceCachesForProvider(
    providerId: string,
  ): Promise<void> {
    const instances = await this.prisma.instance.findMany({
      where: { vpsProviderId: providerId },
      select: {
        id: true,
        productId: true,
        instanceName: true,
        providerInstanceId: true,
      },
    });
    await Promise.all(
      instances.map((i) => invalidateInstanceCache(this.cache, i)),
    );
  }
}
