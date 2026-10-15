import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PendingRelayEvent, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptAES256GCM, encryptAES256GCM } from '../../common/crypto.util';
import { relaySourceIp, RelayRequestOrigin } from '../../common/relay-origin';
import { OPEN_PROVISIONING_STATES } from '../provisioning/evolution-locks';
import type { RelayJobPayload } from './relay.worker';
import { RELAY_QUEUE } from './queue.constants';

interface OriginEvidence {
  providerIds: string[];
  method: 'token' | 'peer_ip' | 'legacy_job';
  provisioningId?: string;
}

@Injectable()
export class RelayIngressService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RelayIngressService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private cursor?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(RELAY_QUEUE) private readonly queue: Queue,
  ) {}

  private get key() {
    return this.config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  onModuleInit() {
    if (this.config.get('RUNTIME_MODE', 'api') !== 'api') return;
    this.timer = setInterval(() => {
      if (!this.running)
        this.running = this.recoverPending()
          .catch(() => this.logger.warn('event=relay_recovery_failed'))
          .finally(() => {
            this.running = undefined;
          });
    }, 15000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }

  async receiveAuthenticated(
    providerId: string,
    token: unknown,
    body: Record<string, unknown>,
  ) {
    const provider = await this.prisma.vpsProvider.findUnique({
      where: { id: providerId },
    });
    let valid = false;
    if (
      provider?.adapterType === 'evolution' &&
      provider.callbackTokenEncrypted &&
      typeof token === 'string'
    ) {
      try {
        const expected = decryptAES256GCM(
          provider.callbackTokenEncrypted,
          this.key,
        );
        const digest = (value: string) =>
          createHash('sha256').update(value).digest();
        valid = timingSafeEqual(digest(token), digest(expected));
      } catch {
        /* Invalid or unreadable credentials fail closed. */
      }
    }
    if (!valid)
      throw new ForbiddenException('Origem do webhook não autorizada');
    await this.prisma.vpsProvider.updateMany({
      where: { id: providerId, callbackReadiness: { not: 'ready' } },
      data: { callbackReadiness: 'ready' },
    });
    await this.accept('evolution', body, {
      providerIds: [providerId],
      method: 'token',
    });
  }

  async receiveLegacy(
    adapterType: string,
    body: Record<string, unknown>,
    request: RelayRequestOrigin,
  ) {
    const ip = relaySourceIp(
      request,
      this.config.get<string>('RELAY_TRUSTED_PROXY_IPS', ''),
    );
    const providers = ip
      ? await this.prisma.vpsProvider.findMany({
          where: { adapterType, vps: { ip, isActive: true } },
          select: { id: true },
        })
      : [];
    if (!providers.length) throw new ForbiddenException('IP não autorizado');
    await this.accept(adapterType, body, {
      providerIds: providers.map((p) => p.id),
      method: 'peer_ip',
    });
  }

  private identity(body: Record<string, unknown>) {
    const nested =
      body.instance &&
      typeof body.instance === 'object' &&
      !Array.isArray(body.instance)
        ? (body.instance as Record<string, unknown>)
        : undefined;
    const name =
      typeof body.instance === 'string'
        ? body.instance
        : (body.instanceName ?? nested?.instanceName);
    const id = body.instanceId ?? nested?.instanceId;
    return {
      name: typeof name === 'string' && name ? name : undefined,
      id: typeof id === 'string' && id ? id : undefined,
    };
  }

  private async accept(
    adapterType: string,
    body: Record<string, unknown>,
    evidence: OriginEvidence,
  ) {
    const identity = this.identity(body ?? {});
    const selector = [
      ...(identity.name ? [{ instanceName: identity.name }] : []),
      ...(identity.id ? [{ providerInstanceId: identity.id }] : []),
    ];
    const instances = selector.length
      ? await this.prisma.instance.findMany({
          where: {
            vpsProviderId: { in: evidence.providerIds },
            OR: selector,
            isActive: true,
          },
        })
      : [];
    const intentions = selector.length
      ? await this.prisma.instanceProvisioning.findMany({
          where: {
            vpsProviderId: { in: evidence.providerIds },
            OR: selector,
            state: { in: OPEN_PROVISIONING_STATES },
          },
        })
      : [];
    const instance =
      instances.length === 1 &&
      (!identity.name || instances[0].instanceName === identity.name) &&
      (!identity.id || instances[0].providerInstanceId === identity.id) &&
      intentions.every((intent) => intent.instanceId === instances[0].id)
        ? instances[0]
        : undefined;
    const intention =
      !instances.length &&
      intentions.length === 1 &&
      (!identity.name || intentions[0].instanceName === identity.name) &&
      (!identity.id ||
        !intentions[0].providerInstanceId ||
        intentions[0].providerInstanceId === identity.id)
        ? intentions[0]
        : undefined;
    const payload: RelayJobPayload = {
      version: 2,
      adapterType,
      instanceName:
        identity.name ??
        instance?.instanceName ??
        intention?.instanceName ??
        '',
      body,
      ...(instance
        ? {
            providerId: instance.vpsProviderId,
            instanceId: instance.id,
            productId: instance.productId,
            providerInstanceId: instance.providerInstanceId,
          }
        : {}),
    };
    const event = await this.prisma.pendingRelayEvent.create({
      data: {
        vpsProviderId:
          instance?.vpsProviderId ??
          intention?.vpsProviderId ??
          (evidence.providerIds.length === 1 ? evidence.providerIds[0] : null),
        instanceId: instance?.id,
        instanceName: identity.name,
        providerInstanceId: identity.id,
        encryptedPayload: encryptAES256GCM(JSON.stringify(payload), this.key),
        originEvidence: {
          ...evidence,
          ...(intention ? { provisioningId: intention.id } : {}),
        } as unknown as Prisma.InputJsonValue,
        state: instance ? 'pending' : intention ? 'waiting' : 'retained',
        errorCode: instance
          ? null
          : intention
            ? 'awaiting_instance'
            : 'identity_unproven',
      },
    });
    // Persist first so a failed queue publication can be recovered.
    if (instance)
      await this.publish(event).catch(() =>
        this.logger.warn('event=relay_publish_pending'),
      );
  }

  async retainLegacyJob(payload: RelayJobPayload, jobId: string) {
    const id = `legacy-${createHash('sha256').update(jobId).digest('hex')}`;
    await this.prisma.pendingRelayEvent.upsert({
      where: { id },
      update: {},
      create: {
        id,
        instanceName: payload.instanceName,
        encryptedPayload: encryptAES256GCM(JSON.stringify(payload), this.key),
        originEvidence: { method: 'legacy_job' },
        state: 'retained',
        errorCode: 'legacy_origin_unproven',
      },
    });
  }

  async validateJob(payload: RelayJobPayload) {
    if (
      payload.version !== 2 ||
      !payload.providerId ||
      !payload.instanceId ||
      !payload.productId
    )
      return null;
    const instance = await this.prisma.instance.findFirst({
      where: {
        id: payload.instanceId,
        productId: payload.productId,
        vpsProviderId: payload.providerId,
        instanceName: payload.instanceName,
        isActive: true,
        ...(payload.providerInstanceId
          ? { providerInstanceId: payload.providerInstanceId }
          : {}),
      },
      include: { product: true, vpsProvider: true, evolutionLink: true },
    });
    if (
      !instance ||
      !instance.evolutionLink ||
      instance.vpsProvider.adapterType !== payload.adapterType
    )
      return null;
    return instance;
  }

  async markEvent(
    id: string | undefined,
    state: string,
    errorCode: string | null = null,
  ) {
    if (id)
      await this.prisma.pendingRelayEvent.updateMany({
        where: { id, state: { not: 'delivered' } },
        data: {
          state,
          errorCode,
          ...(['delivered', 'retained'].includes(state)
            ? { resolvedAt: new Date() }
            : {}),
        },
      });
  }

  private async publish(event: PendingRelayEvent) {
    const payload = JSON.parse(
      decryptAES256GCM(event.encryptedPayload, this.key),
    ) as RelayJobPayload;
    if (!(await this.validateJob(payload))) {
      await this.markEvent(event.id, 'retained', 'identity_changed');
      return;
    }
    await this.queue.add(
      'relay',
      { ...payload, pendingEventId: event.id },
      {
        jobId: event.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    );
    await this.prisma.pendingRelayEvent.updateMany({
      where: { id: event.id, state: 'pending' },
      data: { state: 'queued', errorCode: null },
    });
  }

  async recoverPending(): Promise<void> {
    const rows = await this.prisma.pendingRelayEvent.findMany({
      where: {
        state: { in: ['pending', 'waiting'] },
        ...(this.cursor ? { id: { gt: this.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 50,
    });
    this.cursor = rows.at(-1)?.id;
    for (let event of rows) {
      try {
        if (event.state === 'waiting') {
          const evidence = event.originEvidence as unknown as OriginEvidence;
          if (!evidence.provisioningId || !event.vpsProviderId) continue;
          const intention = await this.prisma.instanceProvisioning.findUnique({
            where: { id: evidence.provisioningId },
          });
          if (
            !intention ||
            (!OPEN_PROVISIONING_STATES.includes(intention.state) &&
              intention.state !== 'committed')
          ) {
            await this.markEvent(event.id, 'retained', 'provisioning_ended');
            continue;
          }
          if (
            !intention?.instanceId ||
            !['creating', 'uncertain', 'committed'].includes(intention.state)
          )
            continue;
          if (
            intention.vpsProviderId !== event.vpsProviderId ||
            (event.providerInstanceId &&
              intention.providerInstanceId !== event.providerInstanceId)
          ) {
            await this.markEvent(event.id, 'retained', 'identity_changed');
            continue;
          }
          const original = JSON.parse(
            decryptAES256GCM(event.encryptedPayload, this.key),
          ) as RelayJobPayload;
          const payload: RelayJobPayload = {
            ...original,
            version: 2,
            providerId: intention.vpsProviderId,
            instanceId: intention.instanceId,
            productId: intention.productId,
            providerInstanceId: intention.providerInstanceId,
            instanceName: intention.instanceName,
          };
          await this.prisma.pendingRelayEvent.updateMany({
            where: { id: event.id, state: 'waiting' },
            data: {
              state: 'pending',
              instanceId: intention.instanceId,
              encryptedPayload: encryptAES256GCM(
                JSON.stringify(payload),
                this.key,
              ),
              errorCode: null,
            },
          });
          event = await this.prisma.pendingRelayEvent.findUniqueOrThrow({
            where: { id: event.id },
          });
          if (event.state !== 'pending') continue;
        }
        await this.publish(event);
      } catch {
        this.logger.warn('event=relay_recovery_pending');
      }
    }
  }
}
