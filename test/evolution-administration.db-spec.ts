import { ConflictException, Logger } from '@nestjs/common';
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
import { PrismaService } from '../src/prisma/prisma.service';
import { CacheService } from '../src/cache/cache.service';
import { instanceCacheKey } from '../src/cache/instance-cache';
import { signJwt } from '../src/common/crypto.util';
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
import {
  assertWritersCompatible,
  isEvolutionBaseConsolidated,
} from '../src/modules/provisioning/evolution-controls';
import { EvolutionsService } from '../src/modules/admin/evolutions/evolutions.service';
import { EvolutionsController } from '../src/modules/admin/evolutions/evolutions.controller';
import { ProductEvolutionsController } from '../src/modules/admin/evolutions/product-evolutions.controller';
import { VpsProviderService } from '../src/modules/admin/vps/vps-provider.service';
import { VpsProviderController } from '../src/modules/admin/vps/vps-provider.controller';
import { ProductsService } from '../src/modules/admin/products/products.service';
import { ProductsController } from '../src/modules/admin/products/products.controller';
import { AdminInstancesController } from '../src/modules/admin/instances/admin-instances.controller';
import { AdminInstancesService } from '../src/modules/admin/instances/admin-instances.service';
import { InstanceService } from '../src/modules/instance/instance.service';
import { InstanceController } from '../src/modules/instance/instance.controller';
import { InstanceResolverService } from '../src/resolver/instance.resolver';
import { MessageService } from '../src/modules/message/message.service';
import { EvolutionHttpService } from '../src/adapters/evolution/evolution.http';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL required');
const target = new URL(url);
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  !/^\/softconnect_phase04_test_[a-z0-9_]+$/.test(target.pathname) ||
  (target.searchParams.get('schema') ?? 'public') !== 'public'
)
  throw new Error('Only a dedicated empty local phase04 database is allowed');
const prisma = new PrismaClient({ datasources: { db: { url } } });
const replica = new PrismaClient({ datasources: { db: { url } } });
const key = 'a'.repeat(64),
  jwt = 'phase04-fixture-jwt';
const config = new ConfigService({
  ENCRYPTION_KEY: key,
  JWT_SECRET: jwt,
  EVOLUTION_ALLOCATION_ENABLED: false,
  HUB_BASE_URL: 'https://hub.invalid/api/v1',
  PROXY_TIMEOUT_MS: 15000,
});
const remote = new Map<string, InstanceDto[]>();
const values = new Map<string, unknown>();
const cacheDouble = {
  get: jest.fn((id: string) => Promise.resolve(values.get(id) ?? null)),
  setWithTTL: jest.fn((id: string, value: unknown) => {
    values.set(id, value);
    return Promise.resolve();
  }),
  del: jest.fn((id: string) => {
    values.delete(id);
    return Promise.resolve();
  }),
  increment: jest.fn().mockResolvedValue(1),
  expire: jest.fn(),
};
const cache = cacheDouble as unknown as CacheService;
const adapter = {
  fetchInstances: jest.fn((ctx: ProviderContext) =>
    Promise.resolve(remote.get(ctx.providerUrl) ?? []),
  ),
  fetchInstance: jest.fn((ctx: ProviderContext, name: string) =>
    Promise.resolve(
      remote.get(ctx.providerUrl)?.find((item) => item.instanceName === name),
    ),
  ),
  createInstance: jest.fn(
    (ctx: ProviderContext, dto: { instanceName: string; token?: string }) => {
      const id = randomUUID();
      remote.get(ctx.providerUrl)!.push({
        id,
        instanceName: dto.instanceName,
        token: dto.token,
        status: 'connecting',
      } as InstanceDto);
      return Promise.resolve({
        instanceId: id,
        instanceName: dto.instanceName,
        status: 'connecting',
        qrcode: { base64: 'fixture-qr' },
      });
    },
  ),
  applyInstanceDefaults: jest.fn().mockResolvedValue({}),
  connectInstance: jest.fn().mockResolvedValue({ base64: 'fixture-qr' }),
  getConnectionState: jest.fn().mockResolvedValue({ state: 'open' }),
  deleteInstance: jest.fn().mockResolvedValue(undefined),
};
const adapters = {
  resolve: () => adapter,
} as unknown as AdapterResolverService;
function services(client: PrismaClient) {
  const db = client as PrismaService;
  const providers = new VpsProviderService(db, config, cache);
  const inventory = new EvolutionInventoryService(db, adapters, config);
  const admin = new EvolutionsService(db, config, providers, inventory, cache);
  const provisioning = new EvolutionProvisioningService(
    db,
    inventory,
    adapters,
    config,
    cache,
  );
  const products = new ProductsService(db, cache, config, adapters);
  return { db, providers, inventory, admin, provisioning, products };
}
const first = services(prisma),
  second = services(replica);
let vpsId: string,
  host: VpsProvider,
  other: VpsProvider,
  a: Product,
  b: Product;
let app: NestFastifyApplication;
let instanceService: InstanceService;
let sequence = 0;
const budget = () => new QrRequestContext(20000, 19000);
const authHeaders = () => ({
  authorization: `Bearer ${signJwt({ sub: 'fixture-admin' }, jwt, 3600)}`,
});
async function call(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  route: string,
  payload?: object,
  authenticated = true,
) {
  return app.inject({
    method,
    url: '/api/v1' + route,
    headers: authenticated ? authHeaders() : {},
    ...(payload ? { payload } : {}),
  });
}
const globalPath = (provider = host) => `/admin/evolutions/${provider.id}`;
const productPath = (product = a) => `/admin/products/${product.id}`;
async function provider(label: string) {
  const row = await first.providers.createRecord(
    vpsId,
    {
      label,
      providerUrl: `https://${label}-${sequence}.invalid`,
      providerApiKey: 'fixture-provider-secret',
    },
    true,
  );
  remote.set(row.providerUrl, []);
  return row;
}
async function product(label: string, providerId = host.id) {
  const result = await first.products.create({
    name: label,
    slug: `${label}-${sequence}-${randomUUID()}`,
    vpsProviderId: providerId,
  });
  return prisma.product.findUniqueOrThrow({ where: { id: result.id } });
}
async function ready(provider = host) {
  const current = await prisma.vpsProvider.findUniqueOrThrow({
    where: { id: provider.id },
  });
  await first.admin.update(provider.id, {
    expectedRevision: current.configurationRevision,
    confirmIdentity: true,
  });
  return first.inventory.refresh(provider.id, budget());
}
async function update(
  provider: VpsProvider,
  data: Omit<Parameters<EvolutionsService['update']>[1], 'expectedRevision'>,
) {
  const current = await prisma.vpsProvider.findUniqueOrThrow({
    where: { id: provider.id },
  });
  return first.admin.update(provider.id, {
    ...data,
    expectedRevision: current.configurationRevision,
  });
}
async function local(
  product = a,
  provider = host,
  name = `session-${randomUUID()}`,
) {
  const row = await prisma.instance.create({
    data: {
      productId: product.id,
      vpsProviderId: provider.id,
      instanceName: name,
      providerInstanceId: randomUUID(),
      hubToken: randomUUID(),
    },
  });
  remote.get(provider.providerUrl)!.push({
    id: row.providerInstanceId!,
    instanceName: name,
    status: 'open',
  } as InstanceDto);
  return row;
}
async function pending(
  product = a,
  provider = host,
  name = `pending-${randomUUID()}`,
) {
  return prisma.instanceProvisioning.create({
    data: {
      productId: product.id,
      vpsProviderId: provider.id,
      linkProductId: product.id,
      linkVpsProviderId: provider.id,
      instanceName: name,
      requestHash: 'fixture',
      state: 'uncertain',
    },
  });
}
async function attach(product = a, provider = other) {
  const current = await prisma.product.findUniqueOrThrow({
    where: { id: product.id },
  });
  return first.admin.attach(product.id, {
    vpsProviderId: provider.id,
    expectedRevision: current.allocationRevision,
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

describe('Phase04 — administrative API on isolated PostgreSQL', () => {
  beforeAll(async () => {
    const [{ count }] = await prisma.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) FROM information_schema.tables WHERE table_schema='public'`;
    if (count !== 0n)
      throw new Error('Database must be empty; no reset allowed');
    cli(['migrate', 'deploy']);
    cli([
      'db',
      'execute',
      '--schema=prisma/schema.prisma',
      '--file=prisma/operations/evolution-base-constraints.sql',
    ]);
    const resolver = new InstanceResolverService(
      cache,
      first.db,
      config as unknown as ConstructorParameters<
        typeof InstanceResolverService
      >[2],
    );
    instanceService = new InstanceService(
      first.db,
      cache,
      adapters,
      resolver,
      config,
      first.provisioning,
    );
    const adminInstances = new AdminInstancesService(
      first.db,
      instanceService,
      {} as MessageService,
      {} as EvolutionHttpService,
      config,
      cache,
    );
    const module = await Test.createTestingModule({
      controllers: [
        EvolutionsController,
        ProductEvolutionsController,
        VpsProviderController,
        ProductsController,
        AdminInstancesController,
        InstanceController,
      ],
      providers: [
        { provide: EvolutionsService, useValue: first.admin },
        { provide: VpsProviderService, useValue: first.providers },
        { provide: ProductsService, useValue: first.products },
        { provide: AdminInstancesService, useValue: adminInstances },
        { provide: InstanceService, useValue: instanceService },
        { provide: PrismaService, useValue: first.db },
        { provide: CacheService, useValue: cache },
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
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  beforeEach(async () => {
    sequence++;
    values.clear();
    remote.clear();
    jest.clearAllMocks();
    config.set('EVOLUTION_ALLOCATION_ENABLED', false);
    const vps = await prisma.vpsServer.create({
      data: {
        label: 'phase04',
        subdomain: `phase04-${sequence}.invalid`,
        ip: '198.51.100.42',
      },
    });
    vpsId = vps.id;
    host = await provider('one');
    other = await provider('two');
    a = await product('first');
    b = await product('second');
  });
  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
    await replica.$disconnect();
  });

  it('exposes the complete new catalog, link, policy and placement routes in Swagger', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/admin/evolutions',
        '/api/v1/admin/evolutions/{providerId}',
        '/api/v1/admin/evolutions/{providerId}/occupancy',
        '/api/v1/admin/evolutions/{providerId}/reconcile',
        '/api/v1/admin/evolutions/{providerId}/reconciliations/{operationId}',
        '/api/v1/admin/products/{productId}/evolutions',
        '/api/v1/admin/products/{productId}/evolutions/attach',
        '/api/v1/admin/products/{productId}/evolutions/{providerId}',
        '/api/v1/admin/products/{productId}/evolutions/{providerId}/import-candidates',
        '/api/v1/admin/products/{productId}/instances/placements',
        '/api/v1/admin/products/{productId}/allocation',
      ]),
    );
    expect(
      JSON.stringify(doc.components?.schemas?.EvolutionResponseDto),
    ).not.toContain('providerApiKey');
  });

  it.each(['GET', 'POST', 'PUT', 'DELETE'] as const)(
    'requires JWT for %s on the new API',
    async (method) => {
      const response = await call(
        method,
        method === 'POST' ? '/admin/evolutions' : globalPath(),
        { expectedRevision: 0 },
        false,
      );
      expect(response.statusCode).toBe(401);
    },
  );

  it('creates through the global catalog without product or limit and keeps the contextual ID/contract', async () => {
    const response = await call('POST', '/admin/evolutions', {
      vpsId,
      label: 'independent',
      providerUrl: `https://new-${sequence}.invalid`,
      providerApiKey: 'new-fixture-secret',
    });
    expect(response.statusCode).toBe(201);
    const result = response.json<{
      id: string;
      maxInstances: null;
      acceptingNewInstances: boolean;
      links: unknown[];
    }>();
    expect(result).toMatchObject({
      maxInstances: null,
      acceptingNewInstances: true,
      links: [],
    });
    expect(response.body).not.toMatch(
      /new-fixture-secret|providerApiKey|callbackTokenEncrypted/,
    );
    const legacy = await call('GET', `/admin/vps/${vpsId}/providers`);
    expect(
      legacy.json<Array<{ id: string; providerApiKey: string }>>(),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: result.id,
          providerApiKey: 'new-fixture-secret',
        }),
      ]),
    );
    expect(legacy.body).not.toMatch(/maxInstances|configurationRevision/);
  });

  it('keeps two legacy products sharing a provider with no mandatory new configuration', async () => {
    expect(a.allocationMode).toBe('legacy');
    expect(b.vpsProviderId).toBe(a.vpsProviderId);
    const result = await call('PUT', productPath(), {
      name: 'renamed',
      vpsProviderId: host.id,
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).not.toMatch(/allocationMode|allocationRevision/);
    const fresh = await prisma.product.findUniqueOrThrow({
      where: { id: a.id },
    });
    expect(fresh).toMatchObject({
      vpsProviderId: host.id,
      allocationMode: 'legacy',
    });
    expect(
      (await prisma.vpsProvider.findUniqueOrThrow({ where: { id: host.id } }))
        .maxInstances,
    ).toBeNull();
  });

  it('filters catalog by product, VPS, label/URL and explicit inactive state', async () => {
    await first.providers.deactivate(vpsId, other.id);
    expect(
      (await call('GET', `/admin/evolutions?vpsId=${vpsId}`))
        .json<Array<{ id: string }>>()
        .map((item) => item.id),
    ).toEqual([host.id]);
    expect(
      (
        await call(
          'GET',
          `/admin/evolutions?productId=${a.id}&search=ONE-${sequence}`,
        )
      )
        .json<Array<{ id: string }>>()
        .map((item) => item.id),
    ).toEqual([host.id]);
    expect(
      (await call('GET', `/admin/evolutions?vpsId=${vpsId}&isActive=false`))
        .json<Array<{ id: string }>>()
        .map((item) => item.id),
    ).toEqual([other.id]);
    expect(
      (await call('GET', '/admin/evolutions?isActive=maybe')).statusCode,
    ).toBe(400);
  });

  it('new DTOs reject cross-scope fields, empty credentials, absent revision and invalid limits', async () => {
    for (const payload of [
      { expectedRevision: 0, maxInstances: 0 },
      { expectedRevision: 0, providerApiKey: '' },
      { label: 'no-revision' },
      { expectedRevision: 0, productId: a.id },
    ])
      expect((await call('PUT', globalPath(), payload)).statusCode).toBe(400);
    expect(
      (
        await call('PUT', `${productPath()}/evolutions/${host.id}`, {
          expectedRevision: 0,
          maxInstances: 10,
        })
      ).statusCode,
    ).toBe(400);
    expect((await call('DELETE', globalPath())).statusCode).toBe(400);
  });

  it('rejects normalized duplicate URLs globally but preserves uncontrolled legacy aliases', async () => {
    expect(
      (
        await call('POST', '/admin/evolutions', {
          vpsId,
          label: 'alias',
          providerUrl: host.providerUrl + '/',
          providerApiKey: 'fixture',
        })
      ).statusCode,
    ).toBe(409);
    const alias = await first.providers.create(vpsId, {
      label: 'legacy-alias',
      providerUrl: host.providerUrl + '/',
      providerApiKey: 'fixture',
    });
    expect(alias.id).not.toBe(host.id);
    await expect(
      update(host, { confirmIdentity: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      update(host, { acceptingNewInstances: false }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents legacy alias creation against an explicitly controlled installation', async () => {
    await update(host, { acceptingNewInstances: false });
    const response = await call('POST', `/admin/vps/${vpsId}/providers`, {
      label: 'bypass',
      providerUrl: host.providerUrl + '/',
      providerApiKey: 'fixture',
    });
    expect(response.statusCode).toBe(409);
  });

  it('keeps credential omission and new read surfaces secret-free while invalidating all owners on rotation', async () => {
    const one = await local(a),
      two = await local(b);
    await update(host, { label: 'unchanged-key' });
    expect(
      (await first.providers.findAll(vpsId)).find((item) => item.id === host.id)
        ?.providerApiKey,
    ).toBe('fixture-provider-secret');
    for (const row of [one, two])
      values.set(instanceCacheKey(row.productId, 'id', row.id), {
        secret: 'cached',
      });
    const result = await update(host, {
      providerApiKey: 'rotated-fixture-secret',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /rotated-fixture-secret|callbackTokenEncrypted|providerApiKey/,
    );
    for (const row of [one, two])
      expect(values.has(instanceCacheKey(row.productId, 'id', row.id))).toBe(
        false,
      );
    expect(result.inventory.status).toBe('unknown');
  });

  it('redacts credentials embedded in legacy URLs only on new read DTOs', async () => {
    await prisma.vpsProvider.update({
      where: { id: host.id },
      data: {
        providerUrl:
          'https://user:secret-marker@example.invalid?key=secret-marker#secret-marker',
      },
    });
    expect(JSON.stringify(await first.admin.get(host.id))).not.toContain(
      'secret-marker',
    );
  });

  it('serializes competing provider revisions across replicas', async () => {
    const results = await Promise.allSettled([
      first.admin.update(host.id, { expectedRevision: 0, label: 'winner-a' }),
      second.admin.update(host.id, { expectedRevision: 0, label: 'winner-b' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(
      (await prisma.vpsProvider.findUniqueOrThrow({ where: { id: host.id } }))
        .configurationRevision,
    ).toBe(1);
  });

  it('legacy writes invalidate revision without clearing controls or reactivating a paused link', async () => {
    await update(host, { acceptingNewInstances: false });
    await first.admin.updateLink(a.id, host.id, {
      expectedRevision: 0,
      acceptingNewInstances: false,
      allocationPriority: 4,
    });
    const old = await first.admin.allocation(a.id);
    await first.products.update(a.id, { vpsProviderId: host.id });
    await first.providers.update(vpsId, host.id, { label: 'legacy-edited' });
    expect((await first.admin.get(host.id)).acceptingNewInstances).toBe(false);
    expect((await first.admin.links(a.id))[0].link).toMatchObject({
      acceptingNewInstances: false,
      allocationPriority: 4,
    });
    await expect(
      first.admin.setAllocation(a.id, {
        expectedRevision: old.configurationRevision,
        mode: 'legacy',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      first.admin.update(host.id, { expectedRevision: 1, label: 'stale' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('new deletion refuses default use while legacy uncontrolled deactivation keeps 200 and logical semantics', async () => {
    expect(
      (await call('DELETE', globalPath() + '?expectedRevision=0')).statusCode,
    ).toBe(409);
    const result = await call(
      'DELETE',
      `/admin/vps/${vpsId}/providers/${host.id}`,
    );
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ id: host.id, isActive: false });
    expect(await prisma.vpsProvider.count({ where: { id: host.id } })).toBe(1);
  });

  it('new deletion without use returns sanitized 200, not detach or physical deletion', async () => {
    const result = await call(
      'DELETE',
      globalPath(other) + '?expectedRevision=0',
    );
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ id: other.id, isActive: false });
    expect(result.body).not.toContain('providerApiKey');
    expect(await prisma.vpsProvider.count({ where: { id: other.id } })).toBe(1);
  });

  it.each(['providerUrl', 'isActive'] as const)(
    'protects controlled use from legacy %s mutation',
    async (field) => {
      await update(host, { acceptingNewInstances: false });
      const result = await call(
        'PUT',
        `/admin/vps/${vpsId}/providers/${host.id}`,
        {
          [field]:
            field === 'isActive' ? false : `https://moved-${sequence}.invalid`,
        },
      );
      expect(result.statusCode).toBe(409);
      expect(
        (await prisma.vpsProvider.findUniqueOrThrow({ where: { id: host.id } }))
          .providerUrl,
      ).toBe(host.providerUrl);
    },
  );

  it('permits new identity edits only without dependent references and resets preparation', async () => {
    expect(
      (
        await call('PUT', globalPath(), {
          expectedRevision: 0,
          providerUrl: 'https://new.invalid',
        })
      ).statusCode,
    ).toBe(409);
    await ready(other);
    await prisma.vpsProvider.update({
      where: { id: other.id },
      data: { callbackTokenEncrypted: 'existing-callback-material' },
    });
    const updated = await update(other, {
      providerUrl: `https://moved-${sequence}.invalid`,
    });
    expect(updated).toMatchObject({
      identityStatus: 'pending',
      callbackReadiness: 'pending',
      inventory: { status: 'unknown' },
    });
    expect(
      (await prisma.vpsProvider.findUniqueOrThrow({ where: { id: other.id } }))
        .callbackTokenEncrypted,
    ).toBe('existing-callback-material');
  });

  it('attaches shared installations paused, idempotently, without changing default or mode', async () => {
    const one = await attach(a),
      two = await attach(b);
    expect(one.link).toMatchObject({
      acceptingNewInstances: false,
      configurationRevision: 0,
    });
    expect(two.evolution.id).toBe(one.evolution.id);
    const repeated = await attach(a);
    expect(repeated.link).toEqual(one.link);
    expect(repeated.allocationRevision).toBe(one.allocationRevision);
    expect(
      await prisma.product.findUniqueOrThrow({ where: { id: a.id } }),
    ).toMatchObject({ vpsProviderId: host.id, allocationMode: 'legacy' });
    await expect(
      first.admin.attach(a.id, {
        vpsProviderId: other.id,
        expectedRevision: 0,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('serializes attach revisions across replicas and isolates link settings by product', async () => {
    const attempts = await Promise.allSettled([
      first.admin.attach(a.id, {
        vpsProviderId: other.id,
        expectedRevision: 0,
      }),
      second.admin.attach(a.id, {
        vpsProviderId: other.id,
        expectedRevision: 0,
      }),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await attach(b);
    const result = await call(
      'PUT',
      `${productPath()}/evolutions/${other.id}`,
      {
        expectedRevision: 0,
        allocationPriority: 2,
        acceptingNewInstances: true,
      },
    );
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      link: {
        allocationPriority: 2,
        acceptingNewInstances: true,
        configurationRevision: 1,
      },
      evolution: { maxInstances: null },
      allocationRevision: 2,
    });
    expect(
      (await first.admin.links(b.id)).find(
        (l) => l.link.vpsProviderId === other.id,
      )?.link,
    ).toMatchObject({ allocationPriority: 0, acceptingNewInstances: false });
    expect(
      (
        await call('PUT', `${productPath()}/evolutions/${other.id}`, {
          expectedRevision: 0,
          allocationPriority: 9,
        })
      ).statusCode,
    ).toBe(409);
  });

  it('detach preserves global provider, other products and terminal provisioning history', async () => {
    await attach(a);
    await attach(b);
    const history = await pending(a, other);
    await prisma.instanceProvisioning.update({
      where: { id: history.id },
      data: { state: 'failed', linkProductId: null, linkVpsProviderId: null },
    });
    const response = await call(
      'DELETE',
      `${productPath()}/evolutions/${other.id}?expectedRevision=0`,
    );
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(
      await prisma.productEvolution.count({
        where: { productId: a.id, vpsProviderId: other.id },
      }),
    ).toBe(0);
    expect(
      await prisma.productEvolution.count({
        where: { productId: b.id, vpsProviderId: other.id },
      }),
    ).toBe(1);
    expect(
      await prisma.instanceProvisioning.findUniqueOrThrow({
        where: { id: history.id },
      }),
    ).toMatchObject({
      productId: a.id,
      vpsProviderId: other.id,
      linkProductId: null,
      linkVpsProviderId: null,
      state: 'failed',
    });
    expect((await first.admin.get(other.id)).isActive).toBe(true);
  });

  it.each(['default', 'instance', 'pending'] as const)(
    'detach refuses %s use and preserves ownership',
    async (kind) => {
      await attach();
      const selected = kind === 'default' ? host : other;
      if (kind === 'instance') await local(a, other);
      if (kind === 'pending') await pending(a, other);
      expect(
        (
          await call(
            'DELETE',
            `${productPath()}/evolutions/${selected.id}?expectedRevision=0`,
          )
        ).statusCode,
      ).toBe(409);
      expect(
        await prisma.productEvolution.count({
          where: { productId: a.id, vpsProviderId: selected.id },
        }),
      ).toBe(1);
    },
  );

  it('requires unique identity, fresh inventory and writer confirmation before enabling a limit', async () => {
    await expect(
      update(host, { maxInstances: 10, writersCompatible: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    await ready();
    await expect(update(host, { maxInstances: 10 })).rejects.toBeInstanceOf(
      ConflictException,
    );
    const result = await update(host, {
      maxInstances: 10,
      writersCompatible: true,
    });
    expect(result).toMatchObject({
      maxInstances: 10,
      occupancy: { available: 10, limitConfigured: true },
    });
    expect((await first.admin.allocation(a.id)).mode).toBe('legacy');
    expect((await update(host, { label: 'limit-kept' })).maxInstances).toBe(10);
    await pending();
    expect(
      (await update(host, { maxInstances: null })).maxInstances,
    ).toBeNull();
    expect(
      await prisma.instanceProvisioning.count({
        where: { vpsProviderId: host.id },
      }),
    ).toBe(1);
  });

  it('counts all products, permits lowering below occupancy and never moves or removes sessions', async () => {
    const own = await local(a),
      foreign = await local(b);
    const ticket = await pending();
    await ready();
    const result = await update(host, {
      maxInstances: 1,
      writersCompatible: true,
    });
    expect(result.occupancy).toMatchObject({
      instances: 2,
      reservations: 1,
      effective: 3,
      available: 0,
      overLimit: true,
      byProduct: { [a.id]: 2, [b.id]: 1 },
    });
    expect(
      await prisma.instance.count({
        where: { id: { in: [own.id, foreign.id] }, vpsProviderId: host.id },
      }),
    ).toBe(2);
    expect(
      (
        await prisma.instanceProvisioning.findUniqueOrThrow({
          where: { id: ticket.id },
        })
      ).state,
    ).toBe('uncertain');
    const rejected = await call('POST', `${productPath()}/instances`, {
      instanceName: 'over-limit',
      qrcode: false,
    });
    expect(rejected.statusCode).toBe(503);
    expect(adapter.createInstance).not.toHaveBeenCalled();
  });

  it('does not double count committed reservations and differentiates unknown, full and unlimited', async () => {
    expect(await first.admin.getOccupancy(host.id)).toMatchObject({
      available: null,
      limitConfigured: false,
      inventory: { status: 'unknown' },
    });
    const row = await local();
    const ticket = await pending(a, host, row.instanceName);
    await prisma.instanceProvisioning.update({
      where: { id: ticket.id },
      data: {
        state: 'committed',
        linkProductId: null,
        linkVpsProviderId: null,
        providerInstanceId: row.providerInstanceId,
      },
    });
    await ready();
    await update(host, { maxInstances: 1, writersCompatible: true });
    expect(await first.admin.getOccupancy(host.id)).toMatchObject({
      effective: 1,
      reservations: 0,
      available: 0,
      overLimit: false,
    });
    await prisma.vpsProvider.update({
      where: { id: host.id },
      data: { inventoryObservedAt: new Date(0) },
    });
    expect(await first.admin.getOccupancy(host.id)).toMatchObject({
      available: null,
      overLimit: null,
      limitConfigured: true,
      inventory: { status: 'stale' },
    });
  });

  it('requires opt-in, writer confirmation, eligible link and relay readiness for capacity', async () => {
    await ready();
    const mode = () =>
      first.admin.setAllocation(a.id, {
        mode: 'capacity',
        expectedRevision: 0,
        writersCompatible: true,
      });
    await expect(mode()).rejects.toBeInstanceOf(ConflictException);
    config.set('EVOLUTION_ALLOCATION_ENABLED', true);
    await expect(
      first.admin.setAllocation(a.id, {
        mode: 'capacity',
        expectedRevision: 0,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await prisma.product.update({
      where: { id: a.id },
      data: { hubRelay: true },
    });
    expect((await first.admin.allocation(a.id)).order[0].blockers).toContain(
      'callback_unconfirmed',
    );
    await expect(mode()).rejects.toBeInstanceOf(ConflictException);
    await prisma.vpsProvider.update({
      where: { id: host.id },
      data: { callbackReadiness: 'ready' },
    });
    const result = await mode();
    expect(result).toMatchObject({
      mode: 'capacity',
      ready: true,
      defaultProviderId: host.id,
    });
    expect(result.order[0]).toMatchObject({
      eligible: true,
      maxInstances: null,
    });
    expect((await first.admin.allocation(b.id)).mode).toBe('legacy');
    const reverted = await first.admin.setAllocation(a.id, {
      mode: 'legacy',
      expectedRevision: result.configurationRevision,
    });
    expect(reverted.mode).toBe('legacy');
  });

  it('AR01 allows safe legacy return after capacity history without deleting that history', async () => {
    await ready();
    config.set('EVOLUTION_ALLOCATION_ENABLED', true);
    const enabled = await first.admin.setAllocation(a.id, {
      mode: 'capacity',
      expectedRevision: 0,
      writersCompatible: true,
    });
    await prisma.product.update({
      where: { id: a.id },
      data: { capacityFirstAllocationAt: new Date() },
    });
    const reverted = await first.admin.setAllocation(a.id, {
      mode: 'legacy',
      expectedRevision: enabled.configurationRevision,
    });
    expect(reverted.mode).toBe('legacy');
    expect(reverted.capacityFirstAllocationAt).not.toBeNull();
    expect(reverted.defaultProviderId).toBe(host.id);
  });

  it('global pause blocks both products but link pause affects only its own product', async () => {
    await first.admin.updateLink(a.id, host.id, {
      expectedRevision: 0,
      acceptingNewInstances: false,
    });
    const own = await call('POST', `${productPath()}/instances`, {
      instanceName: 'paused-own',
      qrcode: false,
    });
    expect(own.statusCode).toBe(503);
    const foreign = await call('POST', `${productPath(b)}/instances`, {
      instanceName: 'allowed-other',
      qrcode: false,
    });
    expect(foreign.statusCode).toBe(201);
    await update(host, { acceptingNewInstances: false });
    expect(
      (
        await call('POST', `${productPath(b)}/instances`, {
          instanceName: 'paused-all',
          qrcode: false,
        })
      ).statusCode,
    ).toBe(503);
    expect(
      await prisma.instance.count({
        where: {
          productId: b.id,
          instanceName: 'allowed-other',
          vpsProviderId: host.id,
        },
      }),
    ).toBe(1);
  });

  it('returns a durable 202, coalesces concurrent reconciliations and uses the existing recovery executor', async () => {
    const accepted = await call('POST', globalPath() + '/reconcile', {
      expectedRevision: 0,
    });
    expect(accepted.statusCode).toBe(202);
    const operation = accepted.json<{ operationId: string; status: string }>();
    expect(operation.status).toBe('pending');
    expect(adapter.fetchInstances).not.toHaveBeenCalled();
    const duplicate = await second.admin.reconcile(host.id, 0);
    expect(duplicate.operationId).toBe(operation.operationId);
    expect(
      await prisma.evolutionReconciliation.count({
        where: { vpsProviderId: host.id, status: 'pending' },
      }),
    ).toBe(1);
    // Leave unrelated synthetic work out of this explicit executor scan.
    await prisma.instanceProvisioning.updateMany({
      where: {
        state: { in: ['reserved', 'creating', 'uncertain', 'cleanup_pending'] },
      },
      data: { leaseExpiresAt: new Date(Date.now() + 60000) },
    });
    const recovery = new EvolutionRecoveryService(
      first.db,
      first.provisioning,
      first.inventory,
      adapters,
      config,
    );
    await recovery.scan();
    recovery.onModuleDestroy();
    expect(
      (await first.admin.reconciliation(host.id, operation.operationId)).status,
    ).toBe('completed');
    expect(
      (
        await call(
          'GET',
          globalPath(other) + '/reconciliations/' + operation.operationId,
        )
      ).statusCode,
    ).toBe(404);
    await update(host, { label: 'new-revision' });
    expect(
      (await call('POST', globalPath() + '/reconcile', { expectedRevision: 0 }))
        .statusCode,
    ).toBe(409);
  });

  it('sanitizes reconciliation failures and stored result fields', async () => {
    const operation = await first.admin.reconcile(host.id, 0);
    await prisma.evolutionReconciliation.update({
      where: { id: operation.operationId },
      data: {
        status: 'failed',
        errorCode: 'secret-marker',
        result: {
          unknownCount: 2,
          credential: 'secret-marker',
          absentInstanceIds: ['foreign-session'],
        },
      },
    });
    const response = await call(
      'GET',
      globalPath() + '/reconciliations/' + operation.operationId,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'failed',
      errorCode: 'inventory_not_confirmed',
      result: { unknownCount: 2 },
    });
    expect(response.body).not.toMatch(
      /secret-marker|foreign-session|credential/,
    );
  });

  it('lists only own or unassigned persisted import candidates and never queries the provider on GET', async () => {
    expect(await first.admin.candidates(a.id, host.id)).toMatchObject({
      items: [],
      asOf: null,
      inventoryStatus: 'unknown',
    });
    const own = await local(),
      foreign = await local(b, host, 'private-other-product');
    remote.get(host.providerUrl)!.push({
      id: 'unassigned-id',
      instanceName: 'unassigned',
      status: 'close',
      token: 'secret-marker',
    } as InstanceDto);
    remote.get(host.providerUrl)!.push({
      id: 'pending-id',
      instanceName: 'reserved',
      status: 'close',
    } as InstanceDto);
    await pending(a, host, 'reserved');
    await ready();
    adapter.fetchInstances.mockClear();
    const response = await call(
      'GET',
      `${productPath()}/evolutions/${host.id}/import-candidates`,
    );
    expect(response.statusCode).toBe(200);
    const candidates = response.json<{
      inventoryStatus: string;
      conflictCount: number;
      items: unknown[];
    }>();
    expect(candidates).toMatchObject({
      inventoryStatus: 'unresolved',
      conflictCount: 2,
    });
    expect(candidates.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerInstanceId: own.providerInstanceId,
          hubInstanceId: own.id,
          ownership: 'own',
        }),
        expect.objectContaining({
          providerInstanceId: 'unassigned-id',
          ownership: 'unassigned',
        }),
      ]),
    );
    expect(response.json<{ items: unknown[] }>().items).toHaveLength(2);
    expect(response.body).not.toMatch(/private-other-product|secret-marker/);
    expect(response.body).not.toContain(foreign.id);
    expect(adapter.fetchInstances).not.toHaveBeenCalled();
    expect(
      (
        await call(
          'GET',
          `${productPath()}/evolutions/${other.id}/import-candidates`,
        )
      ).statusCode,
    ).toBe(404);
  });

  it('serves placement metadata before the legacy dynamic instance route without leaking other owners', async () => {
    await attach();
    const firstRow = await local(),
      secondRow = await local(a, other);
    await local(b);
    const response = await call('GET', `${productPath()}/instances/placements`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instanceId: firstRow.id,
          vpsProviderId: host.id,
        }),
        expect.objectContaining({
          instanceId: secondRow.id,
          vpsProviderId: other.id,
        }),
      ]),
    );
    expect(response.json<unknown[]>()).toHaveLength(2);
    expect(response.body).not.toMatch(/providerApiKey|hubToken/);
    expect(adapter.fetchInstances).not.toHaveBeenCalled();
  });

  it('preserves the legacy invalid-provider 422 and unknown new resources return 404', async () => {
    expect(
      (await call('PUT', productPath(), { vpsProviderId: 'missing' }))
        .statusCode,
    ).toBe(422);
    expect((await call('GET', '/admin/evolutions/missing')).statusCode).toBe(
      404,
    );
    expect(
      (await call('GET', '/admin/products/missing/allocation')).statusCode,
    ).toBe(404);
  });

  it('rejects activation on an unconsolidated database even with an explicit writer acknowledgement', async () => {
    const rollback = new Error('rollback-test-ddl');
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'ALTER TABLE "Instance" DROP CONSTRAINT "Instance_productId_vpsProviderId_fkey"',
        );
        expect(await isEvolutionBaseConsolidated(tx)).toBe(false);
        await expect(assertWritersCompatible(tx, true)).rejects.toBeInstanceOf(
          ConflictException,
        );
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect((await first.admin.allocation(a.id)).databaseConsolidated).toBe(
      true,
    );
  });

  it('serializes legacy alias creation against new capacity controls', async () => {
    await ready();
    const results = await Promise.allSettled([
      second.providers.create(vpsId, {
        label: 'concurrent alias',
        providerUrl: host.providerUrl + '/',
        providerApiKey: 'fixture',
      }),
      first.admin.update(host.id, {
        expectedRevision: 1,
        maxInstances: 3,
        writersCompatible: true,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const current = await prisma.vpsProvider.findUniqueOrThrow({
      where: { id: host.id },
    });
    const aliasCount = await prisma.vpsProvider.count({
      where: { providerUrl: host.providerUrl + '/' },
    });
    expect(current.maxInstances !== null && aliasCount > 0).toBe(false);
  });

  it('revalidates an administrative pause after an in-flight creation preflight', async () => {
    let entered!: () => void, finish!: (rows: InstanceDto[]) => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const response = new Promise<InstanceDto[]>((resolve) => {
      finish = resolve;
    });
    adapter.fetchInstances.mockImplementationOnce(() => {
      entered();
      return response;
    });
    const attempt = first.provisioning.prepare(
      a.id,
      { instanceName: 'in-flight' },
      budget(),
    );
    const rejected = expect(attempt).rejects.toThrow();
    await started;
    await update(host, { acceptingNewInstances: false });
    finish([]);
    await rejected;
    expect(
      await prisma.instanceProvisioning.count({ where: { productId: a.id } }),
    ).toBe(0);
    expect(adapter.createInstance).not.toHaveBeenCalled();
  });

  it('applies admin-configured capacity transparently to the unchanged public create request and keeps old sessions sticky', async () => {
    const keyResult = await first.products.rotateKey(a.id);
    const legacy = await local(b);
    await attach();
    await ready(host);
    await ready(other);
    await update(host, { maxInstances: 1, writersCompatible: true });
    await first.admin.updateLink(a.id, host.id, {
      expectedRevision: 0,
      allocationPriority: 0,
    });
    await first.admin.updateLink(a.id, other.id, {
      expectedRevision: 0,
      allocationPriority: 1,
      acceptingNewInstances: true,
    });
    config.set('EVOLUTION_ALLOCATION_ENABLED', true);
    const policy = await first.admin.allocation(a.id);
    await first.admin.setAllocation(a.id, {
      mode: 'capacity',
      expectedRevision: policy.configurationRevision,
      writersCompatible: true,
    });
    const request = (instanceName: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/instance/create',
        headers: { apikey: keyResult.apiKey },
        payload: { instanceName, qrcode: false },
      });
    const created = await request('capacity-b');
    expect(created.statusCode).toBe(201);
    const body = created.json<{
      hubId: string;
      instanceId: string;
      instanceName: string;
    }>();
    expect(body.instanceName).toBe('capacity-b');
    expect(body.instanceId).not.toBe(body.hubId);
    expect(
      await prisma.instance.findUniqueOrThrow({ where: { id: body.hubId } }),
    ).toMatchObject({ vpsProviderId: other.id, productId: a.id });
    await prisma.instance.delete({ where: { id: legacy.id } });
    remote.set(host.providerUrl, []);
    await first.inventory.refresh(host.id, budget());
    const next = await request('capacity-a');
    expect(next.statusCode).toBe(201);
    expect(
      await prisma.instance.findUniqueOrThrow({
        where: { id: next.json<{ hubId: string }>().hubId },
      }),
    ).toMatchObject({ vpsProviderId: host.id });
    expect(
      await prisma.instance.findUniqueOrThrow({ where: { id: body.hubId } }),
    ).toMatchObject({ vpsProviderId: other.id });
    const current = await first.admin.allocation(a.id);
    await expect(
      first.admin.setAllocation(a.id, {
        mode: 'legacy',
        expectedRevision: current.configurationRevision,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await first.admin.allocation(b.id)).mode).toBe('legacy');
  });

  it('preserves Manager defaults, relay, batch and keys while editing shared global and link policies', async () => {
    const defaults = `${productPath()}/instance-defaults`;
    expect(
      (
        await call('PUT', defaults + '/webhook', {
          enabled: true,
          url: 'https://callback.invalid',
          byEvents: true,
          base64: true,
          events: ['CONNECTION_UPDATE'],
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call('PUT', defaults + '/proxy', {
          enabled: true,
          host: 'proxy.invalid',
          port: '80',
          protocol: 'http',
          username: 'fixture',
          password: 'fixture-password',
        })
      ).statusCode,
    ).toBe(200);
    await first.products.update(a.id, {
      batchWebhookEnabled: true,
      batchWebhookUrl: 'https://batch.invalid',
    });
    const before = {
      webhook: await prisma.productDefaultWebhook.findUnique({
        where: { productId: a.id },
      }),
      proxy: await prisma.productDefaultProxy.findUnique({
        where: { productId: a.id },
      }),
      product: await prisma.product.findUniqueOrThrow({ where: { id: a.id } }),
    };
    const previousProxyResponse = (await call('GET', defaults + '/proxy')).body;
    await update(host, { label: 'shared-new-label' });
    await attach(a);
    await attach(b);
    await first.admin.updateLink(b.id, other.id, {
      expectedRevision: 0,
      allocationPriority: 10,
      acceptingNewInstances: true,
    });
    expect(
      await prisma.productDefaultWebhook.findUnique({
        where: { productId: a.id },
      }),
    ).toEqual(before.webhook);
    expect(
      await prisma.productDefaultProxy.findUnique({
        where: { productId: a.id },
      }),
    ).toEqual(before.proxy);
    const after = await prisma.product.findUniqueOrThrow({
      where: { id: a.id },
    });
    expect(after).toMatchObject({
      apiKeyHash: before.product.apiKeyHash,
      hubRelay: before.product.hubRelay,
      batchWebhookEnabled: true,
      batchWebhookUrl: 'https://batch.invalid',
      vpsProviderId: host.id,
    });
    expect((await call('GET', defaults + '/proxy')).body).toBe(
      previousProxyResponse,
    );
    expect((await call('DELETE', defaults + '/proxy')).statusCode).toBe(204);
    expect((await call('DELETE', defaults + '/webhook')).statusCode).toBe(204);
  });
});
