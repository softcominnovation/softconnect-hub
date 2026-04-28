import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthCachePayload } from '../auth/apikey.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AdapterResolverService } from '../providers/adapter-resolver.service';
import type {
  MessageResponseDto,
  ProviderContext,
  SendDocumentDto,
  SendListDto,
  SendMediaDto,
  SendPresenceDto,
  SendStickerDto,
  SendTextDto,
} from '../providers/whatsapp-provider.interface';
import { BatchProducer } from '../queue/batch.producer';
import { InstanceResolverService } from '../resolver/instance.resolver';
import type { SendBatchDocumentDto, SendBatchDto, SendBatchMediaDto } from './dto/message.dto';

export interface BatchStatusDto {
  id: string;
  status: string;
  totalMessages: number;
  sentCount: number;
  failedCount: number;
  createdAt: Date;
  completedAt: Date | null;
}

@Injectable()
export class MessageService {
  constructor(
    private readonly adapterResolver: AdapterResolverService,
    private readonly instanceResolver: InstanceResolverService,
    private readonly prisma: PrismaService,
    private readonly batchProducer: BatchProducer,
  ) {}

  private async ctx(
    product: AuthCachePayload,
    instanceId: string,
  ): Promise<{ ctx: ProviderContext; adapterType: string; instanceName: string }> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    return {
      ctx: {
        providerUrl: resolved.providerUrl,
        providerApiKey: resolved.providerApiKey,
      },
      adapterType: resolved.adapterType,
      instanceName: resolved.instanceName,
    };
  }

  async sendText(
    product: AuthCachePayload,
    instanceId: string,
    dto: SendTextDto,
  ): Promise<MessageResponseDto> {
    const { ctx, adapterType, instanceName } = await this.ctx(product, instanceId);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.sendText(ctx, instanceName, dto);
  }

  async sendMedia(
    product: AuthCachePayload,
    instanceId: string,
    dto: SendMediaDto,
  ): Promise<MessageResponseDto> {
    const { ctx, adapterType, instanceName } = await this.ctx(product, instanceId);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.sendMedia(ctx, instanceName, dto);
  }

  async sendList(
    product: AuthCachePayload,
    instanceId: string,
    dto: SendListDto,
  ): Promise<MessageResponseDto> {
    const { ctx, adapterType, instanceName } = await this.ctx(product, instanceId);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.sendList(ctx, instanceName, dto);
  }

  async sendDocument(
    product: AuthCachePayload,
    instanceId: string,
    dto: SendDocumentDto,
  ): Promise<MessageResponseDto> {
    const { ctx, adapterType, instanceName } = await this.ctx(product, instanceId);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.sendDocument(ctx, instanceName, dto);
  }

  async sendSticker(
    product: AuthCachePayload,
    instanceId: string,
    dto: SendStickerDto,
  ): Promise<MessageResponseDto> {
    const { ctx, adapterType, instanceName } = await this.ctx(product, instanceId);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.sendSticker(ctx, instanceName, dto);
  }

  async sendPresence(
    product: AuthCachePayload,
    instanceId: string,
    dto: SendPresenceDto,
  ): Promise<void> {
    const { ctx, adapterType, instanceName } = await this.ctx(product, instanceId);
    const adapter = this.adapterResolver.resolve(adapterType);
    return adapter.sendPresence(ctx, instanceName, dto);
  }

  async sendBatchMedia(
    product: AuthCachePayload,
    instanceId: string,
    dto: SendBatchMediaDto,
  ): Promise<{ batchJobId: string }> {
    const resolved = await this.instanceResolver.resolveById(product.productId, instanceId);
    const batchJob = await this.prisma.batchJob.create({
      data: {
        productId: product.productId,
        instanceId: resolved.instanceId,
        totalMessages: dto.messages.length,
        status: 'processing',
      },
    });
    await this.batchProducer.addJobs(
      batchJob.id,
      product.productId,
      resolved.adapterType,
      resolved.instanceName,
      resolved.providerUrl,
      resolved.providerApiKey,
      dto.messages,
      dto.delayMs,
    );
    return { batchJobId: batchJob.id };
  }

  async sendBatchDocument(
    product: AuthCachePayload,
    instanceId: string,
    dto: SendBatchDocumentDto,
  ): Promise<{ batchJobId: string }> {
    const resolved = await this.instanceResolver.resolveById(product.productId, instanceId);
    const batchJob = await this.prisma.batchJob.create({
      data: {
        productId: product.productId,
        instanceId: resolved.instanceId,
        totalMessages: dto.messages.length,
        status: 'processing',
      },
    });
    await this.batchProducer.addJobs(
      batchJob.id,
      product.productId,
      resolved.adapterType,
      resolved.instanceName,
      resolved.providerUrl,
      resolved.providerApiKey,
      dto.messages,
      dto.delayMs,
    );
    return { batchJobId: batchJob.id };
  }

  async deleteBatch(product: AuthCachePayload, batchJobId: string): Promise<void> {
    const job = await this.prisma.batchJob.findFirst({
      where: { id: batchJobId, productId: product.productId },
    });
    if (!job) {
      throw new NotFoundException(`BatchJob "${batchJobId}" não encontrado`);
    }
    await this.prisma.batchJob.delete({ where: { id: batchJobId } });
  }

  async sendBatch(
    product: AuthCachePayload,
    instanceId: string,
    dto: SendBatchDto,
  ): Promise<{ batchJobId: string }> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );

    const batchJob = await this.prisma.batchJob.create({
      data: {
        productId: product.productId,
        instanceId: resolved.instanceId,
        totalMessages: dto.messages.length,
        status: 'processing',
      },
    });

    await this.batchProducer.addJobs(
      batchJob.id,
      product.productId,
      resolved.adapterType,
      resolved.instanceName,
      resolved.providerUrl,
      resolved.providerApiKey,
      dto.messages,
      dto.delayMs,
    );

    return { batchJobId: batchJob.id };
  }

  async getBatchStatus(
    product: AuthCachePayload,
    batchJobId: string,
  ): Promise<BatchStatusDto> {
    const job = await this.prisma.batchJob.findFirst({
      where: { id: batchJobId, productId: product.productId },
      select: {
        id: true,
        status: true,
        totalMessages: true,
        sentCount: true,
        failedCount: true,
        createdAt: true,
        completedAt: true,
      },
    });

    if (!job) {
      throw new NotFoundException(`BatchJob "${batchJobId}" não encontrado`);
    }

    return job;
  }
}
