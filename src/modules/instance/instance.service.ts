import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  RequestTimeoutException,
} from '@nestjs/common';
import axios from 'axios';

function isProviderTimeoutError(err: unknown): boolean {
  if (err instanceof HttpException) {
    return err.getStatus() === 408 || err.getStatus() === 504;
  }
  return (
    axios.isAxiosError(err) &&
    !err.response &&
    (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')
  );
}

function extractErrorDetail(err: unknown): string {
  if (err instanceof HttpException) {
    const response = err.getResponse();
    if (typeof response === 'string') return response;
    if (typeof response === 'object' && response !== null) {
      const r = response as Record<string, unknown>;
      const msg =
        r['message'] ??
        r['error'] ??
        r['details'] ??
        r['detail'] ??
        r['reason'];
      if (msg !== undefined) {
        return typeof msg === 'string' ? msg : JSON.stringify(msg);
      }
      return JSON.stringify(response);
    }
  }
  if (err instanceof Error) return err.message;
  return JSON.stringify(err);
}

/** Provider já não tem a instância — seguro limpar o Hub (idempotente). */
function isProviderNotFoundError(err: unknown): boolean {
  if (!(err instanceof HttpException)) return false;

  const status = err.getStatus();
  if (status === 404) return true;

  // Evolution às vezes responde 400 com "does not exist" / "not found"
  if (status >= 400 && status < 500) {
    const detail = extractErrorDetail(err).toLowerCase();
    return (
      detail.includes('not found') ||
      detail.includes('does not exist') ||
      detail.includes('não encontrad') ||
      detail.includes('nao encontrad')
    );
  }

  return false;
}
import { ConfigService } from '@nestjs/config';
import type {
  ProductDefaultProxy,
  ProductDefaultWebhook,
} from '@prisma/client';
import { AuthCachePayload } from '../../auth/apikey.guard';
import { decryptAES256GCM } from '../../common/crypto.util';
import { CacheService } from '../../cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import {
  ConnectInstanceDto,
  ConnectionStateDto,
  CreateInstanceDto,
  InstanceCreatedDto,
  InstanceDto,
  ProviderContext,
} from '../../providers/whatsapp-provider.interface';
import { InstanceResolverService } from '../../resolver/instance.resolver';
import {
  QrRequestContext,
  QrTimeoutException,
} from '../../common/qr-request-context';

@Injectable()
export class InstanceService {
  private readonly logger = new Logger(InstanceService.name);
  private readonly encryptionKeyHex: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly adapterResolver: AdapterResolverService,
    private readonly instanceResolver: InstanceResolverService,
    private readonly config: ConfigService,
  ) {
    this.encryptionKeyHex = this.config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  async createInstance(
    product: AuthCachePayload,
    dto: CreateInstanceDto,
    execution?: QrRequestContext,
  ): Promise<InstanceCreatedDto & { hubId: string } & Record<string, unknown>> {
    execution?.assertActive();
    if (execution) execution.productId = product.productId;
    if (!product.vpsProviderId) {
      throw new BadRequestException('Produto sem VpsProvider associado');
    }

    const provider = await this.prisma.vpsProvider.findUnique({
      where: { id: product.vpsProviderId, isActive: true },
    });

    if (!provider)
      throw new NotFoundException('VpsProvider nao encontrado ou inativo');

    if (provider.adapterType !== product.adapterType) {
      throw new BadRequestException(
        `Incompatibilidade de adapter: produto usa "${product.adapterType}", VPS usa "${provider.adapterType}"`,
      );
    }

    const ctx: ProviderContext = {
      providerUrl: provider.providerUrl,
      providerApiKey: decryptAES256GCM(
        provider.providerApiKey,
        this.encryptionKeyHex,
      ),
      ...(execution ? { execution } : {}),
    };
    if (execution) execution.providerId = provider.id;

    const existingInstance = await this.prisma.instance.findFirst({
      where: { productId: product.productId, instanceName: dto.instanceName },
    });

    if (existingInstance) {
      const adapter = this.adapterResolver.resolve(product.adapterType);
      let existsInProvider = false;

      try {
        execution?.assertActive();
        const providerInstances = await adapter.fetchInstances(ctx);
        existsInProvider = providerInstances.some(
          (i) => i.instanceName === dto.instanceName,
        );
      } catch (error) {
        this.checkQrInterruption(execution, error);
        existsInProvider = false;
      }

      if (existsInProvider) {
        throw new ConflictException(
          `Instância "${dto.instanceName}" já existe neste produto e no provider (id: ${existingInstance.id})`,
        );
      }

      execution?.assertActive();
      this.logger.warn(
        `[createInstance] registro órfão encontrado no Hub (id=${existingInstance.id}) sem correspondência no provider — removendo e recriando`,
      );
      await this.prisma.instance.delete({ where: { id: existingInstance.id } });
    } else {
      // Hub sem registro: ainda assim bloquear se o nome já existir no provider
      // (evita falso "criar" após delete dessincronizado no passado).
      const adapterForCheck = this.adapterResolver.resolve(product.adapterType);
      try {
        execution?.assertActive();
        const providerInstances = await adapterForCheck.fetchInstances(ctx);
        const existsInProvider = providerInstances.some(
          (i) => i.instanceName === dto.instanceName,
        );
        if (existsInProvider) {
          throw new ConflictException(
            `Instância "${dto.instanceName}" já existe no provider, mas não está registrada no Hub. Remova-a no provider ou importe-a pelo Manager antes de criar.`,
          );
        }
      } catch (err) {
        this.checkQrInterruption(execution, err);
        if (err instanceof ConflictException) throw err;
        this.logger.warn(
          `[createInstance] não foi possível verificar existência no provider antes de criar — prosseguindo. error=${execution ? 'provider_lookup_failed' : extractErrorDetail(err)}`,
        );
      }
    }

    const adapter = this.adapterResolver.resolve(product.adapterType);
    execution?.assertActive();
    let result: InstanceCreatedDto;
    try {
      result = await adapter.createInstance(ctx, dto);
    } catch (error) {
      if (execution)
        this.logger.warn(
          `[qr:create] resultado remoto não confirmado. productId=${product.productId} providerId=${provider.id}`,
        );
      throw error;
    }

    const instance = await this.prisma.instance.create({
      data: {
        productId: product.productId,
        vpsProviderId: provider.id,
        instanceName: dto.instanceName,
        providerInstanceId: result.instanceId ?? null,
        instanceToken: dto.token,
        hubToken: `hub_${product.productId}_${dto.instanceName}`,
        status: 'disconnected',
      },
    });
    if (execution) execution.instanceId = instance.id;
    if (execution?.signal.aborted)
      this.logger.warn(
        `[qr:create] vínculo preservado após interrupção. instanceId=${instance.id}`,
      );
    execution?.assertActive();

    const response: InstanceCreatedDto & { hubId: string } & Record<
        string,
        unknown
      > = {
      ...result,
      hubId: instance.id,
    };

    if (adapter.applyInstanceDefaults) {
      let defaultWebhook: ProductDefaultWebhook | null = null;
      let defaultProxy: ProductDefaultProxy | null = null;

      try {
        [defaultWebhook, defaultProxy] = await Promise.all([
          this.prisma.productDefaultWebhook.findUnique({
            where: { productId: product.productId },
          }),
          this.prisma.productDefaultProxy.findUnique({
            where: { productId: product.productId },
          }),
        ]);
      } catch (err) {
        this.logger.warn(
          `[createInstance] erro ao buscar defaults — prosseguindo sem aplicar: ${(err as Error).message}`,
        );
      }

      const hasDefaults = defaultWebhook || defaultProxy;

      if (hasDefaults) {
        try {
          execution?.assertActive();
          const applied = await adapter.applyInstanceDefaults(
            ctx,
            dto.instanceName,
            {
              webhook: defaultWebhook
                ? {
                    enabled: defaultWebhook.enabled,
                    url: defaultWebhook.url,
                    headers: defaultWebhook.headers as
                      | Record<string, string>
                      | undefined,
                    byEvents: defaultWebhook.byEvents,
                    base64: defaultWebhook.base64,
                    events: defaultWebhook.events,
                  }
                : undefined,
              proxy: defaultProxy
                ? {
                    enabled: defaultProxy.enabled,
                    host: defaultProxy.host,
                    port: defaultProxy.port,
                    protocol: defaultProxy.protocol,
                    username: defaultProxy.username ?? undefined,
                    password: defaultProxy.password ?? undefined,
                  }
                : undefined,
            },
          );

          if (applied.webhook !== undefined) response.webhook = applied.webhook;
          if (applied.proxy !== undefined) response.proxy = applied.proxy;
        } catch (err) {
          if (execution) {
            this.logger.warn(
              `[qr:defaults] configuração incompleta; vínculo preservado até confirmação de compensação. instanceId=${instance.id}`,
            );
            this.checkQrInterruption(execution, err);
            try {
              execution.assertActive();
              await adapter.deleteInstance(ctx, dto.instanceName);
              await this.prisma.instance.deleteMany({
                where: { id: instance.id },
              });
            } catch (deleteErr) {
              this.checkQrInterruption(execution, deleteErr);
              throw new BadGatewayException(
                'Falha ao reverter configurações padrão; registro mantido para verificação',
              );
            }
            throw new BadRequestException(
              'Falha ao aplicar configurações padrão — operação revertida.',
            );
          }
          if (isProviderTimeoutError(err)) {
            this.logger.warn(
              `[createInstance] timeout nos defaults; vínculo preservado. instanceId=${instance.id}`,
            );
            throw err instanceof HttpException
              ? err
              : new RequestTimeoutException('Request timeout');
          }
          const errMsg = extractErrorDetail(err);
          const errFull =
            err instanceof HttpException
              ? JSON.stringify(err.getResponse())
              : errMsg;
          this.logger.error(
            `[createInstance] falha ao aplicar defaults — iniciando rollback. productId=${product.productId} instanceName=${dto.instanceName}: ${errFull}`,
          );

          try {
            await adapter.deleteInstance(ctx, dto.instanceName);
          } catch (deleteErr) {
            if (!isProviderNotFoundError(deleteErr)) {
              this.logger.warn(
                `[createInstance] rollback não confirmado; vínculo preservado. instanceId=${instance.id}`,
              );
              if (isProviderTimeoutError(deleteErr)) {
                throw deleteErr instanceof HttpException
                  ? deleteErr
                  : new RequestTimeoutException('Request timeout');
              }
              throw new BadGatewayException(
                'Falha ao reverter configurações padrão; registro mantido para verificação',
              );
            }
          }

          await this.prisma.instance.deleteMany({
            where: { id: instance.id },
          });

          throw new BadRequestException(
            `Falha ao aplicar configurações padrão — operação revertida. Detalhe: ${errFull}`,
          );
        }
      }
    }

    execution?.assertActive();
    return response;
  }

  private checkQrInterruption(
    execution: QrRequestContext | undefined,
    error: unknown,
  ): void {
    if (!execution) return;
    execution.assertActive();
    if (
      error instanceof QrTimeoutException ||
      (error instanceof HttpException &&
        (error.getStatus() === 408 || error.getStatus() === 504))
    )
      throw error;
  }

  async listInstances(
    product: AuthCachePayload,
    instanceNameFilter?: string,
  ): Promise<InstanceDto[]> {
    if (!product.vpsProviderId) {
      throw new BadRequestException('Produto sem VpsProvider associado');
    }

    const provider = await this.prisma.vpsProvider.findUnique({
      where: { id: product.vpsProviderId, isActive: true },
    });

    if (!provider)
      throw new NotFoundException('VpsProvider nao encontrado ou inativo');

    const ctx: ProviderContext = {
      providerUrl: provider.providerUrl,
      providerApiKey: decryptAES256GCM(
        provider.providerApiKey,
        this.encryptionKeyHex,
      ),
    };

    const adapter = this.adapterResolver.resolve(product.adapterType);
    const nameFilter = instanceNameFilter?.trim() || undefined;

    const [hubInstances, providerInstances] = await Promise.all([
      this.prisma.instance.findMany({
        where: {
          productId: product.productId,
          isActive: true,
          ...(nameFilter
            ? {
                instanceName: {
                  contains: nameFilter,
                  mode: 'insensitive' as const,
                },
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
      }),
      adapter.fetchInstances(ctx),
    ]);

    const byProviderId = new Map<string, InstanceDto>();
    const byName = new Map<string, InstanceDto>();
    for (const pi of providerInstances) {
      const providerId = pi.id ?? pi.instanceId;
      if (providerId) byProviderId.set(providerId, pi);
      if (pi.instanceName) byName.set(pi.instanceName, pi);
    }

    const list: InstanceDto[] = [];

    for (const hub of hubInstances) {
      const providerMatch =
        (hub.providerInstanceId
          ? byProviderId.get(hub.providerInstanceId)
          : undefined) ?? byName.get(hub.instanceName);

      // Só retorna o que existe no provider — evita stubs { hubId, instanceName, status }
      if (!providerMatch) {
        this.logger.warn(
          `[listInstances] órfão no Hub sem match no provider — omitindo. hubId=${hub.id} instanceName=${hub.instanceName} providerInstanceId=${hub.providerInstanceId}`,
        );
        continue;
      }

      list.push({
        ...providerMatch,
        hubId: hub.id,
      } as InstanceDto);
    }

    return list;
  }

  async fetchInstance(
    product: AuthCachePayload,
    instanceId: string,
  ): Promise<InstanceDto> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    const raw = await adapter.fetchInstance(ctx, resolved.instanceName);
    const payload = Array.isArray(raw)
      ? ((raw[0] as InstanceDto | undefined) ?? {})
      : raw;

    return {
      ...payload,
      hubId: resolved.instanceId,
    } as InstanceDto;
  }

  async connectInstance(
    product: AuthCachePayload,
    instanceId: string,
    execution?: QrRequestContext,
  ): Promise<ConnectInstanceDto> {
    execution?.assertActive();
    if (execution) execution.productId = product.productId;
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
      ...(execution ? { execution } : {}),
    };
    if (execution) {
      execution.providerId = resolved.vpsProviderId;
      execution.instanceId = resolved.instanceId;
      execution.assertActive();
    }
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    return adapter.connectInstance(ctx, resolved.instanceName);
  }

  async getConnectionState(
    product: AuthCachePayload,
    instanceId: string,
  ): Promise<ConnectionStateDto> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    return adapter.getConnectionState(ctx, resolved.instanceName);
  }

  async restartInstance(
    product: AuthCachePayload,
    instanceId: string,
  ): Promise<void> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    return adapter.restartInstance(ctx, resolved.instanceName);
  }

  async logoutInstance(
    product: AuthCachePayload,
    instanceId: string,
  ): Promise<void> {
    const resolved = await this.instanceResolver.resolveById(
      product.productId,
      instanceId,
    );
    const ctx: ProviderContext = {
      providerUrl: resolved.providerUrl,
      providerApiKey: resolved.providerApiKey,
    };
    const adapter = this.adapterResolver.resolve(resolved.adapterType);
    await adapter.logoutInstance(ctx, resolved.instanceName);
    await this.cache.del(`instance:${resolved.instanceId}`);
  }

  async deleteInstance(
    product: AuthCachePayload,
    instanceId: string,
  ): Promise<void> {
    const instance = await this.prisma.instance.findFirst({
      where: {
        productId: product.productId,
        OR: [{ id: instanceId }, { providerInstanceId: instanceId }],
      },
      include: { vpsProvider: true, product: true },
    });

    if (!instance) {
      throw new NotFoundException(`Instância "${instanceId}" não encontrada`);
    }

    const ctx: ProviderContext = {
      providerUrl: instance.vpsProvider.providerUrl,
      providerApiKey: decryptAES256GCM(
        instance.vpsProvider.providerApiKey,
        this.encryptionKeyHex,
      ),
    };
    const adapter = this.adapterResolver.resolve(instance.product.adapterType);

    // Provider primeiro: só remove do Hub se o provider confirmar sucesso
    // (ou se a instância já não existir lá — delete idempotente).
    try {
      await adapter.deleteInstance(ctx, instance.instanceName);
    } catch (err) {
      if (isProviderNotFoundError(err)) {
        this.logger.warn(
          `[delete] provider já não possui a instância "${instance.instanceName}" (instanceId=${instance.id}) — removendo registro órfão do Hub`,
        );
      } else {
        const detail = extractErrorDetail(err);
        this.logger.error(
          `[delete] falha no provider — abortando remoção no Hub. instanceId=${instance.id} instanceName=${instance.instanceName} error=${detail}`,
        );
        throw new BadGatewayException(
          `Falha ao deletar a instância "${instance.instanceName}" no provider. O registro no Hub foi mantido para evitar dessincronização. Detalhe: ${detail}`,
        );
      }
    }

    const deleted = await this.prisma.instance.deleteMany({
      where: { id: instance.id, productId: product.productId },
    });

    this.logger.log(
      `[delete] instanceId=${instance.id} productId=${product.productId} rowsDeleted=${deleted.count}`,
    );

    await this.cache.del(`instance:${instance.id}`);
    if (instance.providerInstanceId) {
      await this.cache.del(`instance:${instance.providerInstanceId}`);
    }
  }
}
