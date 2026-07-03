import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VpsProvider } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import {
  decryptAES256GCM,
  encryptAES256GCM,
} from '../../../common/crypto.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheService } from '../../../cache/cache.service';
import { CreateVpsProviderDto } from './dto/create-vps-provider.dto';
import { UpdateVpsProviderDto } from './dto/update-vps-provider.dto';

type DecryptedProvider = Omit<VpsProvider, 'providerApiKey'> & {
  providerApiKey: string;
};

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
    await this.assertVpsExists(vpsId);

    const key = this.encryptionKey;
    const provider = await this.prisma.vpsProvider.create({
      data: {
        vpsId,
        label: dto.label,
        providerUrl: dto.providerUrl,
        providerApiKey: encryptAES256GCM(dto.providerApiKey, key),
        adapterType: dto.adapterType ?? 'evolution',
      },
    });

    return this.decrypt(provider);
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
    await this.assertProviderExists(vpsId, id);

    const key = this.encryptionKey;
    const data: Prisma.VpsProviderUpdateInput = {};

    if (dto.label !== undefined) data.label = dto.label;
    if (dto.providerUrl !== undefined) data.providerUrl = dto.providerUrl;
    if (dto.adapterType !== undefined) data.adapterType = dto.adapterType;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.providerApiKey) {
      data.providerApiKey = encryptAES256GCM(dto.providerApiKey, key);
    }

    const updated = await this.prisma.vpsProvider.update({
      where: { id },
      data,
    });

    if (dto.providerApiKey || dto.providerUrl) {
      await this.invalidateInstanceCachesForProvider(id);
    }

    return this.decrypt(updated);
  }

  async deactivate(vpsId: string, id: string): Promise<DecryptedProvider> {
    await this.assertProviderExists(vpsId, id);

    const updated = await this.prisma.vpsProvider.update({
      where: { id },
      data: { isActive: false },
    });

    await this.invalidateInstanceCachesForProvider(id);

    return this.decrypt(updated);
  }

  private decrypt(provider: VpsProvider): DecryptedProvider {
    const key = this.encryptionKey;
    return {
      ...provider,
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

  private async assertProviderExists(vpsId: string, id: string): Promise<void> {
    const exists = await this.prisma.vpsProvider.findFirst({
      where: { id, vpsId },
      select: { id: true },
    });
    if (!exists)
      throw new NotFoundException(
        `Provider ${id} não encontrado na VPS ${vpsId}`,
      );
  }

  private async invalidateInstanceCachesForProvider(
    providerId: string,
  ): Promise<void> {
    const instances = await this.prisma.instance.findMany({
      where: { vpsProviderId: providerId, isActive: true },
      select: { id: true },
    });
    await Promise.all(instances.map((i) => this.cache.del(`instance:${i.id}`)));
  }
}
