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

@Injectable()
export class AdminInstancesService {
  private readonly logger = new Logger(AdminInstancesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly instanceService: InstanceService,
    private readonly messageService: MessageService,
  ) {}

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

  async listInstances(
    productId: string,
  ): Promise<(InstanceDto & { id: string })[]> {
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
    this.logger.log(`[admin:disconnect] productId=${productId} instanceId=${instanceId}`);
    const payload = await this.buildPayload(productId);
    return this.instanceService.logoutInstance(payload, instanceId);
  }

  async deleteInstance(productId: string, instanceId: string): Promise<void> {
    this.logger.log(`[admin:delete] productId=${productId} instanceId=${instanceId}`);
    const payload = await this.buildPayload(productId);
    return this.instanceService.deleteInstance(payload, instanceId);
  }

  async sendText(
    productId: string,
    instanceId: string,
    dto: SendTextDto,
  ): Promise<MessageResponseDto> {
    this.logger.log(`[admin:sendText] productId=${productId} instanceId=${instanceId} dto=${JSON.stringify(dto)}`);
    const payload = await this.buildPayload(productId);
    return this.messageService.sendText(payload, instanceId, dto);
  }

  async sendPresence(
    productId: string,
    instanceId: string,
    dto: SendPresenceDto,
  ): Promise<void> {
    this.logger.log(`[admin:sendPresence] productId=${productId} instanceId=${instanceId} dto=${JSON.stringify(dto)}`);
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
