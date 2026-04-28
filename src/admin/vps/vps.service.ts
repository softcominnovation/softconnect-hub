import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { VpsServer } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { decryptAES256GCM, encryptAES256GCM } from '../../common/crypto.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVpsDto } from './dto/create-vps.dto';
import { UpdateVpsDto } from './dto/update-vps.dto';

type DecryptedVps = Omit<VpsServer, 'providerApiKey' | 'managerApiKey'> & {
  providerApiKey: string;
  managerApiKey: string | null;
};

@Injectable()
export class VpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateVpsDto): Promise<DecryptedVps> {
    const key = this.encryptionKey;

    try {
      const vps = await this.prisma.vpsServer.create({
        data: {
          label: dto.label,
          subdomain: dto.subdomain,
          ip: dto.ip,
          providerUrl: dto.providerUrl,
          providerApiKey: encryptAES256GCM(dto.providerApiKey, key),
          adapterType: dto.adapterType ?? 'evolution',
          managerType: dto.managerType ?? null,
          managerUrl: dto.managerUrl ?? null,
          managerApiKey: dto.managerApiKey
            ? encryptAES256GCM(dto.managerApiKey, key)
            : null,
        },
      });

      return this.decrypt(vps);
    } catch (err) {
      if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A VPS with this subdomain already exists');
      }
      throw err;
    }
  }

  async findAll(): Promise<DecryptedVps[]> {
    const list = await this.prisma.vpsServer.findMany();
    return list.map((vps) => this.decrypt(vps));
  }

  async update(id: string, dto: UpdateVpsDto): Promise<DecryptedVps> {
    await this.assertExists(id);

    const key = this.encryptionKey;
    const data: Partial<VpsServer> = { ...dto };

    if (dto.providerApiKey) {
      data.providerApiKey = encryptAES256GCM(dto.providerApiKey, key);
    }
    if (dto.managerApiKey) {
      data.managerApiKey = encryptAES256GCM(dto.managerApiKey, key);
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
      providerApiKey: decryptAES256GCM(vps.providerApiKey, key),
      managerApiKey: vps.managerApiKey
        ? decryptAES256GCM(vps.managerApiKey, key)
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
