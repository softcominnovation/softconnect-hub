import { ConflictException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { PrismaClient, Product, VpsProvider } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { PrismaService } from '../src/prisma/prisma.service';
import { CacheService } from '../src/cache/cache.service';
import { decryptAES256GCM, signJwt } from '../src/common/crypto.util';
import {
  detachEmptyLink,
  pendingProvisionings,
} from '../src/modules/provisioning/evolution-reversal';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { QrRequestContext } from '../src/common/qr-request-context';
import { AdapterResolverService } from '../src/providers/adapter-resolver.service';
import {
  InstanceDto,
  ProviderContext,
} from '../src/providers/whatsapp-provider.interface';
import { EvolutionInventoryService } from '../src/modules/provisioning/evolution-inventory.service';
import { EvolutionProvisioningService } from '../src/modules/provisioning/evolution-provisioning.service';
import { EvolutionRecoveryService } from '../src/modules/provisioning/evolution-recovery.service';
import { EvolutionChangesService } from '../src/modules/admin/evolutions/evolution-changes.service';
import { EvolutionSetupService } from '../src/modules/admin/evolutions/evolution-setup.service';
import { EvolutionChangesController } from '../src/modules/admin/evolutions/evolution-changes.controller';
import { evolutionChangeSchema } from '../src/modules/admin/evolutions/evolution-changes.dto';
import { EvolutionsService } from '../src/modules/admin/evolutions/evolutions.service';
import { VpsProviderService } from '../src/modules/admin/vps/vps-provider.service';
import { ProductsService } from '../src/modules/admin/products/products.service';
import { RelayIngressService } from '../src/modules/queue/relay-ingress.service';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw Error('TEST_DATABASE_URL required');
const target = new URL(url);
if (
  !['localhost', '127.0.0.1'].includes(target.hostname) ||
  !/^\/softconnect_ar01_test_[a-z0-9_]+$/.test(target.pathname) ||
  (target.searchParams.get('schema') ?? 'public') !== 'public'
)
  throw Error('Dedicated empty local AR01 database required');
const db = new PrismaClient({ datasources: { db: { url } } });
const replica = new PrismaClient({ datasources: { db: { url } } });
const key = 'a'.repeat(64);
const config = new ConfigService({
  ENCRYPTION_KEY: key,
  JWT_SECRET: 'ar01-test',
  EVOLUTION_ALLOCATION_ENABLED: true,
  RUNTIME_MODE: 'api',
  HUB_BASE_URL: 'https://hub.invalid/api/v1',
  PROXY_TIMEOUT_MS: 15000,
});
const remote = new Map<string, InstanceDto[]>();
const webhooks = new Map<string, object>();
const cacheDouble = {
  del: jest.fn().mockResolvedValue(undefined),
  get: jest.fn().mockResolvedValue(null),
  setWithTTL: jest.fn().mockResolvedValue(undefined),
};
const cache = cacheDouble as unknown as CacheService;
const adapter = {
  fetchInstances: jest.fn((ctx: ProviderContext) =>
    Promise.resolve(remote.get(ctx.providerUrl) ?? []),
  ),
  findWebhook: jest.fn((_ctx: ProviderContext, name: string) =>
    Promise.resolve(
      webhooks.get(name) ?? {
        enabled: false,
        byEvents: true,
        base64: false,
        headers: { 'Client-Header': 'fixture' },
      },
    ),
  ),
  setWebhook: jest.fn(
    (_ctx: ProviderContext, name: string, body: { webhook: object }) => {
      webhooks.set(name, body.webhook);
      return Promise.resolve(body.webhook);
    },
  ),
};
const adapters = {
  resolve: () => adapter,
} as unknown as AdapterResolverService;
function services(client: PrismaClient) {
  const prisma = client as PrismaService;
  const inventory = new EvolutionInventoryService(prisma, adapters, config);
  const provisioning = new EvolutionProvisioningService(
    prisma,
    inventory,
    adapters,
    config,
    cache,
  );
  const recovery = new EvolutionRecoveryService(
    prisma,
    provisioning,
    inventory,
    adapters,
    config,
  );
  const products = new ProductsService(prisma, cache, config, adapters);
  const providers = new VpsProviderService(prisma, config, cache);
  const admin = new EvolutionsService(
    prisma,
    config,
    providers,
    inventory,
    cache,
  );
  const changes = new EvolutionChangesService(
    prisma,
    config,
    cache,
    inventory,
    recovery,
    products,
  );
  const setup = new EvolutionSetupService(prisma, config);
  return {
    inventory,
    provisioning,
    recovery,
    products,
    providers,
    admin,
    changes,
    setup,
  };
}
const one = services(db),
  two = services(replica);
let app: NestFastifyApplication;
let a: Product,
  b: Product,
  host: VpsProvider,
  other: VpsProvider,
  vpsId: string;
const budget = () => new QrRequestContext(20000, 15000);
async function provider(label: string) {
  const provider = await one.providers.createRecord(
    vpsId,
    {
      label,
      providerUrl: `https://${randomUUID()}.invalid`,
      providerApiKey: 'fixture-credential',
    },
    true,
  );
  remote.set(provider.providerUrl, []);
  return provider;
}
async function product(label: string, providerId = host.id) {
  const created = await one.products.create({
    name: label,
    slug: randomUUID(),
    vpsProviderId: providerId,
  });
  return db.product.findUniqueOrThrow({ where: { id: created.id } });
}
async function instance(product = a, provider = host, active = true) {
  const name = randomUUID();
  const record = await db.instance.create({
    data: {
      productId: product.id,
      vpsProviderId: provider.id,
      instanceName: name,
      providerInstanceId: randomUUID(),
      hubToken: randomUUID(),
      isActive: active,
    },
  });
  remote.get(provider.providerUrl)!.push({
    id: record.providerInstanceId!,
    instanceName: name,
    status: 'open',
  });
  return record;
}
async function attach(product = a, provider = other) {
  const row = await db.product.findUniqueOrThrow({ where: { id: product.id } });
  await one.admin.attach(product.id, {
    vpsProviderId: provider.id,
    expectedRevision: row.allocationRevision,
  });
}
async function confirm() {
  const state = await one.setup.state();
  await one.setup.confirm(
    { expectedRevision: state.revision, writersCompatible: true },
    'admin',
  );
}
async function draft(overrides: object = {}, product = a) {
  const current = await db.product.findUniqueOrThrow({
    where: { id: product.id },
  });
  const links = await db.productEvolution.findMany({
    where: { productId: product.id },
  });
  const providers = await db.vpsProvider.findMany({
    where: { id: { in: links.map((l) => l.vpsProviderId) } },
  });
  return evolutionChangeSchema.parse({
    requestId: randomUUID(),
    expectedRevision: current.allocationRevision,
    action: 'configure_capacity',
    links: links.map((l) => ({
      vpsProviderId: l.vpsProviderId,
      expectedRevision: l.configurationRevision,
      acceptingNewInstances: true,
    })),
    confirmations: {
      identities: providers
        .filter((p) => p.identityStatus !== 'verified')
        .map((p) => ({
          vpsProviderId: p.id,
          expectedRevision: p.configurationRevision,
          confirmed: true,
        })),
    },
    ...overrides,
  });
}
async function prepare(overrides: object = {}, product = a) {
  const row = await one.changes.create(
    product.id,
    await draft(overrides, product),
    'admin',
  );
  await one.changes.processNext();
  return one.changes.get(product.id, row.operationId);
}
async function action(action: string, targetProviderId: string) {
  return prepare({ action, targetProviderId, links: [], confirmations: {} });
}
async function apply(row: Awaited<ReturnType<typeof prepare>>) {
  return one.changes.apply(a.id, row.operationId, row.revision, 'admin');
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
function call(
  method: 'GET' | 'POST' | 'PUT',
  route: string,
  payload?: object,
  auth = true,
) {
  return app.inject({
    method,
    url: '/api/v1/admin' + route,
    headers: auth
      ? {
          authorization: `Bearer ${signJwt({ sub: 'admin', role: 'admin' }, 'ar01-test', 3600)}`,
        }
      : { apikey: 'product-fixture' },
    ...(payload ? { payload } : {}),
  });
}

describe('AR01 — real local PostgreSQL, simulated Evolution', () => {
  it('keeps ambiguous legacy delivery as a global retirement blocker until resolved', async () => {
    await one.inventory.refresh(other.id, budget());
    const event = await db.pendingRelayEvent.create({
      data: {
        encryptedPayload: 'fixture',
        originEvidence: { providerIds: [other.id, host.id], method: 'peer_ip' },
      },
    });
    const blocked = await one.setup.removal(other.id);
    expect(blocked.blockers).toContain('callbacks_present');
    await expect(
      one.setup.retire(
        other.id,
        {
          expectedRevision: blocked.revision,
          expectedInventoryRevision: blocked.inventoryRevision,
        },
        'admin',
      ),
    ).rejects.toThrow(ConflictException);
    await db.pendingRelayEvent.update({
      where: { id: event.id },
      data: { state: 'delivered' },
    });
    expect((await one.setup.removal(other.id)).removable).toBe(true);
  });
  it('rolls back limits, identity and links when the final policy write fails', async () => {
    const input = await draft({
      providerUpdates: [
        { vpsProviderId: host.id, expectedRevision: 0, maxInstances: 12 },
      ],
    });
    input.confirmations.sharedLimits = [
      {
        vpsProviderId: host.id,
        expectedRevision: 0,
        maxInstances: 12,
        productIds: [a.id, b.id].sort(),
        confirmed: true,
      },
    ];
    const created = await one.changes.create(a.id, input, 'admin');
    await one.changes.processNext();
    const current = await one.changes.get(a.id, created.operationId);
    const before = await db.vpsProvider.findUniqueOrThrow({
      where: { id: host.id },
    });
    await db.$executeRawUnsafe(
      `CREATE FUNCTION ar01_fail_policy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${a.id}' AND NEW."allocationMode" = 'capacity' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER ar01_fail_policy BEFORE UPDATE ON "Product" FOR EACH ROW EXECUTE FUNCTION ar01_fail_policy()',
    );
    try {
      await expect(apply(current)).rejects.toThrow();
      expect(
        await db.vpsProvider.findUnique({ where: { id: host.id } }),
      ).toEqual(before);
      expect(
        (await db.product.findUniqueOrThrow({ where: { id: a.id } }))
          .allocationMode,
      ).toBe('legacy');
      expect(
        (
          await db.evolutionChange.findUniqueOrThrow({
            where: { id: current.operationId },
          })
        ).status,
      ).toBe('ready');
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER ar01_fail_policy ON "Product"');
      await db.$executeRawUnsafe('DROP FUNCTION ar01_fail_policy()');
    }
  });
  it('serializes concurrent apply and keeps polling revisions stable without new evidence', async () => {
    const row = await prepare();
    expect((await one.changes.get(a.id, row.operationId)).revision).toBe(
      row.revision,
    );
    const [left, right] = await Promise.all([
      apply(row),
      two.changes.apply(a.id, row.operationId, row.revision, 'admin'),
    ]);
    expect(left).toEqual(right);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: a.id } }))
        .allocationRevision,
    ).toBe(1);
  });
  it('does not apply after another replica cancels a remote collection already sent', async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent = new Promise<void>((resolve) => {
      started = resolve;
    });
    adapter.fetchInstances.mockImplementationOnce(async () => {
      started();
      await gate;
      return [];
    });
    const row = await one.changes.create(a.id, await draft(), 'admin');
    const processing = one.changes.processNext();
    await sent;
    const running = await two.changes.get(a.id, row.operationId);
    await two.changes.cancel(a.id, row.operationId, running.revision, 'admin');
    release();
    await processing;
    expect((await one.changes.get(a.id, row.operationId)).status).toBe(
      'cancelled',
    );
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: a.id } }))
        .allocationMode,
    ).toBe('legacy');
  });
  it('uses stored confirmation on old controls, while a per-call declaration remains nonpersistent', async () => {
    await db.evolutionSetupConfirmation.deleteMany();
    await one.admin.update(host.id, {
      expectedRevision: 0,
      confirmIdentity: true,
    });
    await one.inventory.refresh(host.id, budget());
    await one.admin.setAllocation(a.id, {
      expectedRevision: 0,
      mode: 'capacity',
      writersCompatible: true,
    });
    expect((await one.setup.state()).confirmationRequired).toBe(true);
    await confirm();
    await one.admin.setAllocation(b.id, {
      expectedRevision: 0,
      mode: 'capacity',
    });
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: b.id } }))
        .allocationMode,
    ).toBe('capacity');
  });
  it('keeps finite global ceilings and distinguishes full capacity from authentication failure', async () => {
    await instance();
    const input = await draft({
      providerUpdates: [
        { vpsProviderId: host.id, expectedRevision: 0, maxInstances: 1 },
      ],
    });
    input.confirmations.sharedLimits = [
      {
        vpsProviderId: host.id,
        expectedRevision: 0,
        maxInstances: 1,
        productIds: [a.id, b.id].sort(),
        confirmed: true,
      },
    ];
    const created = await one.changes.create(a.id, input, 'admin');
    await one.changes.processNext();
    const row = await one.changes.get(a.id, created.operationId);
    expect(row.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'capacity_full' }),
        expect.objectContaining({ code: 'no_capacity' }),
      ]),
    );
    expect(row.checks.some((c) => c.code === 'credential_invalid')).toBe(false);
  });
  it('reuses an in-progress inventory instead of duplicating its remote collection', async () => {
    await db.evolutionReconciliation.create({
      data: {
        vpsProviderId: host.id,
        status: 'running',
        leaseOwner: 'other-operation',
        leaseExpiresAt: new Date(Date.now() + 20000),
      },
    });
    const row = await prepare();
    expect(row.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'inventory_in_progress' }),
      ]),
    );
    expect(adapter.fetchInstances).not.toHaveBeenCalled();
  });
  it('expires a ready draft at 30 minutes and does not extend it through polling', async () => {
    const row = await prepare();
    await db.evolutionChange.update({
      where: { id: row.operationId },
      data: { expiresAt: new Date(0) },
    });
    expect((await one.changes.get(a.id, row.operationId)).status).toBe(
      'expired',
    );
    await expect(apply(row)).rejects.toThrow(ConflictException);
  });
  beforeAll(async () => {
    const [{ count }] = await db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) FROM information_schema.tables WHERE table_schema='public'`;
    if (count !== 0n) throw Error('Empty database required; no reset');
    cli(['migrate', 'deploy']);
    cli([
      'db',
      'execute',
      '--schema=prisma/schema.prisma',
      '--file=prisma/operations/evolution-base-constraints.sql',
    ]);
    const module = await Test.createTestingModule({
      controllers: [EvolutionChangesController],
      providers: [
        { provide: EvolutionChangesService, useValue: one.changes },
        { provide: EvolutionSetupService, useValue: one.setup },
        { provide: ConfigService, useValue: config },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    await db.evolutionChange.updateMany({
      where: { status: { notIn: ['applied', 'cancelled'] } },
      data: { status: 'cancelled' },
    });
    await db.evolutionSetupConfirmation.deleteMany();
    remote.clear();
    webhooks.clear();
    jest.clearAllMocks();
    config.set('EVOLUTION_ALLOCATION_ENABLED', true);
    const vps = await db.vpsServer.create({
      data: {
        label: 'AR01 fixture',
        subdomain: randomUUID(),
        ip: '198.51.100.42',
      },
    });
    vpsId = vps.id;
    host = await provider('A');
    other = await provider('B');
    a = await product('A');
    b = await product('B');
    await confirm();
  });
  afterAll(async () => {
    await app?.close();
    two.changes.onModuleDestroy();
    await db.$disconnect();
    await replica.$disconnect();
  });

  it('documents all additive endpoints and requires existing JWT authentication', async () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(Object.keys(document.paths)).toHaveLength(9);
    expect(
      (await call('GET', '/evolution-setup', undefined, false)).statusCode,
    ).toBe(401);
    expect(
      (
        await call('POST', `/products/${a.id}/evolution-changes`, {
          ...(await draft()),
          providerApiKey: 'forbidden',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await call('POST', `/products/${a.id}/evolution-changes`, await draft()))
        .statusCode,
    ).toBe(202);
  });
  it('persists explicit environment confirmation, checks revision/database and never auto-attests', async () => {
    await db.evolutionSetupConfirmation.deleteMany();
    expect(await one.setup.state()).toMatchObject({
      confirmationRequired: true,
      revision: 0,
      databaseConsolidated: true,
    });
    expect(
      (
        await call('PUT', '/evolution-setup/confirmation', {
          expectedRevision: 0,
          writersCompatible: false,
        })
      ).statusCode,
    ).toBe(400);
    await confirm();
    expect(await two.setup.state()).toMatchObject({
      confirmationRequired: false,
      revision: 1,
    });
    await expect(
      one.setup.confirm(
        { expectedRevision: 0, writersCompatible: true },
        'admin',
      ),
    ).rejects.toThrow(ConflictException);
    await db.evolutionSetupConfirmation.updateMany({
      data: { databaseIdentity: 'another-database' },
    });
    expect((await one.setup.state()).confirmationRequired).toBe(true);
  });
  it('keeps prepare side-effect free for policy, applies atomically and records machine actor', async () => {
    const row = await prepare();
    expect(row.status).toBe('ready');
    expect(await db.product.findUnique({ where: { id: a.id } })).toMatchObject({
      allocationMode: 'legacy',
    });
    expect(
      await db.vpsProvider.findUnique({ where: { id: host.id } }),
    ).toMatchObject({ identityStatus: 'pending' });
    const applied = await apply(row);
    expect(applied.status).toBe('applied');
    expect(await db.product.findUnique({ where: { id: a.id } })).toMatchObject({
      allocationMode: 'capacity',
    });
    expect(
      await db.vpsProvider.findUnique({ where: { id: host.id } }),
    ).toMatchObject({ identityStatus: 'verified' });
    expect(
      await db.evolutionAdminEvent.count({
        where: { action: 'evolution.change.apply' },
      }),
    ).toBeGreaterThan(0);
    expect(JSON.stringify(applied)).not.toMatch(
      /fixture-credential|providerApiKey|callbackTokenEncrypted|apiKeyHash/,
    );
    expect(await apply(row)).toEqual(applied);
  });
  it('deduplicates concurrent request IDs across replicas, rejects different contents and scopes queries', async () => {
    const input = await draft();
    const [first, second] = await Promise.all([
      one.changes.create(a.id, input, 'admin'),
      two.changes.create(a.id, input, 'admin'),
    ]);
    expect(first.operationId).toBe(second.operationId);
    await expect(
      two.changes.create(a.id, { ...input, links: [] }, 'admin'),
    ).rejects.toThrow(ConflictException);
    expect(
      (
        await call(
          'GET',
          `/products/${b.id}/evolution-changes/${first.operationId}`,
        )
      ).statusCode,
    ).toBe(404);
    expect((await one.changes.list(a.id)).items).toHaveLength(1);
  });
  it('executes a draft only once across two replicas and recovers a crashed lease', async () => {
    const row = await one.changes.create(a.id, await draft(), 'admin');
    await db.evolutionChange.update({
      where: { id: row.operationId },
      data: {
        status: 'running',
        leaseOwner: 'crashed',
        leaseExpiresAt: new Date(0),
      },
    });
    await Promise.all([one.changes.processNext(), two.changes.processNext()]);
    expect((await one.changes.get(a.id, row.operationId)).status).toBe('ready');
    expect(adapter.fetchInstances).toHaveBeenCalledTimes(1);
  });
  it('reports a queued draft as expired without GET doing network work', async () => {
    const row = await one.changes.create(a.id, await draft(), 'admin');
    await db.evolutionChange.update({
      where: { id: row.operationId },
      data: { executionDeadline: new Date(0) },
    });
    expect((await one.changes.get(a.id, row.operationId)).status).toBe(
      'expired',
    );
    expect(adapter.fetchInstances).not.toHaveBeenCalled();
  });
  it('cancels without apply and never revives a cancelled configuration', async () => {
    const row = await prepare();
    await one.changes.cancel(a.id, row.operationId, row.revision, 'admin');
    await expect(apply(row)).rejects.toThrow(ConflictException);
    await two.changes.processNext();
    expect((await one.changes.get(a.id, row.operationId)).status).toBe(
      'cancelled',
    );
  });
  it('detects stale evidence at apply and requires explicit preparation after execution budget', async () => {
    const row = await prepare();
    await db.vpsProvider.update({
      where: { id: host.id },
      data: { inventoryObservedAt: new Date(0) },
    });
    await expect(apply(row)).rejects.toThrow(ConflictException);
    const current = await one.changes.get(a.id, row.operationId);
    expect(current.status).toBe('action_required');
    await db.evolutionChange.update({
      where: { id: row.operationId },
      data: { executionDeadline: new Date(0) },
    });
    await one.inventory.refresh(host.id, budget());
    expect(
      (await one.changes.get(a.id, row.operationId)).requiredActions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'prepare_again' }),
      ]),
    );
  });
  it('invalidates a draft after credential/configuration or link changes without partial policy writes', async () => {
    const row = await prepare();
    await one.admin.update(host.id, { expectedRevision: 0, label: 'changed' });
    await expect(apply(row)).rejects.toThrow(ConflictException);
    expect(await db.product.findUnique({ where: { id: a.id } })).toMatchObject({
      allocationMode: 'legacy',
    });
    expect(
      await db.vpsProvider.findUnique({ where: { id: host.id } }),
    ).toMatchObject({ identityStatus: 'pending' });
  });
  it('requires exact shared-limit confirmation and invalidates it when another product joins', async () => {
    const update = {
      vpsProviderId: host.id,
      expectedRevision: 0,
      maxInstances: 10,
    };
    const pending = await prepare({ providerUpdates: [update] });
    expect(pending.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'shared_limit_confirmation',
          blocking: true,
        }),
      ]),
    );
    const input = await draft({ providerUpdates: [update] });
    input.confirmations.sharedLimits = [
      { ...update, productIds: [a.id, b.id].sort(), confirmed: true },
    ];
    const row = await one.changes.create(a.id, input, 'admin');
    await one.changes.processNext();
    const current = await one.changes.get(a.id, row.operationId);
    expect(current.status).toBe('ready');
    await product('new sharing product');
    await expect(apply(current)).rejects.toThrow(ConflictException);
    expect(
      (await db.vpsProvider.findUniqueOrThrow({ where: { id: host.id } }))
        .maxInstances,
    ).toBeNull();
  });
  it('applies shared controls to all users and invalidates their caches, preserving omitted limits', async () => {
    const input = await draft({
      providerUpdates: [
        { vpsProviderId: host.id, expectedRevision: 0, maxInstances: 8 },
      ],
    });
    input.confirmations.sharedLimits = [
      {
        vpsProviderId: host.id,
        expectedRevision: 0,
        maxInstances: 8,
        productIds: [a.id, b.id].sort(),
        confirmed: true,
      },
    ];
    const created = await one.changes.create(a.id, input, 'admin');
    await one.changes.processNext();
    await apply(await one.changes.get(a.id, created.operationId));
    expect(cacheDouble.del).toHaveBeenCalledWith(`auth:${b.apiKeyHash}`);
    await apply(await prepare());
    expect(
      (await db.vpsProvider.findUniqueOrThrow({ where: { id: host.id } }))
        .maxInstances,
    ).toBe(8);
  });
  it('does not hide a selected invalid destination behind another healthy destination', async () => {
    await attach();
    await db.vpsProvider.update({
      where: { id: other.id },
      data: { isActive: false },
    });
    const row = await prepare();
    expect(row.status).toBe('action_required');
    expect(row.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'provider_inactive',
          providerId: other.id,
          blocking: true,
        }),
      ]),
    );
  });
  it.each([
    [401, 'credential_invalid'],
    [408, 'inventory_timeout'],
    [502, 'inventory_incomplete'],
    [503, 'provider_unavailable'],
  ] as const)(
    'sanitizes and retains collection failure %s',
    async (status, code) => {
      adapter.fetchInstances.mockRejectedValueOnce(
        new HttpException('sensitive upstream secret', status),
      );
      const row = await prepare();
      expect(row.status).toBe('action_required');
      expect(row.checks).toEqual(
        expect.arrayContaining([expect.objectContaining({ code })]),
      );
      expect(JSON.stringify(row)).not.toContain('sensitive upstream secret');
    },
  );
  it('reports an unreadable stored credential without modifying it', async () => {
    await db.vpsProvider.update({
      where: { id: host.id },
      data: { providerApiKey: 'unreadable-fixture' },
    });
    expect((await prepare()).checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'credential_unreadable' }),
      ]),
    );
    expect(adapter.fetchInstances).not.toHaveBeenCalled();
    expect(
      (await db.vpsProvider.findUniqueOrThrow({ where: { id: host.id } }))
        .providerApiKey,
    ).toBe('unreadable-fixture');
  });
  it('distinguishes completed reconciliation with unknown remote sessions from readiness', async () => {
    remote
      .get(host.providerUrl)!
      .push({ id: randomUUID(), instanceName: 'unassigned', status: 'open' });
    const row = await prepare();
    expect(row.status).toBe('action_required');
    expect(
      await db.evolutionReconciliation.findFirst({
        where: { vpsProviderId: host.id },
      }),
    ).toMatchObject({ status: 'completed' });
    expect(row.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'inventory_unconfirmed' }),
      ]),
    );
  });
  it('guides an empty relay Evolution through an explicit test product and authentic ingress', async () => {
    await db.product.update({ where: { id: a.id }, data: { hubRelay: true } });
    const row = await prepare();
    expect(row.requiredActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'use_dedicated_test_product',
          providerId: host.id,
        }),
      ]),
    );
    expect(await db.instance.count({ where: { vpsProviderId: host.id } })).toBe(
      0,
    );
    const testProduct = await product('explicit test product');
    await db.product.update({
      where: { id: testProduct.id },
      data: { hubRelay: true },
    });
    const testInstance = await instance(testProduct);
    await one.products.syncRelay(testProduct.id, testInstance.id, budget());
    expect(
      (await db.vpsProvider.findUniqueOrThrow({ where: { id: host.id } }))
        .callbackReadiness,
    ).toBe('pending');
    const ingress = new RelayIngressService(db as PrismaService, config, {
      add: jest.fn().mockResolvedValue({}),
    } as unknown as Queue);
    await expect(
      ingress.receiveAuthenticated(host.id, 'forged', {
        event: 'CONNECTION_UPDATE',
        instance: testInstance.instanceName,
      }),
    ).rejects.toThrow();
    const providerRow = await db.vpsProvider.findUniqueOrThrow({
      where: { id: host.id },
    });
    const token = decryptAES256GCM(providerRow.callbackTokenEncrypted!, key);
    await expect(
      ingress.receiveAuthenticated(other.id, token, {}),
    ).rejects.toThrow();
    await ingress.receiveAuthenticated(host.id, token, {
      event: 'CONNECTION_UPDATE',
      instance: testInstance.instanceName,
      data: { state: 'open' },
    });
    expect(
      (await db.vpsProvider.findUniqueOrThrow({ where: { id: host.id } }))
        .callbackReadiness,
    ).toBe('ready');
    expect((await one.changes.get(a.id, row.operationId)).checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'configuration_changed' }),
      ]),
    );
    const fresh = await prepare();
    expect(fresh.status).toBe('ready');
    await apply(fresh);
    expect(
      (await db.instance.findUniqueOrThrow({ where: { id: testInstance.id } }))
        .productId,
    ).toBe(testProduct.id);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: testProduct.id } }))
        .allocationMode,
    ).toBe('legacy');
  });
  it('bounds explicit callback sync and preserves options; retry verifies remote effect first', async () => {
    await db.product.update({ where: { id: a.id }, data: { hubRelay: true } });
    const own = await instance();
    const row = await prepare();
    await expect(
      one.changes.callbackCheck(
        a.id,
        row.operationId,
        {
          expectedOperationRevision: row.revision,
          instanceId: randomUUID(),
          confirmWebhookUpdate: true,
        },
        'admin',
      ),
    ).rejects.toThrow(ConflictException);
    adapter.setWebhook.mockImplementationOnce((_ctx, name, body) => {
      webhooks.set(name, body.webhook);
      return Promise.reject(
        new HttpException('timeout after remote effect', 408),
      );
    });
    await one.changes.callbackCheck(
      a.id,
      row.operationId,
      {
        expectedOperationRevision: row.revision,
        instanceId: own.id,
        confirmWebhookUpdate: true,
      },
      'admin',
    );
    await one.changes.processNext();
    const uncertain = await one.changes.get(a.id, row.operationId);
    expect(uncertain.callback).toMatchObject({ state: 'uncertain' });
    expect(webhooks.get(own.instanceName)).toMatchObject({
      byEvents: true,
      base64: false,
      headers: { 'Client-Header': 'fixture' },
    });
    expect(adapter.setWebhook.mock.calls[0][0].execution).toBeInstanceOf(
      QrRequestContext,
    );
    await one.changes.callbackCheck(
      a.id,
      row.operationId,
      {
        expectedOperationRevision: uncertain.revision,
        instanceId: own.id,
        confirmWebhookUpdate: true,
      },
      'admin',
    );
    await one.changes.processNext();
    expect(adapter.setWebhook).toHaveBeenCalledTimes(1);
    expect(
      (await db.vpsProvider.findUniqueOrThrow({ where: { id: host.id } }))
        .callbackReadiness,
    ).toBe('pending');
  });
  it('selects one destination without moving existing sessions, deleting links or overriding global pause', async () => {
    await attach();
    const first = await instance();
    const second = await instance(a, other);
    await apply(await prepare());
    await apply(await action('single_destination', host.id));
    expect(
      await db.productEvolution.findUnique({
        where: {
          productId_vpsProviderId: { productId: a.id, vpsProviderId: other.id },
        },
      }),
    ).toMatchObject({ acceptingNewInstances: false });
    expect(
      await db.instance.findUnique({ where: { id: second.id } }),
    ).toMatchObject({ vpsProviderId: other.id });
    expect(
      await db.instance.findUnique({ where: { id: first.id } }),
    ).toMatchObject({ vpsProviderId: host.id });
    expect(await one.admin.placements(a.id)).toHaveLength(2);
    await db.vpsProvider.update({
      where: { id: host.id },
      data: {
        acceptingNewInstances: false,
        configurationRevision: { increment: 1 },
      },
    });
    expect((await action('single_destination', host.id)).status).toBe(
      'action_required',
    );
  });
  it('restores legacy with positive history only when present ownership is safe and preserves limits', async () => {
    await attach();
    await instance();
    await apply(await prepare());
    const history = new Date('2026-01-01');
    await db.product.update({
      where: { id: a.id },
      data: { capacityFirstAllocationAt: history },
    });
    await db.vpsProvider.update({
      where: { id: host.id },
      data: { maxInstances: 10, configurationRevision: { increment: 1 } },
    });
    await apply(await action('restore_legacy', host.id));
    expect(await db.product.findUnique({ where: { id: a.id } })).toMatchObject({
      allocationMode: 'legacy',
      vpsProviderId: host.id,
      capacityFirstAllocationAt: history,
    });
    expect(
      (await db.vpsProvider.findUniqueOrThrow({ where: { id: host.id } }))
        .maxInstances,
    ).toBe(10);
    await apply(await prepare());
    const current = await db.product.findUniqueOrThrow({ where: { id: a.id } });
    expect(
      (
        await one.admin.setAllocation(a.id, {
          expectedRevision: current.allocationRevision,
          mode: 'legacy',
        })
      ).mode,
    ).toBe('legacy');
  });
  it('blocks legacy for inactive sessions or uncertain provisioning outside the target', async () => {
    await attach();
    const old = await instance(a, other, false);
    await apply(await prepare());
    expect((await action('restore_legacy', host.id)).checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'instances_outside_target' }),
      ]),
    );
    await db.instance.delete({ where: { id: old.id } });
    await db.instanceProvisioning.create({
      data: {
        productId: a.id,
        vpsProviderId: other.id,
        linkProductId: a.id,
        linkVpsProviderId: other.id,
        instanceName: randomUUID(),
        requestHash: 'fixture',
        state: 'uncertain',
      },
    });
    expect((await action('restore_legacy', host.id)).checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'provisioning_pending' }),
      ]),
    );
  });
  it('distinguishes another product delivery from ambiguous delivery while removing an empty shared link', async () => {
    await attach();
    const another = await product('other owner', other.id);
    const ownOther = await instance(another, other);
    const event = await db.pendingRelayEvent.create({
      data: {
        vpsProviderId: other.id,
        instanceId: ownOther.id,
        instanceName: ownOther.instanceName,
        encryptedPayload: 'fixture',
        originEvidence: { providerIds: [other.id] },
      },
    });
    const row = await action('detach', other.id);
    expect(row.status).toBe('ready');
    await db.pendingRelayEvent.update({
      where: { id: event.id },
      data: { instanceId: null, instanceName: 'ambiguous' },
    });
    await expect(apply(row)).rejects.toThrow(ConflictException);
    await db.pendingRelayEvent.update({
      where: { id: event.id },
      data: { state: 'delivered' },
    });
    await apply(await action('detach', other.id));
    expect(
      await db.instance.findUnique({ where: { id: ownOther.id } }),
    ).not.toBeNull();
  });
  it('clears only terminal optional link FKs, preserves history and permits reattach paused', async () => {
    await attach();
    // Simulate old data before the check constraint, only inside a rolled-back
    // fixture transaction. Production constraints are never weakened.
    const rollback = new Error('fixture rollback');
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'ALTER TABLE "InstanceProvisioning" DROP CONSTRAINT "InstanceProvisioning_active_link_check"',
        );
        const old = await tx.instanceProvisioning.create({
          data: {
            productId: a.id,
            vpsProviderId: other.id,
            linkProductId: a.id,
            linkVpsProviderId: other.id,
            instanceName: randomUUID(),
            requestHash: 'fixture',
            state: 'committed',
          },
        });
        await detachEmptyLink(tx, a, other.id);
        expect(
          await tx.instanceProvisioning.findUnique({ where: { id: old.id } }),
        ).toMatchObject({
          productId: a.id,
          vpsProviderId: other.id,
          linkProductId: null,
          linkVpsProviderId: null,
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    const history = await db.instanceProvisioning.create({
      data: {
        productId: a.id,
        vpsProviderId: other.id,
        instanceName: randomUUID(),
        requestHash: 'fixture',
        state: 'committed',
      },
    });
    await apply(await action('detach', other.id));
    expect(
      await db.instanceProvisioning.findUnique({ where: { id: history.id } }),
    ).toMatchObject({
      productId: a.id,
      vpsProviderId: other.id,
      state: 'committed',
      linkProductId: null,
      linkVpsProviderId: null,
    });
    await attach();
    expect(
      await db.productEvolution.findUnique({
        where: {
          productId_vpsProviderId: { productId: a.id, vpsProviderId: other.id },
        },
      }),
    ).toMatchObject({ acceptingNewInstances: false });
  });
  it('rejects removing a default and preserves unknown provisioning states and live terminal leases', async () => {
    expect((await action('detach', host.id)).checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'default_provider' }),
      ]),
    );
    await attach();
    const rollback = new Error('fixture rollback');
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'ALTER TABLE "InstanceProvisioning" DROP CONSTRAINT "InstanceProvisioning_active_link_check"',
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE "InstanceProvisioning" DROP CONSTRAINT "InstanceProvisioning_state_check"',
        );
        await tx.instanceProvisioning.create({
          data: {
            productId: a.id,
            vpsProviderId: other.id,
            instanceName: randomUUID(),
            requestHash: 'fixture',
            state: 'future-state',
          },
        });
        expect(await pendingProvisionings(tx, a.id, other.id)).toBe(1);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    await db.instanceProvisioning.create({
      data: {
        productId: a.id,
        vpsProviderId: other.id,
        instanceName: randomUUID(),
        requestHash: 'fixture',
        state: 'committed',
        leaseOwner: 'still-running',
      },
    });
    expect((await action('detach', other.id)).status).toBe('action_required');
  });
  it('requires fresh empty inventory and no global use to retire; remains logical and idempotent', async () => {
    expect((await one.setup.removal(other.id)).removable).toBe(false);
    await one.inventory.refresh(other.id, budget());
    const readiness = await one.setup.removal(other.id);
    expect(readiness.removable).toBe(true);
    const dto = {
      expectedRevision: readiness.revision,
      expectedInventoryRevision: readiness.inventoryRevision,
    };
    const retired = await one.setup.retire(other.id, dto, 'admin');
    expect(retired.isActive).toBe(false);
    expect(await one.setup.retire(other.id, dto, 'admin')).toEqual(retired);
    expect(
      await db.vpsProvider.findUnique({ where: { id: other.id } }),
    ).not.toBeNull();
    await expect(
      one.setup.retire(
        host.id,
        { expectedRevision: 0, expectedInventoryRevision: 0 },
        'admin',
      ),
    ).rejects.toThrow(ConflictException);
  });
  it('prevents retirement racing with an attach and retains audit for the service JWT', async () => {
    await one.inventory.refresh(other.id, budget());
    const readiness = await one.setup.removal(other.id);
    const results = await Promise.allSettled([
      one.setup.retire(
        other.id,
        {
          expectedRevision: readiness.revision,
          expectedInventoryRevision: readiness.inventoryRevision,
        },
        'admin',
      ),
      attach(),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const provider = await db.vpsProvider.findUniqueOrThrow({
      where: { id: other.id },
    });
    expect(
      await db.productEvolution.count({ where: { vpsProviderId: other.id } }),
    ).toBe(provider.isActive ? 1 : 0);
  });
  it('keeps legacy unconfigured behavior independent of setup and the feature flag', async () => {
    await db.evolutionSetupConfirmation.deleteMany();
    config.set('EVOLUTION_ALLOCATION_ENABLED', false);
    const current = await db.product.findUniqueOrThrow({ where: { id: a.id } });
    expect(
      (
        await one.admin.setAllocation(a.id, {
          mode: 'legacy',
          expectedRevision: current.allocationRevision,
        })
      ).mode,
    ).toBe('legacy');
    const row = await prepare();
    expect(row.status).toBe('action_required');
    expect(row.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'distribution_disabled' }),
        expect.objectContaining({ code: 'writers_unconfirmed' }),
      ]),
    );
  });
});
