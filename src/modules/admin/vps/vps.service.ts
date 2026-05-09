import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { VpsServer } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import {
  decryptAES256GCM,
  encryptAES256GCM,
} from '../../../common/crypto.util';
import { CacheService } from '../../../cache/cache.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateVpsDto } from './dto/create-vps.dto';
import { UpdateVpsDto } from './dto/update-vps.dto';

type DecryptedVps = Omit<VpsServer, 'managerApiKey' | 'monitorApiKey'> & {
  managerApiKey: string | null;
  monitorApiKey: string | null;
};

@Injectable()
export class VpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  async create(dto: CreateVpsDto): Promise<DecryptedVps> {
    const key = this.encryptionKey;

    try {
      const vps = await this.prisma.vpsServer.create({
        data: {
          label: dto.label,
          subdomain: dto.subdomain,
          ip: dto.ip,
          managerType: dto.managerType ?? null,
          managerUrl: dto.managerUrl ?? null,
          managerApiKey: dto.managerApiKey
            ? encryptAES256GCM(dto.managerApiKey, key)
            : null,
          monitorUrl: dto.monitorUrl ?? null,
          monitorApiKey: dto.monitorApiKey
            ? encryptAES256GCM(dto.monitorApiKey, key)
            : null,
          notes: dto.notes ?? null,
        },
      });

      return this.decrypt(vps);
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('A VPS with this subdomain already exists');
      }
      throw err;
    }
  }

  async findAll(): Promise<DecryptedVps[]> {
    const list = await this.prisma.vpsServer.findMany({
      include: { providers: true },
    });
    return list.map((vps) => this.decrypt(vps));
  }

  async update(id: string, dto: UpdateVpsDto): Promise<DecryptedVps> {
    await this.assertExists(id);

    const key = this.encryptionKey;
    const data: Record<string, unknown> = { ...dto };

    if (dto.managerApiKey) {
      data.managerApiKey = encryptAES256GCM(dto.managerApiKey, key);
    }
    if (dto.monitorApiKey) {
      data.monitorApiKey = encryptAES256GCM(dto.monitorApiKey, key);
    }

    const vps = await this.prisma.vpsServer.update({ where: { id }, data });

    return this.decrypt(vps);
  }

  async deactivate(id: string): Promise<DecryptedVps> {
    await this.assertExists(id);

    const vps = await this.prisma.vpsServer.update({
      where: { id },
      data: { isActive: false },
    });
    return this.decrypt(vps);
  }

  private decrypt(vps: VpsServer): DecryptedVps {
    const key = this.encryptionKey;
    return {
      ...vps,
      managerApiKey: vps.managerApiKey
        ? decryptAES256GCM(vps.managerApiKey, key)
        : null,
      monitorApiKey: vps.monitorApiKey
        ? decryptAES256GCM(vps.monitorApiKey, key)
        : null,
    };
  }

  private get encryptionKey(): string {
    return this.config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  private async assertExists(id: string): Promise<void> {
    const exists = await this.prisma.vpsServer.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`VPS ${id} não encontrada`);
  }
}
