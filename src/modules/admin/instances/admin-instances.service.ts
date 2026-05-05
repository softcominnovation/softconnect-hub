import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthCachePayload } from '../../../auth/apikey.guard';
import { InstanceService } from '../../instance/instance.service';
import { MessageService } from '../../message/message.service';
import { EvolutionHttpService } from '../../../adapters/evolution/evolution.http';
import { decryptAES256GCM } from '../../../common/crypto.util';
import { ConfigService } from '@nestjs/config';
import type {
  ConnectInstanceDto,
  ConnectionStateDto,
  CreateInstanceDto,
  InstanceCreatedDto,
  InstanceDto,
  SendPresenceDto,
  SendTextDto,
  MessageResponseDto,
} from '../../../providers/whatsapp-provider.interface';
import type {
  ImportEvolutionInstanceDto,
  ImportBulkResultDto,
  ImportBulkItemResultDto,
} from './dto/import-evolution-instance.dto';

@Injectable()
export class AdminInstancesService {
  private readonly logger = new Logger(AdminInstancesService.name);
  private readonly encryptionKeyHex: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly instanceService: InstanceService,
    private readonly messageService: MessageService,
    private readonly evolutionHttp: EvolutionHttpService,
    private readonly config: ConfigService,
  ) {
    this.encryptionKeyHex = this.config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  private async buildPayload(productId: string): Promise<AuthCachePayload> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        isActive: true,
        origins: true,
        hubRelay: true,
        adapterType: true,
        vpsId: true,
      },
    });

    if (!product)
      throw new NotFoundException(`Produto ${productId} não encontrado`);
    if (!product.isActive) throw new BadRequestException('Produto inativo');

    return {
      productId: product.id,
      isActive: product.isActive,
      origins: product.origins,
      hubRelay: product.hubRelay,
      adapterType: product.adapterType,
      vpsId: product.vpsId,
    };
  }

  async createInstance(
    productId: string,
    dto: CreateInstanceDto,
  ): Promise<InstanceCreatedDto & { id: string }> {
    const payload = await this.buildPayload(productId);
    return this.instanceService.createInstance(payload, dto);
  }

  async listInstances(productId: string): Promise<InstanceDto[]> {
    const payload = await this.buildPayload(productId);
    return this.instanceService.listInstances(payload);
  }

  async fetchInstance(
    productId: string,
    instanceId: string,
  ): Promise<InstanceDto> {
    const payload = await this.buildPayload(productId);
    return this.instanceService.fetchInstance(payload, instanceId);
  }

  async connectInstance(
    productId: string,
    instanceId: string,
  ): Promise<ConnectInstanceDto> {
    const payload = await this.buildPayload(productId);
    return this.instanceService.connectInstance(payload, instanceId);
  }

  async getConnectionState(
    productId: string,
    instanceId: string,
  ): Promise<ConnectionStateDto> {
    const payload = await this.buildPayload(productId);
    return this.instanceService.getConnectionState(payload, instanceId);
  }

  async restartInstance(productId: string, instanceId: string): Promise<void> {
    const payload = await this.buildPayload(productId);
    return this.instanceService.restartInstance(payload, instanceId);
  }

  async disconnectInstance(
    productId: string,
    instanceId: string,
  ): Promise<void> {
    this.logger.log(
      `[admin:disconnect] productId=${productId} instanceId=${instanceId}`,
    );
    const payload = await this.buildPayload(productId);
    return this.instanceService.logoutInstance(payload, instanceId);
  }

  async deleteInstance(productId: string, instanceId: string): Promise<void> {
    this.logger.log(
      `[admin:delete] productId=${productId} instanceId=${instanceId}`,
    );
    const payload = await this.buildPayload(productId);
    return this.instanceService.deleteInstance(payload, instanceId);
  }

  async sendText(
    productId: string,
    instanceId: string,
    dto: SendTextDto,
  ): Promise<MessageResponseDto> {
    this.logger.log(
      `[admin:sendText] productId=${productId} instanceId=${instanceId} dto=${JSON.stringify(dto)}`,
    );
    const payload = await this.buildPayload(productId);
    return this.messageService.sendText(payload, instanceId, dto);
  }

  async sendPresence(
    productId: string,
    instanceId: string,
    dto: SendPresenceDto,
  ): Promise<void> {
    this.logger.log(
      `[admin:sendPresence] productId=${productId} instanceId=${instanceId} dto=${JSON.stringify(dto)}`,
    );
    const payload = await this.buildPayload(productId);
    return this.messageService.sendPresence(payload, instanceId, dto);
  }

  async listHubInstances(productId: string): Promise<HubInstanceDto[]> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product)
      throw new NotFoundException(`Produto ${productId} não encontrado`);

    return this.prisma.instance.findMany({
      where: { productId, isActive: true },
      select: {
        id: true,
        instanceName: true,
        providerInstanceId: true,
        status: true,
        phoneNumber: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getHubInstance(
    productId: string,
    instanceId: string,
  ): Promise<HubInstanceDto> {
    const instance = await this.prisma.instance.findFirst({
      where: { id: instanceId, productId, isActive: true },
      select: {
        id: true,
        instanceName: true,
        providerInstanceId: true,
        status: true,
        phoneNumber: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!instance)
      throw new NotFoundException(`Instância ${instanceId} não encontrada`);

    return instance;
  }

  async importSingleInstance(
    productId: string,
    dto: ImportEvolutionInstanceDto,
  ): Promise<{ result: 'created' | 'skipped'; hubInstanceId: string }> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, vpsId: true, isActive: true },
    });

    if (!product)
      throw new NotFoundException(`Produto ${productId} não encontrado`);
    if (!product.isActive) throw new BadRequestException('Produto inativo');
    if (!product.vpsId)
      throw new BadRequestException('Produto sem VPS associada');

    const existing = await this.prisma.instance.findFirst({
      where: { productId, providerInstanceId: dto.id },
      select: { id: true },
    });

    if (existing) {
      this.logger.log(
        `[admin:import:single] skipped — providerInstanceId=${dto.id} já vinculado ao produto ${productId}`,
      );
      return { result: 'skipped', hubInstanceId: existing.id };
    }

    const hubToken = `hub_${productId}_${dto.name}`;

    const tokenConflict = await this.prisma.instance.findUnique({
      where: { hubToken },
      select: { id: true },
    });

    const finalHubToken = tokenConflict
      ? `hub_${productId}_${dto.name}_${dto.id.slice(0, 8)}`
      : hubToken;

    const status = this.normalizeConnectionStatus(dto.connectionStatus);

    const created = await this.prisma.instance.create({
      data: {
        productId,
        vpsId: product.vpsId,
        instanceName: dto.name,
        providerInstanceId: dto.id,
        instanceToken: dto.token,
        hubToken: finalHubToken,
        phoneNumber: dto.number ?? null,
        status,
        isActive: true,
      },
    });

    this.logger.log(
      `[admin:import:single] created — instanceName=${dto.name} providerInstanceId=${dto.id} hubInstanceId=${created.id}`,
    );

    return { result: 'created', hubInstanceId: created.id };
  }

  async importBulkInstances(productId: string): Promise<ImportBulkResultDto> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, vpsId: true, isActive: true },
    });

    if (!product)
      throw new NotFoundException(`Produto ${productId} não encontrado`);
    if (!product.isActive) throw new BadRequestException('Produto inativo');
    if (!product.vpsId)
      throw new BadRequestException('Produto sem VPS associada');

    const vps = await this.prisma.vpsServer.findUnique({
      where: { id: product.vpsId, isActive: true },
      select: { id: true, providerUrl: true, providerApiKey: true },
    });

    if (!vps) throw new NotFoundException('VPS não encontrada ou inativa');

    const decryptedApiKey = decryptAES256GCM(
      vps.providerApiKey,
      this.encryptionKeyHex,
    );

    const rawResponse = await this.evolutionHttp.request<unknown>(
      'get',
      vps.providerUrl,
      decryptedApiKey,
      '/instance/fetchInstances',
    );

    const instances = this.normalizeEvolutionFetchResponse(rawResponse);

    this.logger.log(
      `[admin:import:bulk] productId=${productId} — ${instances.length} instâncias encontradas na Evolution`,
    );

    const details: ImportBulkItemResultDto[] = [];
    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const inst of instances) {
      const { evId, evName, evToken, evNumber, evStatus } =
        this.extractEvolutionInstanceFields(inst);

      const displayName = evName || 'unknown';

      if (!evId) {
        errors++;
        details.push({
          instanceName: displayName,
          result: 'error',
          reason:
            'id ausente na resposta da Evolution — não foi possível identificar a instância',
        });
        this.logger.warn(
          `[admin:import:bulk] id ausente para instância "${displayName}" — pulando`,
        );
        continue;
      }

      try {
        const existing = await this.prisma.instance.findFirst({
          where: { productId, providerInstanceId: evId },
          select: { id: true },
        });

        if (existing) {
          skipped++;
          details.push({
            instanceName: displayName,
            result: 'skipped',
            hubInstanceId: existing.id,
          });
          continue;
        }

        const hubToken = `hub_${productId}_${evName}`;
        const tokenConflict = await this.prisma.instance.findUnique({
          where: { hubToken },
          select: { id: true },
        });
        const finalHubToken = tokenConflict
          ? `hub_${productId}_${evName}_${evId.slice(0, 8)}`
          : hubToken;

        const status = this.normalizeConnectionStatus(evStatus);

        const record = await this.prisma.instance.create({
          data: {
            productId,
            vpsId: vps.id,
            instanceName: evName,
            providerInstanceId: evId,
            instanceToken: evToken || null,
            hubToken: finalHubToken,
            phoneNumber: evNumber ?? null,
            status,
            isActive: true,
          },
        });

        created++;
        details.push({
          instanceName: displayName,
          result: 'created',
          hubInstanceId: record.id,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors++;
        details.push({
          instanceName: displayName,
          result: 'error',
          reason: message,
        });
        this.logger.warn(
          `[admin:import:bulk] error on instance ${displayName}: ${message}`,
        );
      }
    }

    this.logger.log(
      `[admin:import:bulk] productId=${productId} — created=${created} skipped=${skipped} errors=${errors}`,
    );

    return { created, skipped, errors, details };
  }

  private extractEvolutionInstanceFields(inst: Record<string, unknown>): {
    evId: string;
    evName: string;
    evToken: string;
    evNumber: string | undefined;
    evStatus: string | undefined;
  } {
    const nested = inst.instance as Record<string, unknown> | undefined;

    const setting = inst.Setting as Record<string, unknown> | undefined;

    const evId =
      (inst.id as string | undefined) ||
      (nested?.instanceId as string | undefined) ||
      (inst.instanceId as string | undefined) ||
      (setting?.instanceId as string | undefined) ||
      '';

    const evName =
      (inst.name as string | undefined) ||
      (nested?.instanceName as string | undefined) ||
      (inst.instanceName as string | undefined) ||
      '';

    const evToken =
      (inst.token as string | undefined) ||
      (nested?.token as string | undefined) ||
      '';

    const evNumber =
      (inst.number as string | undefined) ||
      (nested?.number as string | undefined);

    const evStatus =
      (inst.connectionStatus as string | undefined) ||
      (nested?.connectionStatus as string | undefined) ||
      (nested?.status as string | undefined);

    return { evId, evName, evToken, evNumber, evStatus };
  }

  private normalizeEvolutionFetchResponse(
    raw: unknown,
  ): Array<Record<string, unknown>> {
    if (!raw) return [];

    if (Array.isArray(raw)) {
      if (raw.length === 0) return [];

      if (Array.isArray(raw[0])) {
        return (raw as Array<Array<Record<string, unknown>>>).flat();
      }

      return raw as Array<Record<string, unknown>>;
    }

    return [];
  }

  private normalizeConnectionStatus(connectionStatus?: string): string {
    if (!connectionStatus) return 'disconnected';
    const map: Record<string, string> = {
      open: 'connected',
      connecting: 'connecting',
      close: 'disconnected',
      disconnected: 'disconnected',
    };
    return map[connectionStatus.toLowerCase()] ?? 'disconnected';
  }
}

export interface HubInstanceDto {
  id: string;
  instanceName: string;
  providerInstanceId: string | null;
  status: string;
  phoneNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
}
