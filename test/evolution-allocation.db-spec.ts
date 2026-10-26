import { InstanceService } from '../src/modules/instance/instance.service';
import { InstanceResolverService } from '../src/resolver/instance.resolver';
import { AuthCachePayload } from '../src/auth/apikey.guard';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, VpsProvider, Product, Prisma } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { CacheService } from '../src/cache/cache.service';
import { encryptAES256GCM } from '../src/common/crypto.util';
import { QrRequestContext } from '../src/common/qr-request-context';
import { EvolutionInventoryService } from '../src/modules/provisioning/evolution-inventory.service';
import { EvolutionProvisioningService } from '../src/modules/provisioning/evolution-provisioning.service';
import { EvolutionRecoveryService } from '../src/modules/provisioning/evolution-recovery.service';
import { ProvisioningResolutionService } from '../src/modules/provisioning/provisioning-resolution.service';
import { CreateOutcome } from '../src/common/create-outcome';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { InstanceController } from '../src/modules/instance/instance.controller';
import { ApiKeyGuard } from '../src/auth/apikey.guard';
import { RateLimitGuard } from '../src/auth/rate-limit.guard';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TimeoutInterceptor } from '../src/common/interceptors/timeout.interceptor';
import { EvolutionAdapter } from '../src/adapters/evolution/evolution.adapter';
import { EvolutionHttpService } from '../src/adapters/evolution/evolution.http';
import { EvolutionMediaService } from '../src/adapters/evolution/evolution.media';
import { AppConfig } from '../src/config/config.schema';
import { VpsProviderService } from '../src/modules/admin/vps/vps-provider.service';
import { createLinkedInstance } from '../src/prisma/evolution-links';
import { PrismaService } from '../src/prisma/prisma.service';
import { AdapterResolverService } from '../src/providers/adapter-resolver.service';
import {
  InstanceDto,
  ProviderContext,
} from '../src/providers/whatsapp-provider.interface';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL required');
const address = new URL(url);
if (
  !['localhost', '127.0.0.1'].includes(address.hostname) ||
  !/^\/softconnect_phase02_test_[a-z0-9_]+$/.test(address.pathname) ||
  (address.searchParams.get('schema') ?? 'public') !== 'public'
)
  throw new Error(
    'Only an empty, dedicated local phase02 test database is allowed',
  );
const prisma = new PrismaClient({ datasources: { db: { url } } });
const replica = new PrismaClient({ datasources: { db: { url } } });
const db = prisma as PrismaService;
const key = 'a'.repeat(64);
const config = new ConfigService({
  ENCRYPTION_KEY: key,
  EVOLUTION_ALLOCATION_ENABLED: true,
});
const cache = {
  del: jest.fn().mockResolvedValue(undefined),
} as unknown as CacheService;
let remote: Map<string, InstanceDto[]>;
const adapter = {
  fetchInstances: jest.fn((ctx: ProviderContext) =>
    Promise.resolve(remote.get(ctx.providerUrl) ?? []),
  ),
  createInstance: jest.fn(),
  deleteInstance: jest.fn(),
  applyInstanceDefaults: jest.fn().mockResolvedValue({ webhook: {} }),
};
const adapters = {
  resolve: () => adapter,
} as unknown as AdapterResolverService;
function services(client = db) {
  const inventory = new EvolutionInventoryService(client, adapters, config);
  const provisioning = new EvolutionProvisioningService(
    client,
    inventory,
    adapters,
    config,
    cache,
  );
  const recovery = new EvolutionRecoveryService(
    client,
    provisioning,
    inventory,
    adapters,
    config,
  );
  return { inventory, provisioning, recovery };
}
const a = services();
const b = services(replica as PrismaService);
const budget = () => new QrRequestContext(60000, 50000);
let sequence = 0;
let vpsId: string;
async function provider(maxInstances: number | null = null) {
  const name = `evo-${++sequence}`;
  return prisma.vpsProvider.create({
    data: {
      vpsId,
      label: name,
      providerUrl: `https://${name}.invalid`,
      canonicalEndpoint: `https://${name}.invalid`,
      identityStatus: 'verified',
      providerApiKey: encryptAES256GCM('fixture-key', key),
      maxInstances,
      isHealthy: true,
      lastHealthAt: new Date(),
      inventoryStatus: 'ready',
      inventoryObservedAt: new Date(),
      callbackReadiness: 'ready',
    },
  });
}
async function product(
  hosts: VpsProvider[],
  capacity = false,
  noDefault = false,
) {
  const name = `product-${++sequence}`;
  return prisma.$transaction(async (tx) => {
    const p = await tx.product.create({
      data: {
        name,
        slug: name,
        apiKeyHash: name,
        origins: [],
        vpsProviderId: null,
        allocationMode: capacity ? 'capacity' : 'legacy',
      },
    });
    for (const [priority, host] of hosts.entries())
      await tx.productEvolution.create({
        data: {
          productId: p.id,
          vpsProviderId: host.id,
          acceptingNewInstances: true,
          allocationPriority: priority,
        },
      });
    return tx.product.update({
      where: { id: p.id },
      data: { vpsProviderId: noDefault ? null : hosts[0].id },
    });
  });
}
async function local(
  p: Product,
  host: VpsProvider,
  name: string = randomUUID(),
) {
  return createLinkedInstance(db, {
    productId: p.id,
    vpsProviderId: host.id,
    instanceName: name,
    hubToken: randomUUID(),
    providerInstanceId: `remote-${name}`,
    isActive: false,
  });
}
const reserve = (p: Product, name: string = randomUUID(), service = a) =>
  service.provisioning.prepare(
    p.id,
    { instanceName: name, qrcode: true },
    budget(),
  );
async function expire(id: string) {
  await prisma.instanceProvisioning.update({
    where: { id },
    data: { leaseExpiresAt: new Date(0) },
  });
}
function cli(args: string[]) {
  execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', ...args],
    {
      cwd: `${__dirname}/..`,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    },
  );
}

describe('Phase02 — PostgreSQL admission and recovery', () => {
  it.each([false, true])(
    'HTTP create through real adapter and PostgreSQL: 400 then corrected 201 (capacity=%s)',
    async (capacity) => {
      let rejected = true;
      let posts = 0;
      const upstream = createServer((req, res) => {
        req.resume();
        res.setHeader('content-type', 'application/json');
        if (req.url === '/instance/fetchInstances') {
          res.end('[]');
          return;
        }
        posts++;
        res.statusCode = rejected ? 400 : 201;
        res.end(
          JSON.stringify(
            rejected
              ? {
                  status: 400,
                  error: 'Bad Request',
                  response: { message: ['Invalid integration'] },
                }
              : {
                  instance: {
                    instanceName: 'http-diagnostic',
                    instanceId: randomUUID(),
                    status: 'close',
                  },
                },
          ),
        );
      });
      await new Promise<void>((resolve) =>
        upstream.listen(0, '127.0.0.1', resolve),
      );
      let app: NestFastifyApplication | undefined;
      try {
        const host = await provider();
        const providerUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
        await prisma.vpsProvider.update({
          where: { id: host.id },
          data: { providerUrl, canonicalEndpoint: providerUrl },
        });
        const p = await product([host], capacity);
        const http = new EvolutionHttpService(
          config as unknown as ConfigService<AppConfig, true>,
        );
        const evo = new EvolutionAdapter(http, {} as EvolutionMediaService);
        const router = {
          resolve: () => evo,
        } as unknown as AdapterResolverService;
        const inventory = new EvolutionInventoryService(db, router, config);
        const provisioning = new EvolutionProvisioningService(
          db,
          inventory,
          router,
          config,
          cache,
        );
        const service = new InstanceService(
          db,
          cache,
          router,
          {} as InstanceResolverService,
          config,
          provisioning,
        );
        const module = await Test.createTestingModule({
          controllers: [InstanceController],
          providers: [{ provide: InstanceService, useValue: service }],
        })
          .overrideGuard(ApiKeyGuard)
          .useValue({
            canActivate(ctx: ExecutionContext) {
              ctx
                .switchToHttp()
                .getRequest<{ product: AuthCachePayload }>().product = {
                productId: p.id,
              } as AuthCachePayload;
              return true;
            },
          })
          .overrideGuard(RateLimitGuard)
          .useValue({ canActivate: () => true })
          .compile();
        app = module.createNestApplication<NestFastifyApplication>(
          new FastifyAdapter(),
          { logger: false },
        );
        app.useGlobalFilters(new HttpExceptionFilter());
        app.useGlobalInterceptors(
          new TimeoutInterceptor(config, new Reflector()),
        );
        await app.init();
        await app.getHttpAdapter().getInstance().ready();
        const body = {
          instanceName: 'http-diagnostic',
          integration: 'INVALID',
          qrcode: false,
          token: 'shared-client-token',
        };
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/instance/create',
              payload: body,
            })
          ).statusCode,
        ).toBe(400);
        expect(
          await prisma.instance.count({ where: { productId: p.id } }),
        ).toBe(0);
        expect(
          await prisma.instanceProvisioning.findFirst({
            where: { productId: p.id },
          }),
        ).toMatchObject({ state: 'failed', errorCode: 'invalid_integration' });
        rejected = false;
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/instance/create',
              payload: { ...body, integration: 'WHATSAPP-BAILEYS' },
            })
          ).statusCode,
        ).toBe(201);
        expect(posts).toBe(2);
        expect(
          await prisma.instance.count({ where: { productId: p.id } }),
        ).toBe(1);
        expect(
          await prisma.instanceProvisioning.count({
            where: { productId: p.id, state: 'committed' },
          }),
        ).toBe(1);
        expect(
          await prisma.instanceProvisioning.count({
            where: {
              productId: p.id,
              state: {
                in: ['reserved', 'creating', 'uncertain', 'cleanup_pending'],
              },
            },
          }),
        ).toBe(0);
      } finally {
        if (app) await app.close();
        upstream.closeAllConnections();
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
      }
    },
  );
  const resolution = () =>
    new ProvisioningResolutionService(
      db,
      a.provisioning,
      a.recovery,
      adapters,
      config,
    );
  const evidence = (
    result: CreateOutcome['result'],
    code: CreateOutcome['code'],
  ): CreateOutcome => ({
    result,
    code,
    observedAt: new Date().toISOString(),
    deadlineAt: new Date(0).toISOString(),
  });
  async function historical() {
    const host = await provider();
    const p = await product([host]);
    const pending = await reserve(p);
    await a.provisioning.markCreating(pending.ticket, budget());
    await prisma.instanceProvisioning.update({
      where: { id: pending.ticket.id },
      data: {
        outcomeEvidence: Prisma.DbNull,
        state: 'uncertain',
        leaseOwner: null,
        leaseExpiresAt: new Date(0),
      },
    });
    return {
      host,
      p,
      row: await prisma.instanceProvisioning.findUniqueOrThrow({
        where: { id: pending.ticket.id },
      }),
    };
  }
  const releaseInput = (revision: number) => ({
    expectedRevision: revision,
    action: 'release_absent' as const,
    reason: 'isolated test',
    acknowledgeUncertainOutcome: true,
    confirmExecutorsDrained: true,
  });

  it.each(['not_sent', 'rejected'] as const)(
    'finalizes persisted %s evidence after restart and frees the reservation',
    async (result) => {
      const host = await provider(1);
      const p = await product([host]);
      const pending = await reserve(p);
      await a.provisioning.markCreating(pending.ticket, budget());
      await a.provisioning.recordOutcome(
        pending.ticket,
        evidence(
          result,
          result === 'not_sent' ? 'before_dispatch' : 'invalid_integration',
        ),
      );
      await expire(pending.ticket.id);
      await b.recovery.recover(pending.ticket.id);
      const row = await prisma.instanceProvisioning.findUniqueOrThrow({
        where: { id: pending.ticket.id },
      });
      expect(row.state).toBe(result === 'not_sent' ? 'released' : 'failed');
      expect(row.encryptedRequest).toBeNull();
      await expect(reserve(p, row.instanceName)).resolves.toBeDefined();
    },
  );

  it('recovers persisted success with client token and known remote ID after losing local persistence', async () => {
    const host = await provider();
    const p = await product([host]);
    const pending = await a.provisioning.prepare(
      p.id,
      { instanceName: 'known-client-token', token: 'shared' },
      budget(),
    );
    await a.provisioning.markCreating(pending.ticket, budget());
    await a.provisioning.recordOutcome(pending.ticket, {
      ...evidence('succeeded', 'remote_success'),
      remoteId: 'success-known',
    });
    remote.set(host.providerUrl, [
      {
        instanceName: 'known-client-token',
        id: 'success-known',
        status: 'close',
        token: 'shared',
      } as InstanceDto,
    ]);
    await expire(pending.ticket.id);
    await b.recovery.recover(pending.ticket.id);
    expect(
      await prisma.instanceProvisioning.findUniqueOrThrow({
        where: { id: pending.ticket.id },
      }),
    ).toMatchObject({
      state: 'committed',
      providerInstanceId: 'success-known',
    });
    expect(adapter.createInstance).not.toHaveBeenCalled();
  });

  it('does not lose a cleanup cause during abandon', async () => {
    const host = await provider();
    const p = await product([host]);
    const pending = await reserve(p);
    await a.provisioning.markCreating(pending.ticket, budget());
    await a.provisioning.markCleanup(pending.ticket);
    await a.provisioning.abandon(pending.ticket);
    expect(
      await prisma.instanceProvisioning.findUniqueOrThrow({
        where: { id: pending.ticket.id },
      }),
    ).toMatchObject({
      state: 'cleanup_pending',
      errorCode: 'required_defaults_failed',
    });
  });

  it('releases only the claimed absent historical attempt, preserving audit and permitting a new reservation', async () => {
    const { host, p, row } = await historical();
    const service = resolution();
    const result = await service.resolve(
      host.id,
      row.id,
      releaseInput(row.revision),
      'fixture-admin',
    );
    expect(result.state).toBe('released');
    expect(result.evidence.resolution).toMatchObject({
      actor: 'fixture-admin',
      acknowledged: true,
      executorsDrained: true,
    });
    expect(
      await prisma.instanceProvisioning.count({ where: { id: row.id } }),
    ).toBe(1);
    await expect(
      service.resolve(
        host.id,
        row.id,
        releaseInput(row.revision),
        'fixture-admin',
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(reserve(p, row.instanceName)).resolves.toBeDefined();
    expect(adapter.deleteInstance).not.toHaveBeenCalled();
  });

  it('permits only one of two administrative releases of the same revision', async () => {
    const { host, row } = await historical();
    const results = await Promise.allSettled([
      resolution().resolve(
        host.id,
        row.id,
        releaseInput(row.revision),
        'admin-a',
      ),
      new ProvisioningResolutionService(
        replica as PrismaService,
        b.provisioning,
        b.recovery,
        adapters,
        config,
      ).resolve(host.id, row.id, releaseInput(row.revision), 'admin-b'),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(
      (
        await prisma.instanceProvisioning.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).state,
    ).toBe('released');
  });

  it.each([
    'active',
    'deadline',
    'drain',
    'local',
    'remote',
    'revision',
    'occupancy',
    'query',
    'provider',
  ] as const)(
    'refuses unsafe administrative release: %s',
    async (condition) => {
      const { host, p, row } = await historical();
      const input = releaseInput(row.revision);
      if (condition === 'active')
        await prisma.instanceProvisioning.update({
          where: { id: row.id },
          data: {
            leaseOwner: 'active',
            leaseExpiresAt: new Date(Date.now() + 60000),
          },
        });
      if (condition === 'deadline')
        await prisma.instanceProvisioning.update({
          where: { id: row.id },
          data: {
            outcomeEvidence: {
              version: 1,
              create: {
                ...evidence('unknown', 'dispatch_started'),
                deadlineAt: new Date(Date.now() + 60000).toISOString(),
              },
            },
          },
        });
      if (condition === 'drain') input.confirmExecutorsDrained = false;
      if (condition === 'local')
        await prisma.instance.create({
          data: {
            productId: p.id,
            vpsProviderId: host.id,
            instanceName: row.instanceName,
            hubToken: randomUUID(),
            providerInstanceId: 'local-conflict',
          },
        });
      if (condition === 'remote')
        remote.set(host.providerUrl, [
          {
            instanceName: row.instanceName,
            id: 'remote-present',
            status: 'close',
          },
        ]);
      if (condition === 'revision') input.expectedRevision--;
      if (condition === 'occupancy')
        adapter.fetchInstances.mockImplementationOnce(async () => {
          await prisma.vpsProvider.update({
            where: { id: host.id },
            data: { occupancyRevision: { increment: 1 } },
          });
          return [];
        });
      if (condition === 'query')
        adapter.fetchInstances.mockRejectedValueOnce(new Error('unavailable'));
      await expect(
        resolution().resolve(
          condition === 'provider' ? randomUUID() : host.id,
          row.id,
          input,
          'fixture-admin',
        ),
      ).rejects.toBeDefined();
      expect(
        (
          await prisma.instanceProvisioning.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).state,
      ).toBe('uncertain');
      expect(adapter.deleteInstance).not.toHaveBeenCalled();
    },
  );

  it('reconciliation records the actor but keeps a genuinely unknown result unresolved', async () => {
    const { host, row } = await historical();
    const result = await resolution().resolve(
      host.id,
      row.id,
      {
        expectedRevision: row.revision,
        action: 'reconcile',
        reason: 'inspect',
      },
      'fixture-admin',
    );
    expect(result.state).toBe('uncertain');
    expect(result.evidence.recovery?.code).toBe(
      'remote_absent_outcome_unknown',
    );
    expect(result.evidence.resolution?.actor).toBe('fixture-admin');
  });
  beforeAll(async () => {
    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`;
    if (count !== 0n)
      throw new Error('Database must be empty; no reset allowed');
    cli(['migrate', 'deploy']);
    cli([
      'db',
      'execute',
      '--schema=prisma/schema.prisma',
      '--file=prisma/operations/evolution-base-constraints.sql',
    ]);
    vpsId = (
      await prisma.vpsServer.create({
        data: {
          label: 'phase02',
          subdomain: 'phase02.invalid',
          ip: '127.0.0.1',
        },
      })
    ).id;
  });
  beforeEach(() => {
    remote = new Map();
    adapter.fetchInstances
      .mockReset()
      .mockImplementation((ctx) =>
        Promise.resolve(remote.get(ctx.providerUrl) ?? []),
      );
    adapter.deleteInstance.mockReset().mockResolvedValue(undefined);
    adapter.createInstance.mockReset();
    adapter.applyInstanceDefaults
      .mockReset()
      .mockResolvedValue({ webhook: {} });
    config.set('EVOLUTION_ALLOCATION_ENABLED', true);
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await replica.$disconnect();
  });

  it('legacy ignores new readiness/flag requirements and shares an unlimited host', async () => {
    const host = await provider();
    await prisma.vpsProvider.update({
      where: { id: host.id },
      data: {
        identityStatus: 'pending',
        isHealthy: false,
        lastHealthAt: null,
        inventoryStatus: 'unknown',
      },
    });
    config.set('EVOLUTION_ALLOCATION_ENABLED', false);
    const p = await product([host]);
    const q = await product([host]);
    expect((await reserve(p)).ticket.vpsProviderId).toBe(host.id);
    expect((await reserve(q)).ticket.vpsProviderId).toBe(host.id);
  });

  it('serializes two replicas/products competing for the last global slot', async () => {
    const host = await provider(2);
    const p = await product([host]);
    const q = await product([host]);
    await local(p, host);
    const results = await Promise.allSettled([
      reserve(p, 'racer-a', a),
      reserve(q, 'racer-b', b),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { status: 503 },
    });
    expect((await a.inventory.readOccupancy(db, host.id)).effective).toBe(2);
  });

  it('rolls over only capacity, including a product with no default, and leaves sessions in place', async () => {
    const first = await provider(1);
    const second = await provider();
    const p = await product([first, second], true, true);
    const q = await product([first]);
    const old = await local(q, first);
    expect((await reserve(p)).provider.id).toBe(second.id);
    await expect(reserve(q)).rejects.toMatchObject({ status: 503 });
    expect(
      (await prisma.instance.findUniqueOrThrow({ where: { id: old.id } }))
        .vpsProviderId,
    ).toBe(first.id);
  });

  it('requires the feature flag only for capacity and accepts null limits', async () => {
    const host = await provider();
    const p = await product([host], true);
    config.set('EVOLUTION_ALLOCATION_ENABLED', false);
    await expect(reserve(p)).rejects.toMatchObject({ status: 503 });
    config.set('EVOLUTION_ALLOCATION_ENABLED', true);
    expect((await reserve(p)).provider.id).toBe(host.id);
  });

  it('uses per-product priorities and explicit global/link pauses', async () => {
    const first = await provider();
    const second = await provider();
    const p = await product([first, second], true);
    const q = await product([second, first], true);
    expect((await reserve(p)).provider.id).toBe(first.id);
    expect((await reserve(q)).provider.id).toBe(second.id);
    await prisma.vpsProvider.update({
      where: { id: first.id },
      data: { acceptingNewInstances: false },
    });
    expect((await reserve(p)).provider.id).toBe(second.id);
    await prisma.productEvolution.update({
      where: {
        productId_vpsProviderId: { productId: p.id, vpsProviderId: second.id },
      },
      data: { acceptingNewInstances: false },
    });
    await expect(reserve(p)).rejects.toMatchObject({ status: 503 });
    const legacy = await product([first]);
    await expect(reserve(legacy)).rejects.toMatchObject({ status: 503 });
  });

  it('revalidates pauses and null-to-positive limits before any POST', async () => {
    const host = await provider();
    const p = await product([host]);
    const q = await product([host]);
    const pending = await reserve(p);
    await local(q, host);
    await prisma.vpsProvider.update({
      where: { id: host.id },
      data: { maxInstances: 1 },
    });
    await expect(
      a.provisioning.markCreating(pending.ticket, budget()),
    ).rejects.toMatchObject({ status: 503 });
    await a.provisioning.abandon(pending.ticket);
    expect(
      (
        await prisma.instanceProvisioning.findUniqueOrThrow({
          where: { id: pending.ticket.id },
        })
      ).state,
    ).toBe('released');
    await prisma.vpsProvider.update({
      where: { id: host.id },
      data: { maxInstances: null },
    });
    const next = await reserve(p);
    await prisma.vpsProvider.update({
      where: { id: host.id },
      data: { acceptingNewInstances: false },
    });
    await expect(
      a.provisioning.markCreating(next.ticket, budget()),
    ).rejects.toMatchObject({ status: 503 });
    expect(adapter.createInstance).not.toHaveBeenCalled();
  });

  it('protects names across products on a host and across hosts for one product', async () => {
    const first = await provider();
    const second = await provider();
    const p = await product([first, second], true);
    const q = await product([first]);
    await reserve(p, 'same');
    await expect(reserve(q, 'same')).rejects.toMatchObject({ status: 409 });
    await prisma.productEvolution.update({
      where: {
        productId_vpsProviderId: { productId: p.id, vpsProviderId: first.id },
      },
      data: { acceptingNewInstances: false },
    });
    await expect(reserve(p, 'same')).rejects.toMatchObject({ status: 409 });
    const other = await product([second]);
    expect((await reserve(other, 'same')).provider.id).toBe(second.id);
  });

  it('keeps an existing instance on lookup failure and looks up its actual host', async () => {
    const old = await provider();
    const current = await provider();
    const p = await product([current]);
    const instance = await local(p, old, 'known');
    adapter.fetchInstances.mockRejectedValue(new Error('lookup failed'));
    await expect(reserve(p, 'known')).rejects.toThrow('lookup failed');
    expect(adapter.fetchInstances).toHaveBeenCalledWith(
      expect.objectContaining({ providerUrl: old.providerUrl }),
    );
    expect(
      await prisma.instance.findUnique({ where: { id: instance.id } }),
    ).not.toBeNull();
  });

  it('counts global inventory, local rows and reservations once, including inactive/disconnected', async () => {
    const host = await provider(10);
    const p = await product([host]);
    const q = await product([host]);
    const old = await local(q, host, 'old');
    const pending = await reserve(p, 'new');
    await a.provisioning.markCreating(pending.ticket, budget());
    await a.provisioning.recordCreated(pending.ticket, {
      instanceName: 'new',
      instanceId: 'new-id',
      status: 'disconnected',
    });
    remote.set(host.providerUrl, [
      {
        instanceName: 'old',
        instanceId: old.providerInstanceId!,
        status: 'disconnected',
      },
      { instanceName: 'new', instanceId: 'new-id', status: 'disconnected' },
    ]);
    await a.inventory.refresh(host.id, budget());
    expect((await a.inventory.readOccupancy(db, host.id)).effective).toBe(2);
    await a.provisioning.finish(pending.ticket);
    expect((await a.inventory.readOccupancy(db, host.id)).effective).toBe(2);
  });

  it('blocks unsafe unknown sessions and duplicate endpoint aliases only for explicit controls', async () => {
    const host = await provider(1);
    const p = await product([host]);
    remote.set(host.providerUrl, [
      { instanceName: 'external', instanceId: 'external', status: 'open' },
    ]);
    await a.inventory.refresh(host.id, budget());
    await expect(reserve(p)).rejects.toMatchObject({ status: 503 });
    const alias = await provider();
    await prisma.vpsProvider.update({
      where: { id: alias.id },
      data: { providerUrl: host.providerUrl },
    });
    remote.set(host.providerUrl, []);
    await a.inventory.refresh(host.id, budget());
    await expect(reserve(p)).rejects.toMatchObject({ status: 503 });
  });

  it('rejects stale snapshots crossing an import and allows import above the limit', async () => {
    const host = await provider(1);
    const p = await product([host]);
    let respond!: (value: InstanceDto[]) => void;
    let began!: () => void;
    const started = new Promise<void>((resolve) => (began = resolve));
    adapter.fetchInstances.mockImplementationOnce(() => {
      began();
      return new Promise((resolve) => (respond = resolve));
    });
    const refresh = a.inventory.refresh(host.id, budget());
    await started;
    await local(p, host, 'import-a');
    await local(p, host, 'import-b');
    respond([]);
    await expect(refresh).rejects.toMatchObject({ status: 503 });
    expect((await a.inventory.readOccupancy(db, host.id)).effective).toBe(2);
    await expect(reserve(p)).rejects.toMatchObject({ status: 503 });
  });

  it('does not publish incomplete inventory as an empty installation', async () => {
    const host = await provider(1);
    adapter.fetchInstances.mockResolvedValueOnce([
      { instanceName: '', status: 'open' },
    ]);
    await expect(a.inventory.refresh(host.id, budget())).rejects.toMatchObject({
      status: 502,
    });
    expect(
      (await prisma.vpsProvider.findUniqueOrThrow({ where: { id: host.id } }))
        .inventoryRevision,
    ).toBe(0);
  });

  it('fences an expired unsent reservation before releasing its name and slot', async () => {
    const host = await provider(1);
    const p = await product([host]);
    const pending = await reserve(p, 'unsent');
    await expire(pending.ticket.id);
    await b.recovery.recover(pending.ticket.id);
    await expect(
      a.provisioning.markCreating(pending.ticket, budget()),
    ).rejects.toMatchObject({ status: 409 });
    expect((await reserve(p, 'unsent')).ticket.id).not.toBe(pending.ticket.id);
  });

  it('holds uncertain creation after restart/empty inventory; never repeats POST or changes host', async () => {
    const host = await provider(1);
    const p = await product([host]);
    const pending = await reserve(p, 'uncertain');
    await a.provisioning.markCreating(pending.ticket, budget());
    await expire(pending.ticket.id);
    await b.recovery.recover(pending.ticket.id);
    const row = await prisma.instanceProvisioning.findUniqueOrThrow({
      where: { id: pending.ticket.id },
    });
    expect(row).toMatchObject({ state: 'uncertain', vpsProviderId: host.id });
    await expect(reserve(p, 'uncertain')).rejects.toMatchObject({
      status: 409,
    });
    await expect(reserve(p, 'other')).rejects.toMatchObject({ status: 503 });
    expect(adapter.createInstance).not.toHaveBeenCalled();
  });

  it('recovers a confirmed remote result after local persistence failure, with one executor and no proxy retry', async () => {
    const host = await provider();
    const p = await product([host]);
    const pending = await reserve(p, 'recover');
    await a.provisioning.markCreating(pending.ticket, budget());
    await expire(pending.ticket.id);
    remote.set(host.providerUrl, [
      {
        instanceName: 'recover',
        instanceId: 'recovered-id',
        status: 'close',
        token: pending.payload.token,
      },
    ]);
    adapter.fetchInstances.mockClear();
    await Promise.all([
      a.recovery.recover(pending.ticket.id),
      b.recovery.recover(pending.ticket.id),
    ]);
    const row = await prisma.instanceProvisioning.findUniqueOrThrow({
      where: { id: pending.ticket.id },
    });
    expect(row).toMatchObject({
      state: 'committed',
      encryptedRequest: null,
      providerInstanceId: 'recovered-id',
    });
    expect(await prisma.instance.count({ where: { productId: p.id } })).toBe(1);
    expect(adapter.fetchInstances).toHaveBeenCalledTimes(1);
    expect(adapter.applyInstanceDefaults).not.toHaveBeenCalled();
    expect(adapter.createInstance).not.toHaveBeenCalled();
  });

  it('does not adopt a matching name with a shared client token after an unknown POST result', async () => {
    const host = await provider();
    const p = await product([host]);
    const pending = await a.provisioning.prepare(
      p.id,
      { instanceName: 'shared', token: 'client-shared' },
      budget(),
    );
    await a.provisioning.markCreating(pending.ticket, budget());
    await expire(pending.ticket.id);
    remote.set(host.providerUrl, [
      {
        instanceName: 'shared',
        instanceId: 'unproven',
        status: 'open',
        token: 'client-shared',
      },
    ]);
    await a.recovery.recover(pending.ticket.id);
    expect(await prisma.instance.count({ where: { productId: p.id } })).toBe(0);
    expect(
      (
        await prisma.instanceProvisioning.findUniqueOrThrow({
          where: { id: pending.ticket.id },
        })
      ).state,
    ).toBe('uncertain');
  });

  it('recovers known identity and required webhook, retaining the original local ID', async () => {
    const host = await provider();
    const p = await product([host]);
    await prisma.productDefaultWebhook.create({
      data: { productId: p.id, url: 'https://callback.invalid', events: [] },
    });
    const pending = await reserve(p, 'webhook');
    await a.provisioning.markCreating(pending.ticket, budget());
    const created = await a.provisioning.recordCreated(pending.ticket, {
      instanceName: 'webhook',
      instanceId: 'known-remote',
      status: 'close',
    });
    await expire(pending.ticket.id);
    remote.set(host.providerUrl, [
      { instanceName: 'webhook', instanceId: 'known-remote', status: 'close' },
    ]);
    await b.recovery.recover(pending.ticket.id);
    expect(
      await prisma.instanceProvisioning.findUniqueOrThrow({
        where: { id: pending.ticket.id },
      }),
    ).toMatchObject({ state: 'committed', instanceId: created.id });
    expect(adapter.applyInstanceDefaults).toHaveBeenCalledWith(
      expect.any(Object),
      'webhook',
      { webhook: expect.any(Object) as unknown },
    );
  });

  it('keeps capacity during pending compensation and only frees it after confirmed absence', async () => {
    const host = await provider(1);
    const p = await product([host]);
    const pending = await reserve(p, 'cleanup');
    await a.provisioning.markCreating(pending.ticket, budget());
    const instance = await a.provisioning.recordCreated(pending.ticket, {
      instanceName: 'cleanup',
      instanceId: 'clean-id',
      status: 'close',
    });
    await a.provisioning.markCleanup(pending.ticket);
    await expect(reserve(p)).rejects.toMatchObject({ status: 503 });
    await expire(pending.ticket.id);
    await b.recovery.recover(pending.ticket.id);
    expect(
      await prisma.instance.findUnique({ where: { id: instance.id } }),
    ).toBeNull();
    expect(
      (
        await prisma.instanceProvisioning.findUniqueOrThrow({
          where: { id: pending.ticket.id },
        })
      ).state,
    ).toBe('failed');
    expect((await reserve(p)).provider.id).toBe(host.id);
  });

  it('keeps destination immutable during pending work, and does not depend on Redis for admission', async () => {
    const host = await provider();
    const p = await product([host]);
    await reserve(p);
    cache.del = jest.fn().mockRejectedValue(new Error('Redis offline'));
    const admin = new VpsProviderService(db, config, cache);
    await expect(
      admin.update(vpsId, host.id, {
        providerUrl: 'https://different.invalid',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await reserve(p)).provider.id).toBe(host.id);
    cache.del = jest.fn().mockResolvedValue(undefined);
  });

  it('persists reconciliation work before processing and resumes it without Redis', async () => {
    const host = await provider();
    const operation = await a.inventory.request(host.id);
    await b.recovery.scan();
    expect(
      (
        await prisma.evolutionReconciliation.findUniqueOrThrow({
          where: { id: operation.id },
        })
      ).status,
    ).toBe('completed');
  });

  it.each([true, false])(
    'commits real persistence with optional proxy failure=%s and preserves body/host',
    async (failure) => {
      const first = await provider(1);
      const second = await provider();
      const p = await product([first, second], true);
      const q = await product([first]);
      await local(q, first);
      await prisma.productDefaultProxy.create({
        data: {
          productId: p.id,
          enabled: true,
          host: 'proxy.invalid',
          port: '8080',
          protocol: 'http',
        },
      });
      const service = new InstanceService(
        db,
        cache,
        adapters,
        {} as InstanceResolverService,
        config,
        a.provisioning,
      );
      const auth = {
        productId: p.id,
        vpsProviderId: first.id,
        adapterType: 'evolution',
      } as AuthCachePayload;
      adapter.createInstance.mockResolvedValue({
        instanceName: 'contract',
        instanceId: 'contract-id',
        status: 'connecting',
        qrcode: { base64: 'qr-fixture' },
      });
      adapter.applyInstanceDefaults.mockResolvedValue(
        failure ? { proxyFailure: 'timeout' } : { proxy: { enabled: true } },
      );
      const request = {
        instanceName: 'contract',
        qrcode: true,
        token: 'explicit-token',
        webhook: { url: 'https://explicit.invalid' },
      };
      const response = await service.createInstance(auth, request, budget());
      expect(response).toEqual({
        instanceName: 'contract',
        instanceId: 'contract-id',
        status: 'connecting',
        hubId: expect.any(String) as unknown,
        qrcode: { base64: 'qr-fixture' },
        ...(!failure ? { proxy: { enabled: true } } : {}),
      });
      expect(adapter.createInstance).toHaveBeenCalledWith(
        expect.objectContaining({ providerUrl: second.providerUrl }),
        request,
      );
      expect(
        await prisma.instanceProvisioning.findFirst({
          where: { productId: p.id },
        }),
      ).toMatchObject({
        state: 'committed',
        vpsProviderId: second.id,
        encryptedRequest: null,
      });
      expect(adapter.deleteInstance).not.toHaveBeenCalled();
    },
  );

  it('commits required work even when the caller cancels during the optional proxy', async () => {
    const host = await provider();
    const p = await product([host]);
    const execution = budget();
    await prisma.productDefaultProxy.create({
      data: {
        productId: p.id,
        host: 'proxy.invalid',
        port: '8080',
        protocol: 'http',
      },
    });
    const service = new InstanceService(
      db,
      cache,
      adapters,
      {} as InstanceResolverService,
      config,
      a.provisioning,
    );
    adapter.createInstance.mockResolvedValue({
      instanceName: 'cancel-proxy',
      instanceId: 'cancel-id',
      status: 'connecting',
    });
    adapter.applyInstanceDefaults.mockImplementation(() => {
      execution.abort('client_disconnected');
      execution.assertActive();
      return Promise.resolve({});
    });
    await expect(
      service.createInstance(
        { productId: p.id } as AuthCachePayload,
        { instanceName: 'cancel-proxy' },
        execution,
      ),
    ).rejects.toMatchObject({ reason: 'client_disconnected' });
    expect(
      await prisma.instanceProvisioning.findFirst({
        where: { productId: p.id },
      }),
    ).toMatchObject({ state: 'committed' });
    expect(adapter.deleteInstance).not.toHaveBeenCalled();
  });
});
