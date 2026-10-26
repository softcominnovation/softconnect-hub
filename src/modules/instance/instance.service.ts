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
import type { ProductDefaultProxy } from '@prisma/client';
import { AuthCachePayload } from '../../auth/apikey.guard';
import { decryptAES256GCM } from '../../common/crypto.util';
import { CacheService } from '../../cache/cache.service';
import { invalidateInstanceCache } from '../../cache/instance-cache';
import { PrismaService } from '../../prisma/prisma.service';
import { EvolutionProvisioningService } from '../provisioning/evolution-provisioning.service';
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
import { withInstanceNumber } from './instance-number';
import { withoutRelayToken } from '../webhook/relay-configuration';
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
    private readonly provisioning: EvolutionProvisioningService,
  ) {
    this.encryptionKeyHex = this.config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  async createInstance(
    product: AuthCachePayload,
    dto: CreateInstanceDto,
    execution?: QrRequestContext,
  ): Promise<InstanceCreatedDto & { hubId: string } & Record<string, unknown>> {
    execution ??= new QrRequestContext(
      this.config.get<number>('PROXY_TIMEOUT_MS', 15000),
      this.config.get<number>('PROXY_TIMEOUT_MS', 15000),
    );
    execution.productId = product.productId;
    const prepared = await this.provisioning.prepare(
      product.productId,
      dto,
      execution,
    );
    const { ticket, payload } = prepared;
    execution.createOutcome = {
      result: 'not_sent',
      code: 'before_dispatch',
      observedAt: new Date().toISOString(),
      deadlineAt: new Date(Date.now() + execution.remainingMs).toISOString(),
    };
    try {
      const provider = await this.provisioning.markCreating(ticket, execution);
      execution.providerId = provider.id;
      const ctx = this.provisioning.context(provider, execution);
      const adapter = this.adapterResolver.resolve(provider.adapterType);
      execution.assertActive();
      const result = await adapter.createInstance(ctx, payload.request);
      execution.createOutcome = {
        ...execution.createOutcome,
        result: 'succeeded',
        code: 'remote_success',
        observedAt: new Date().toISOString(),
        ...(result.instanceId ? { remoteId: result.instanceId } : {}),
      };
      await this.provisioning.recordOutcome(ticket, execution.createOutcome);
      // Persist even when the caller disconnected after the remote success.
      const instance = await this.provisioning.recordCreated(ticket, result);
      execution.instanceId = instance.id;
      if (execution.signal.aborted && !payload.webhook)
        await this.provisioning.finish(ticket);
      execution.assertActive();
      const response = {
        ...result,
        hubId: instance.id,
      } as InstanceCreatedDto & { hubId: string } & Record<string, unknown>;
      let defaultProxy: ProductDefaultProxy | null = null;
      try {
        defaultProxy = await this.prisma.productDefaultProxy.findUnique({
          where: { productId: product.productId },
        });
      } catch {
        this.logger.warn(
          'event=instance_default_proxy_unconfirmed reason=config_lookup_failed',
        );
      }
      if (payload.webhook && !adapter.applyInstanceDefaults)
        throw new BadGatewayException(
          'Adapter não suporta configuração obrigatória',
        );
      if (adapter.applyInstanceDefaults && payload.webhook) {
        try {
          execution.assertActive();
          const applied = await adapter.applyInstanceDefaults(
            ctx,
            dto.instanceName,
            {
              webhook: payload.webhook,
            },
            {
              defaultProxyDeadlineAt: performance.now() + execution.remainingMs,
            },
          );
          if (payload.webhook)
            await this.provisioning.markWebhookApplied(ticket);
          if (applied.webhook !== undefined)
            response.webhook = withoutRelayToken(applied.webhook);
          if (applied.proxy !== undefined) response.proxy = applied.proxy;
          if (applied.proxyFailure)
            this.logger.warn(
              JSON.stringify({
                event: 'instance_default_proxy_unconfirmed',
                productId: product.productId,
                providerId: provider.id,
                instanceId: instance.id,
                reason: applied.proxyFailure,
              }),
            );
        } catch (error) {
          this.checkQrInterruption(execution, error);
          if (isProviderTimeoutError(error))
            throw error instanceof HttpException
              ? error
              : new RequestTimeoutException('Request timeout');
          // A functional failure of a required default requires compensation.
          await this.provisioning.markCleanup(ticket);
          try {
            execution.assertActive();
            await adapter.deleteInstance(ctx, dto.instanceName);
          } catch (deleteError) {
            this.checkQrInterruption(execution, deleteError);
            if (isProviderTimeoutError(deleteError))
              throw deleteError instanceof HttpException
                ? deleteError
                : new RequestTimeoutException('Request timeout');
            if (!isProviderNotFoundError(deleteError))
              throw new BadGatewayException(
                'Falha ao reverter configurações padrão; registro mantido para verificação',
              );
          }
          await this.provisioning.removeConfirmed(
            instance.id,
            product.productId,
            provider.id,
            ticket,
          );
          throw new BadRequestException(
            'Falha ao aplicar configurações padrão — operação revertida.',
          );
        }
      }
      if (adapter.applyInstanceDefaults && defaultProxy) {
        try {
          const applied = await adapter.applyInstanceDefaults(
            ctx,
            dto.instanceName,
            {
              proxy: {
                enabled: defaultProxy.enabled,
                host: defaultProxy.host,
                port: defaultProxy.port,
                protocol: defaultProxy.protocol,
                username: defaultProxy.username ?? undefined,
                password: defaultProxy.password ?? undefined,
              },
            },
            {
              defaultProxyDeadlineAt: performance.now() + execution.remainingMs,
            },
          );
          if (applied.proxy !== undefined) response.proxy = applied.proxy;
          if (applied.proxyFailure)
            this.logger.warn(
              JSON.stringify({
                event: 'instance_default_proxy_unconfirmed',
                productId: product.productId,
                providerId: provider.id,
                instanceId: instance.id,
                reason: applied.proxyFailure,
                ...applied.proxyDiagnostics,
              }),
            );
        } catch {
          // Required work is complete; a cancelled optional proxy must not keep
          // a creation uncertain or cause a background proxy attempt.
          await this.provisioning.finish(ticket);
          execution.assertActive();
          this.logger.warn(
            'event=instance_default_proxy_unconfirmed reason=transport_error',
          );
          return response;
        }
      }
      await this.provisioning.finish(ticket);
      execution.assertActive();
      return response;
    } catch (error) {
      try {
        await this.provisioning.recordOutcome(ticket, execution.createOutcome);
      } catch {
        this.logger.error(
          `event=instance_create_evidence_failed provisioningId=${ticket.id}`,
        );
      }
      this.logger.error(
        JSON.stringify({
          event: 'instance_create_failed',
          provisioningId: ticket.id,
          productId: ticket.productId,
          providerId: ticket.vpsProviderId,
          stage:
            execution.createOutcome.result === 'succeeded'
              ? 'finalization'
              : 'create',
          result: execution.createOutcome.result,
          code: execution.createOutcome.code,
          upstreamStatusCode: execution.createOutcome.status,
          source: execution.reason ?? execution.failureSource,
        }),
      );
      throw error;
    } finally {
      // Terminal states are untouched; uncertain work stays on the same host.
      try {
        await this.provisioning.abandon(ticket);
      } catch {
        this.logger.error(
          `event=instance_create_release_failed provisioningId=${ticket.id}`,
        );
      }
    }
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
    const current = await this.prisma.product.findUnique({
      where: { id: product.productId },
    });
    if (!current) throw new NotFoundException('Produto não encontrado');
    const nameFilter = instanceNameFilter?.trim() || undefined;
    const hubInstances = await this.prisma.instance.findMany({
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
    });
    const ids = new Set(hubInstances.map((item) => item.vpsProviderId));
    if (!nameFilter && current.vpsProviderId) ids.add(current.vpsProviderId);
    if (!ids.size) {
      if (!current.vpsProviderId)
        throw new BadRequestException('Produto sem VpsProvider associado');
      if (nameFilter) return [];
      ids.add(current.vpsProviderId);
    }
    const providerIds = [...ids];
    const results = new Map<
      string,
      { rows: InstanceDto[]; adapterType: string }
    >();
    const timeout = this.config.get<number>('PROXY_TIMEOUT_MS', 15000);
    const execution = new QrRequestContext(timeout, timeout, 0);
    const timer = setTimeout(() => execution.abort('request_timeout'), timeout);
    let cursor = 0;
    let failure: unknown;
    try {
      await Promise.all(
        Array.from({ length: Math.min(3, providerIds.length) }, async () => {
          while (!failure && cursor < providerIds.length) {
            const id = providerIds[cursor++];
            try {
              execution.assertActive();
              const provider = await this.prisma.vpsProvider.findUnique({
                where: { id },
              });
              if (!provider)
                throw new NotFoundException(
                  'VpsProvider nao encontrado ou inativo',
                );
              const rows = await this.adapterResolver
                .resolve(provider.adapterType)
                .fetchInstances({
                  providerUrl: provider.providerUrl,
                  providerApiKey: decryptAES256GCM(
                    provider.providerApiKey,
                    this.encryptionKeyHex,
                  ),
                  execution,
                  strictInventory: true,
                });
              execution.assertActive();
              results.set(id, { rows, adapterType: provider.adapterType });
            } catch (error) {
              if (!failure) failure = error;
              execution.abort('request_timeout');
            }
          }
        }),
      );
      if (failure) {
        if (
          failure instanceof HttpException &&
          (providerIds.length === 1 || [408, 504].includes(failure.getStatus()))
        )
          throw failure;
        throw new BadGatewayException(
          'Falha ao consultar instâncias nos providers',
        );
      }
      const list: InstanceDto[] = [];
      for (const hub of hubInstances) {
        const result = results.get(hub.vpsProviderId)!;
        const matches = result.rows.filter(
          (row) =>
            (hub.providerInstanceId &&
              (row.id ?? row.instanceId) === hub.providerInstanceId) ||
            row.instanceName === hub.instanceName,
        );
        if (matches.length > 1)
          throw new ConflictException(
            'Identidade de instância ambígua no provider',
          );
        const match = matches[0];
        if (!match) continue;
        const remoteId = match.id ?? match.instanceId;
        if (
          match.instanceName !== hub.instanceName ||
          (hub.providerInstanceId &&
            remoteId &&
            remoteId !== hub.providerInstanceId)
        ) {
          throw new ConflictException(
            'Identidade de instância divergente no provider',
          );
        }
        list.push({
          ...withInstanceNumber(withoutRelayToken(match), result.adapterType),
          hubId: hub.id,
        } as InstanceDto);
      }
      return list;
    } finally {
      clearTimeout(timer);
    }
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
    const payload: Record<string, unknown> = Array.isArray(raw)
      ? ((raw[0] as InstanceDto | undefined) ?? {})
      : raw;

    const remoteId = payload.id ?? payload.instanceId;
    if (
      (payload.instanceName &&
        payload.instanceName !== resolved.instanceName) ||
      (resolved.providerInstanceId &&
        remoteId &&
        remoteId !== resolved.providerInstanceId)
    ) {
      throw new ConflictException(
        'Identidade de instância divergente no provider',
      );
    }
    return {
      ...withInstanceNumber(withoutRelayToken(payload), resolved.adapterType),
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
    await invalidateInstanceCache(this.cache, {
      ...resolved,
      id: resolved.instanceId,
    });
  }

  async deleteInstance(
    product: AuthCachePayload,
    instanceId: string,
  ): Promise<void> {
    const instances = await this.prisma.instance.findMany({
      where: {
        productId: product.productId,
        OR: [{ id: instanceId }, { providerInstanceId: instanceId }],
      },
      include: { vpsProvider: true, product: true },
      take: 2,
    });

    if (instances.length > 1)
      throw new ConflictException('Identificador de instância ambíguo');
    const instance = instances[0];
    if (!instance) {
      throw new NotFoundException(`Instância "${instanceId}" não encontrada`);
    }

    await this.provisioning.assertDeletable(instance.id);
    const ctx: ProviderContext = {
      providerUrl: instance.vpsProvider.providerUrl,
      providerApiKey: decryptAES256GCM(
        instance.vpsProvider.providerApiKey,
        this.encryptionKeyHex,
      ),
    };
    const adapter = this.adapterResolver.resolve(
      instance.vpsProvider.adapterType,
    );

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

    await this.provisioning.removeConfirmed(
      instance.id,
      product.productId,
      instance.vpsProviderId,
    );
    this.logger.log(
      `[delete] instanceId=${instance.id} productId=${product.productId} rowsDeleted=1`,
    );
  }
}
