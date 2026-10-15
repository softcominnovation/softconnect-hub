import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
  HttpException,
  Optional,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { importLinkedInstance } from '../../../prisma/evolution-links';
import { CacheService } from '../../../cache/cache.service';
import { invalidateInstanceCache } from '../../../cache/instance-cache';
import { AuditService } from '../../../audit/audit.service';
import { AuthCachePayload } from '../../../auth/apikey.guard';
import { InstanceService } from '../../instance/instance.service';
import { MessageService } from '../../message/message.service';
import { EvolutionHttpService } from '../../../adapters/evolution/evolution.http';
import { decryptAES256GCM } from '../../../common/crypto.util';
import { ConfigService } from '@nestjs/config';
import type { QrRequestContext } from '../../../common/qr-request-context';
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
    @Optional() private readonly cache?: CacheService,
    @Optional() private readonly audit?: AuditService,
  ) {
    this.encryptionKeyHex = this.config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  private async buildPayload(productId: string): Promise<AuthCachePayload> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        apiKeyHash: true,
        isActive: true,
        origins: true,
        hubRelay: true,
        adapterType: true,
        vpsProviderId: true,
        batchWebhookEnabled: true,
        batchWebhookUrl: true,
      },
    });

    if (!product)
      throw new NotFoundException(`Produto ${productId} não encontrado`);
    if (!product.isActive) throw new BadRequestException('Produto inativo');

    return {
      productId: product.id,
      apiKeyHash: product.apiKeyHash,
      isActive: product.isActive,
      origins: product.origins,
      hubRelay: product.hubRelay,
      adapterType: product.adapterType,
      vpsProviderId: product.vpsProviderId,
      batchWebhookEnabled: product.batchWebhookEnabled,
      batchWebhookUrl: product.batchWebhookUrl,
    };
  }

  async createInstance(
    productId: string,
    dto: CreateInstanceDto,
    execution?: QrRequestContext,
  ): Promise<InstanceCreatedDto & { hubId: string }> {
    const payload = await this.buildPayload(productId);
    return this.instanceService.createInstance(payload, dto, execution);
  }

  async listInstances(
    productId: string,
    instanceNameFilter?: string,
  ): Promise<InstanceDto[]> {
    const payload = await this.buildPayload(productId);
    return this.instanceService.listInstances(payload, instanceNameFilter);
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
    execution?: QrRequestContext,
  ): Promise<ConnectInstanceDto> {
    const payload = await this.buildPayload(productId);
    return this.instanceService.connectInstance(payload, instanceId, execution);
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

  private async importSource(productId: string, selected?: string) {
    if (
      selected !== undefined &&
      (typeof selected !== 'string' || !selected.trim())
    )
      throw new BadRequestException('vpsProviderId inválido');
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product)
      throw new NotFoundException(`Produto ${productId} não encontrado`);
    if (!product.isActive) throw new BadRequestException('Produto inativo');
    const id = selected ?? product.vpsProviderId;
    if (!id) throw new BadRequestException('Produto sem VpsProvider associado');
    const link = await this.prisma.productEvolution.findUnique({
      where: { productId_vpsProviderId: { productId, vpsProviderId: id } },
    });
    if (!link)
      throw new BadRequestException('Provider não vinculado ao produto');
    const provider = await this.prisma.vpsProvider.findUnique({
      where: { id, isActive: true },
    });
    if (!provider)
      throw new NotFoundException('VpsProvider nao encontrado ou inativo');
    if (provider.adapterType !== 'evolution')
      throw new BadRequestException('Origem não é Evolution');
    return provider;
  }

  private async remoteImportRows(
    provider: Awaited<ReturnType<AdminInstancesService['importSource']>>,
  ) {
    const response = await this.evolutionHttp.request<unknown>(
      'get',
      provider.providerUrl,
      decryptAES256GCM(provider.providerApiKey, this.encryptionKeyHex),
      '/instance/fetchInstances',
    );
    if (!Array.isArray(response))
      throw new BadGatewayException('Resposta de inventário inválida');
    const rows = this.normalizeEvolutionFetchResponse(response);
    if (
      rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
    )
      throw new BadGatewayException('Resposta de inventário inválida');
    return rows.map((row) => this.extractEvolutionInstanceFields(row));
  }

  private async assignImported(
    productId: string,
    provider: Awaited<ReturnType<AdminInstancesService['importSource']>>,
    row: ReturnType<AdminInstancesService['extractEvolutionInstanceFields']>,
    number = row.evNumber,
  ) {
    if (!row.evId || !row.evName)
      throw new BadRequestException('Identidade incompleta na Evolution');
    const assigned = await importLinkedInstance(
      this.prisma,
      {
        productId,
        vpsProviderId: provider.id,
        instanceName: row.evName,
        providerInstanceId: row.evId,
        instanceToken: row.evToken || null,
        hubToken: `hub_${productId}_${row.evName}`,
        phoneNumber: number ?? null,
        status: this.normalizeConnectionStatus(row.evStatus),
        isActive: true,
      },
      provider,
    );
    if (this.cache)
      await invalidateInstanceCache(this.cache, assigned.instance);
    this.audit?.log({
      productId,
      instanceId: assigned.instance.id,
      endpoint: '/admin/instances/import',
      method: 'POST',
      statusCode: 201,
      latencyMs: 0,
      ip: 'internal',
      origin: `evolution:${provider.id}:${assigned.result}`,
    });
    return { result: assigned.result, hubInstanceId: assigned.instance.id };
  }

  async importSingleInstance(
    productId: string,
    dto: ImportEvolutionInstanceDto,
  ): Promise<{ result: 'created' | 'skipped'; hubInstanceId: string }> {
    if (
      typeof dto?.id !== 'string' ||
      !dto.id ||
      typeof dto.name !== 'string' ||
      !dto.name
    )
      throw new BadRequestException('ID e nome da instância são obrigatórios');
    const provider = await this.importSource(productId, dto.vpsProviderId);
    const rows = await this.remoteImportRows(provider);
    const matches = rows.filter(
      (row) => row.evId === dto.id || row.evName === dto.name,
    );
    if (
      matches.length !== 1 ||
      matches[0].evId !== dto.id ||
      matches[0].evName !== dto.name
    )
      throw new ConflictException(
        'Origem ou identidade da instância não comprovada',
      );
    return this.assignImported(
      productId,
      provider,
      matches[0],
      dto.number ?? matches[0].evNumber,
    );
  }

  async importBulkInstances(
    productId: string,
    selected?: string,
    instanceIds?: string[],
  ): Promise<ImportBulkResultDto> {
    if (
      instanceIds !== undefined &&
      (!Array.isArray(instanceIds) ||
        !instanceIds.length ||
        instanceIds.some((id) => typeof id !== 'string' || !id.trim()) ||
        new Set(instanceIds).size !== instanceIds.length)
    )
      throw new BadRequestException(
        'instanceIds deve conter IDs distintos e não vazios',
      );
    const provider = await this.importSource(productId, selected);
    const all = await this.remoteImportRows(provider);
    const rows = instanceIds
      ? all.filter((row) => instanceIds.includes(row.evId))
      : all;
    const details: ImportBulkItemResultDto[] = [];
    let created = 0,
      skipped = 0,
      errors = 0;
    for (const row of rows) {
      try {
        if (!row.evId)
          throw new BadRequestException(
            'id ausente na resposta da Evolution — não foi possível identificar a instância',
          );
        if (
          all.filter(
            (other) => other.evId === row.evId || other.evName === row.evName,
          ).length !== 1
        )
          throw new ConflictException('Identidade ambígua na Evolution');
        const assigned = await this.assignImported(productId, provider, row);
        if (assigned.result === 'created') created++;
        else skipped++;
        details.push({ instanceName: row.evName || 'unknown', ...assigned });
      } catch (error) {
        errors++;
        details.push({
          instanceName: row.evName || 'unknown',
          result: 'error',
          reason:
            error instanceof HttpException
              ? error.message
              : 'Falha ao registrar instância; vínculo preservado',
        });
      }
    }
    for (const id of instanceIds ?? []) {
      if (!all.some((row) => row.evId === id)) {
        errors++;
        details.push({
          instanceName: 'unknown',
          result: 'error',
          reason: 'ID selecionado não encontrado na origem',
        });
      }
    }
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
