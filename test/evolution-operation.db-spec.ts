import {
  BadGatewayException,
  ConflictException,
  Logger,
  NotFoundException,
  RequestTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient, Product, VpsProvider } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHmac } from 'node:crypto';
import { Queue } from 'bullmq';
import axios from 'axios';
import { PrismaService } from '../src/prisma/prisma.service';
import { CacheService } from '../src/cache/cache.service';
import { instanceCacheKey } from '../src/cache/instance-cache';
import {
  decryptAES256GCM,
  encryptAES256GCM,
  hashSHA256,
  signJwt,
} from '../src/common/crypto.util';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { QrRequestContext } from '../src/common/qr-request-context';
import { AdapterResolverService } from '../src/providers/adapter-resolver.service';
import {
  EvolutionHttpService,
  QrHttpOptions,
} from '../src/adapters/evolution/evolution.http';
import { EvolutionAdapter } from '../src/adapters/evolution/evolution.adapter';
import { InstanceResolverService } from '../src/resolver/instance.resolver';
import { InstanceController } from '../src/modules/instance/instance.controller';
import { InstanceService } from '../src/modules/instance/instance.service';
import { AdminInstancesController } from '../src/modules/admin/instances/admin-instances.controller';
import { AdminInstancesService } from '../src/modules/admin/instances/admin-instances.service';
import { ProductsService } from '../src/modules/admin/products/products.service';
import { VpsProviderService } from '../src/modules/admin/vps/vps-provider.service';
import { MessageService } from '../src/modules/message/message.service';
import { EvolutionProvisioningService } from '../src/modules/provisioning/evolution-provisioning.service';
import { EvolutionInventoryService } from '../src/modules/provisioning/evolution-inventory.service';
import { InternalWebhookController } from '../src/modules/queue/internal-webhook.controller';
import { RelayIngressService } from '../src/modules/queue/relay-ingress.service';
import {
  RelayWorker,
  RelayJobPayload,
} from '../src/modules/queue/relay.worker';
import { WebhookService } from '../src/modules/webhook/webhook.service';
import {
  relayWebhook,
  RELAY_TOKEN_HEADER,
} from '../src/modules/webhook/relay-configuration';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL required');
const address = new URL(url);
if (
  !['localhost', '127.0.0.1'].includes(address.hostname) ||
  !/^\/softconnect_phase03_test_[a-z0-9_]+$/.test(address.pathname) ||
  (address.searchParams.get('schema') ?? 'public') !== 'public'
)
  throw new Error('Only a dedicated empty local phase03 database is allowed');
const prisma = new PrismaClient({ datasources: { db: { url } } });
const replica = new PrismaClient({ datasources: { db: { url } } });
const db = prisma as PrismaService;
const key = 'a'.repeat(64),
  apiKey = 'phase03-api-key',
  jwt = 'phase03-jwt-key';
const config = new ConfigService({
  ENCRYPTION_KEY: key,
  JWT_SECRET: jwt,
  HUB_BASE_URL: 'https://hub.invalid/api/v1',
  PROXY_TIMEOUT_MS: 10000,
});
let sequence = 0;
let app: NestFastifyApplication | undefined;
let a: Product, b: Product, hosts: VpsProvider[], ip: string;
let service: InstanceService,
  admin: AdminInstancesService,
  resolver: InstanceResolverService;
let ingress: RelayIngressService, worker: RelayWorker;
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
const remote = new Map<string, Array<Record<string, unknown>>>();
const http = {
  request: jest.fn<
    Promise<unknown>,
    [
      string,
      string,
      string,
      string,
      unknown?,
      { instanceName: string }?,
      QrHttpOptions?,
    ]
  >(),
};
const adapter = new EvolutionAdapter(http as unknown as EvolutionHttpService);
const adapters = {
  resolve: () => adapter,
} as unknown as AdapterResolverService;
const queued = new Map<string, RelayJobPayload>();
const queue = {
  add: jest.fn(
    (_: string, payload: RelayJobPayload, options: { jobId: string }) => {
      if (!queued.has(options.jobId)) queued.set(options.jobId, payload);
      return Promise.resolve({ id: options.jobId });
    },
  ),
};

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
function auth(p = a) {
  return { ...p, productId: p.id };
}
async function linkedProduct(name: string, providers: VpsProvider[]) {
  return prisma.$transaction(async (tx) => {
    const p = await tx.product.create({
      data: {
        name,
        slug: name,
        apiKeyHash: hashSHA256(name),
        origins: [],
        hubRelay: true,
        vpsProviderId: null,
      },
    });
    await tx.productEvolution.createMany({
      data: providers.map((provider) => ({
        productId: p.id,
        vpsProviderId: provider.id,
        acceptingNewInstances: provider.id === providers[0].id,
      })),
    });
    return tx.product.update({
      where: { id: p.id },
      data: { vpsProviderId: providers[0].id },
    });
  });
}
async function instance(
  p = a,
  provider = hosts[0],
  name = `session-${randomUUID()}`,
  external: string = randomUUID(),
) {
  const row = await prisma.instance.create({
    data: {
      productId: p.id,
      vpsProviderId: provider.id,
      instanceName: name,
      providerInstanceId: external,
      hubToken: randomUUID(),
    },
  });
  remote.get(provider.providerUrl)!.push({
    id: external,
    name,
    connectionStatus: 'open',
    ownerJid: '5511999990000@s.whatsapp.net',
    number: null,
    token: 'fixture',
  });
  return row;
}
async function provision(provider: VpsProvider, p: Product, name: string) {
  return prisma.instanceProvisioning.create({
    data: {
      productId: p.id,
      vpsProviderId: provider.id,
      linkProductId: p.id,
      linkVpsProviderId: provider.id,
      instanceName: name,
      requestHash: 'fixture',
      state: 'creating',
    },
  });
}
async function callbackToken(provider = hosts[0]) {
  const configuration = await relayWebhook(db, config, provider.id, {
    enabled: true,
    url: '',
    events: ['CONNECTION_UPDATE'],
  });
  return configuration.headers![RELAY_TOKEN_HEADER];
}
async function httpApp() {
  values.set(`auth:${hashSHA256(apiKey)}`, auth());
  const module = await Test.createTestingModule({
    controllers: [
      InstanceController,
      AdminInstancesController,
      InternalWebhookController,
    ],
    providers: [
      { provide: InstanceService, useValue: service },
      { provide: AdminInstancesService, useValue: admin },
      { provide: RelayIngressService, useValue: ingress },
      { provide: PrismaService, useValue: db },
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
  return app;
}
const adminHeaders = () => ({
  authorization: `Bearer ${signJwt({ sub: 'fixture' }, jwt, 3600)}`,
});

describe('Phase03 — shared hosts, contracts and durable relay', () => {
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
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  beforeEach(async () => {
    values.clear();
    remote.clear();
    queued.clear();
    jest.clearAllMocks();
    config.set('RELAY_TRUSTED_PROXY_IPS', '');
    config.set('PROXY_TIMEOUT_MS', 10000);
    ip = `198.51.100.${++sequence}`;
    const vps = await prisma.vpsServer.create({
      data: {
        label: `fixture-${sequence}`,
        subdomain: `fixture-${sequence}.invalid`,
        ip,
      },
    });
    hosts = [];
    for (const name of ['a', 'b', 'unused']) {
      const provider = await prisma.vpsProvider.create({
        data: {
          vpsId: vps.id,
          label: name,
          providerUrl: `https://${name}-${sequence}.invalid`,
          providerApiKey: encryptAES256GCM('fixture-key', key),
        },
      });
      hosts.push(provider);
      remote.set(provider.providerUrl, []);
    }
    a = await linkedProduct(`a-${sequence}`, hosts);
    b = await linkedProduct(`b-${sequence}`, [hosts[0]]);
    http.request
      .mockReset()
      .mockImplementation(
        (
          _method: string,
          host: string,
          _key: string,
          endpoint: string,
          _body?: unknown,
          query?: { instanceName: string },
        ) => {
          if (endpoint === '/instance/fetchInstances')
            return Promise.resolve(
              remote
                .get(host)!
                .filter((row) => !query || row.name === query.instanceName),
            );
          if (endpoint.startsWith('/instance/connectionState'))
            return Promise.resolve({ instance: { state: 'open' } });
          if (endpoint.startsWith('/instance/connect'))
            return Promise.resolve({ base64: 'fixture-qr' });
          if (endpoint.startsWith('/webhook/find'))
            return Promise.resolve({
              webhook: {
                enabled: true,
                url: 'https://client.invalid',
                byEvents: true,
                base64: false,
                headers: { 'X-Custom': 'fixture' },
              },
            });
          return Promise.resolve({});
        },
      );
    resolver = new InstanceResolverService(
      cache,
      db,
      config as unknown as ConstructorParameters<
        typeof InstanceResolverService
      >[2],
    );
    const provisioning = new EvolutionProvisioningService(
      db,
      new EvolutionInventoryService(db, adapters, config),
      adapters,
      config,
      cache,
    );
    service = new InstanceService(
      db,
      cache,
      adapters,
      resolver,
      config,
      provisioning,
    );
    admin = new AdminInstancesService(
      db,
      service,
      {} as MessageService,
      http as unknown as EvolutionHttpService,
      config,
      cache,
    );
    ingress = new RelayIngressService(db, config, queue as unknown as Queue);
    worker = new RelayWorker(config, db, ingress);
    queue.add.mockImplementation((_, payload, options) => {
      if (!queued.has(options.jobId)) queued.set(options.jobId, payload);
      return Promise.resolve({ id: options.jobId });
    });
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
    await worker.onModuleDestroy();
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await replica.$disconnect();
  });

  it('lists only registered sessions of A on its original hosts and enriches number', async () => {
    const first = await instance(),
      second = await instance(a, hosts[1]);
    await instance(b);
    remote
      .get(hosts[0].providerUrl)!
      .push({ id: 'unknown', name: 'unowned', token: 'hidden' });
    const result = await service.listInstances(auth());
    expect(result.map((row) => row.hubId)).toEqual([second.id, first.id]);
    expect(result.every((row) => row.number === '5511999990000')).toBe(true);
    expect(http.request.mock.calls.map((call) => call[1])).toEqual(
      expect.arrayContaining(hosts.slice(0, 2).map((host) => host.providerUrl)),
    );
    expect(http.request).toHaveBeenCalledTimes(2);
    expect(await prisma.instance.count({ where: { productId: a.id } })).toBe(2);
  });

  it('keeps legacy list on the default host despite extra links and filters only required hosts', async () => {
    const row = await instance(a, hosts[0], 'filter-me');
    await service.listInstances(auth());
    expect(http.request).toHaveBeenCalledTimes(1);
    await instance(a, hosts[1], 'other');
    http.request.mockClear();
    expect(
      (await service.listInstances(auth(), 'filter')).map((item) => item.hubId),
    ).toEqual([row.id]);
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(http.request.mock.calls[0][1]).toBe(hosts[0].providerUrl);
  });

  it('fails the whole aggregate if a required host fails and preserves timeout status', async () => {
    await instance();
    await instance(a, hosts[1]);
    http.request.mockImplementation((_method, host) =>
      host === hosts[1].providerUrl
        ? Promise.reject(new NotFoundException())
        : Promise.resolve(remote.get(host)),
    );
    await expect(service.listInstances(auth())).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    http.request.mockRejectedValue(new RequestTimeoutException());
    await expect(service.listInstances(auth())).rejects.toBeInstanceOf(
      RequestTimeoutException,
    );
  });

  it('limits concurrent host requests and uses one finite budget', async () => {
    const fourth = await prisma.vpsProvider.create({
      data: {
        vpsId: hosts[0].vpsId,
        label: 'fourth',
        providerUrl: `https://fourth-${sequence}.invalid`,
        providerApiKey: encryptAES256GCM('fixture-key', key),
      },
    });
    await prisma.productEvolution.create({
      data: { productId: a.id, vpsProviderId: fourth.id },
    });
    remote.set(fourth.providerUrl, []);
    hosts.push(fourth);
    for (const host of hosts) await instance(a, host);
    let active = 0,
      peak = 0;
    const budgets = new Set<unknown>();
    http.request.mockImplementation(
      async (_method, host, _key, _endpoint, _data, _query, options) => {
        budgets.add(options?.execution);
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active--;
        return remote.get(host);
      },
    );
    await service.listInstances(auth());
    expect(peak).toBeLessThanOrEqual(3);
    expect(budgets.size).toBe(1);
    expect(http.request).toHaveBeenCalledTimes(4);
  });

  it('preserves Data/Admin GET contracts, scoped IDs and operation host when admission is paused', async () => {
    const row = await instance(a, hosts[1]);
    const foreign = await instance(b);
    await prisma.vpsProvider.update({
      where: { id: hosts[1].id },
      data: {
        acceptingNewInstances: false,
        maxInstances: 1,
        isHealthy: false,
        isActive: false,
      },
    });
    const server = await httpApp();
    for (const [path, headers] of [
      [`/api/v1/instance/${row.id}`, { apikey: apiKey }],
      [
        `/api/v1/admin/products/${a.id}/instances/${row.providerInstanceId}`,
        adminHeaders(),
      ],
    ] as const) {
      const response = await server.inject({
        method: 'GET',
        url: path,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: row.providerInstanceId,
        hubId: row.id,
        number: '5511999990000',
      });
    }
    expect(
      (
        await server.inject({
          method: 'GET',
          url: `/api/v1/instance/${foreign.id}`,
          headers: { apikey: apiKey },
        })
      ).statusCode,
    ).toBe(404);
    await service.getConnectionState(auth(), row.id);
    expect(http.request.mock.calls.at(-1)?.[1]).toBe(hosts[1].providerUrl);
    expect(
      (await prisma.instance.findUniqueOrThrow({ where: { id: row.id } }))
        .vpsProviderId,
    ).toBe(hosts[1].id);
  });

  it('detects external ID collisions across hosts even after an earlier cache hit is invalidated by import', async () => {
    const first = await instance(a, hosts[0], 'one', 'same-external');
    await resolver.resolveById(a.id, first.providerInstanceId!);
    remote
      .get(hosts[1].providerUrl)!
      .push({ id: 'same-external', name: 'two', token: 'fixture' });
    await admin.importSingleInstance(a.id, {
      id: 'same-external',
      name: 'two',
      token: 'fixture',
      vpsProviderId: hosts[1].id,
    });
    await expect(
      resolver.resolveById(a.id, 'same-external'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.deleteInstance(auth(), 'same-external'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(http.request.mock.calls.every((call) => call[0] === 'get')).toBe(
      true,
    );
  });

  it('invalidates all aliases of all products when shared provider credentials change', async () => {
    const own = await instance(),
      foreign = await instance(b);
    for (const row of [own, foreign]) {
      await resolver.resolveById(row.productId, row.id);
      await resolver.resolve(row.productId, row.instanceName);
    }
    await new VpsProviderService(db, config, cache).update(
      hosts[0].vpsId,
      hosts[0].id,
      { providerApiKey: 'new-fixture' },
    );
    for (const row of [own, foreign]) {
      expect(values.has(instanceCacheKey(row.productId, 'id', row.id))).toBe(
        false,
      );
      expect(
        (await resolver.resolve(row.productId, row.instanceName))
          .providerApiKey,
      ).toBe('new-fixture');
    }
  });

  it('preserves old bulk without body on a shared default and reports foreign sessions/reservations as errors', async () => {
    await instance(b, hosts[0], 'owned');
    await provision(hosts[0], b, 'pending');
    remote
      .get(hosts[0].providerUrl)!
      .push(
        { id: 'free-id', name: 'free', token: 'fixture' },
        { id: 'pending-id', name: 'pending' },
      );
    const server = await httpApp();
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/admin/products/${a.id}/instances/import/bulk`,
      headers: adminHeaders(),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      created: 1,
      skipped: 0,
      errors: 2,
    });
    expect(response.json<{ details: unknown[] }>().details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instanceName: 'free',
          result: 'created',
          hubInstanceId: expect.any(String) as unknown,
        }),
        expect.objectContaining({
          instanceName: 'owned',
          result: 'error',
          reason: expect.any(String) as unknown,
        }),
      ]),
    );
    expect(await prisma.instance.count({ where: { productId: a.id } })).toBe(1);
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it('supports optional host/subset, rejects empty selection, and never imports other hosts implicitly', async () => {
    remote
      .get(hosts[0].providerUrl)!
      .push({ id: 'default-id', name: 'default' });
    remote
      .get(hosts[1].providerUrl)!
      .push(
        { id: 'selected-id', name: 'selected' },
        { id: 'excluded-id', name: 'excluded' },
      );
    const server = await httpApp();
    const path = `/api/v1/admin/products/${a.id}/instances/import/bulk?vpsProviderId=${hosts[1].id}`;
    expect(
      (
        await server.inject({
          method: 'POST',
          url: path,
          headers: adminHeaders(),
          payload: { instanceIds: [] },
        })
      ).statusCode,
    ).toBe(400);
    expect(http.request).not.toHaveBeenCalled();
    const response = await server.inject({
      method: 'POST',
      url: path,
      headers: adminHeaders(),
      payload: { instanceIds: ['selected-id'] },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      created: 1,
      skipped: 0,
      errors: 0,
    });
    expect(await prisma.instance.count({ where: { productId: a.id } })).toBe(1);
    expect(
      (await prisma.instance.findFirstOrThrow({ where: { productId: a.id } }))
        .vpsProviderId,
    ).toBe(hosts[1].id);
  });

  it('imports above an explicit ceiling and skips only the same session, owner and host', async () => {
    await prisma.vpsProvider.update({
      where: { id: hosts[0].id },
      data: { maxInstances: 1, acceptingNewInstances: false },
    });
    await instance(b);
    remote
      .get(hosts[0].providerUrl)!
      .push({ id: 'new-id', name: 'existing-remote', token: 'fixture' });
    const dto = {
      id: 'new-id',
      name: 'existing-remote',
      token: 'untrusted-client-token',
    };
    const result = await admin.importSingleInstance(a.id, dto);
    expect(result.result).toBe('created');
    expect(await admin.importSingleInstance(a.id, dto)).toEqual({
      ...result,
      result: 'skipped',
    });
    expect(
      (
        await prisma.instance.findUniqueOrThrow({
          where: { id: result.hubInstanceId },
        })
      ).instanceToken,
    ).toBe('fixture');
  });

  it('checks remote identity, link and fresh ownership rather than trusting import body', async () => {
    const foreign = await instance(b, hosts[0], 'foreign');
    await expect(
      admin.importSingleInstance(a.id, {
        id: foreign.providerInstanceId!,
        name: foreign.instanceName,
        token: 'fixture',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      admin.importSingleInstance(b.id, {
        id: 'wrong',
        name: 'wrong',
        token: 'fixture',
        vpsProviderId: hosts[1].id,
      }),
    ).rejects.toThrow('Provider não vinculado');
    await expect(
      admin.importSingleInstance(a.id, {
        id: 'wrong',
        name: 'wrong',
        token: 'fixture',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.instance.count({ where: { productId: a.id } })).toBe(0);
  });

  it('serializes competing imports across products with two database connections', async () => {
    remote.get(hosts[0].providerUrl)!.push({ id: 'race-id', name: 'race' });
    const other = new AdminInstancesService(
      replica as PrismaService,
      service,
      {} as MessageService,
      http as unknown as EvolutionHttpService,
      config,
      cache,
    );
    const dto = { id: 'race-id', name: 'race', token: 'fixture' };
    const results = await Promise.allSettled([
      admin.importSingleInstance(a.id, dto),
      other.importSingleInstance(b.id, dto),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await prisma.instance.count({ where: { vpsProviderId: hosts[0].id } }),
    ).toBe(1);
  });

  it('keeps local evidence when delete fails and releases it only after confirmed remote deletion', async () => {
    const row = await instance();
    await resolver.resolve(a.id, row.instanceName);
    http.request.mockRejectedValueOnce(new BadGatewayException());
    await expect(service.deleteInstance(auth(), row.id)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(
      await prisma.instance.findUnique({ where: { id: row.id } }),
    ).not.toBeNull();
    await service.deleteInstance(auth(), row.id);
    expect(
      await prisma.instance.findUnique({ where: { id: row.id } }),
    ).toBeNull();
    expect(values.has(instanceCacheKey(a.id, 'name', row.instanceName))).toBe(
      false,
    );
  });

  it('uses provider-specific callback credentials and never trusts product declared in the event body', async () => {
    const row = await instance();
    const token = await callbackToken();
    const server = await httpApp();
    const body = {
      event: 'connection.update',
      instance: row.instanceName,
      productId: b.id,
      data: { state: 'open' },
    };
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/internal/webhook/evolution/${hosts[0].id}/connection-update`,
      headers: { 'x-hub-relay-token': token },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });
    expect([...queued.values()][0]).toMatchObject({
      version: 2,
      providerId: hosts[0].id,
      productId: a.id,
      instanceId: row.id,
      body,
    });
    expect(
      (
        await prisma.vpsProvider.findUniqueOrThrow({
          where: { id: hosts[0].id },
        })
      ).callbackReadiness,
    ).toBe('ready');
    const event = await prisma.pendingRelayEvent.findFirstOrThrow({
      where: { instanceId: row.id },
    });
    expect(event.encryptedPayload).not.toContain(row.instanceName);
  });

  it('rejects absent/wrong tokens and tokens belonging to another installation on the same IP', async () => {
    const row = await instance();
    const token = await callbackToken();
    const server = await httpApp();
    for (const [id, candidate] of [
      [hosts[0].id, undefined],
      [hosts[0].id, 'wrong'],
      [hosts[1].id, token],
    ] as const) {
      expect(
        (
          await server.inject({
            method: 'POST',
            url: `/api/v1/internal/webhook/evolution/${id}`,
            headers: candidate ? { 'x-hub-relay-token': candidate } : {},
            payload: { instance: row.instanceName },
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(queued.size).toBe(0);
  });

  it.each([
    ['product prefixes', 'softcomshop_test', 'softmov_test'],
    ['no product prefixes', 'arbitrary-name', 'another-name'],
  ])(
    'delivers legacy callbacks on a shared IP with %s',
    async (_label, nameA, nameB) => {
      const own = await instance(a, hosts[1], nameA);
      const other = await instance(b, hosts[0], nameB);
      // Installing new callback credentials must not disable the old callback route.
      await callbackToken(hosts[0]);
      await callbackToken(hosts[1]);
      await prisma.webhookConfig.createMany({
        data: [a, b].map((product, index) => ({
          productId: product.id,
          url: `https://client-${index}.invalid`,
          secret: `secret-${index}`,
          events: ['CONNECTION_UPDATE'],
        })),
      });
      const server = await httpApp();
      const post = jest.spyOn(axios, 'post').mockResolvedValue({ status: 200 });
      const rows = [own, other];
      for (const [index, row] of rows.entries()) {
        const body = {
          event: 'connection.update',
          instance: row.instanceName,
          data: { state: 'open' },
        };
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/internal/webhook/evolution',
          remoteAddress: ip,
          payload: body,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ received: true });
        const job = [...queued.values()][index];
        expect(job).toMatchObject({
          providerId: row.vpsProviderId,
          productId: row.productId,
          instanceId: row.id,
          body,
        });
        await worker['relay'](job);
        expect(post).toHaveBeenNthCalledWith(
          index + 1,
          `https://client-${index}.invalid`,
          body,
          expect.any(Object),
        );
      }
      expect(post).toHaveBeenCalledTimes(2);
      expect(
        await prisma.pendingRelayEvent.count({
          where: {
            instanceId: { in: rows.map((row) => row.id) },
            state: 'delivered',
          },
        }),
      ).toBe(2);
    },
  );

  it('preserves trusted unambiguous legacy callbacks but retains collisions on the same IP', async () => {
    const own = await instance(a, hosts[0], 'unique');
    await ingress.receiveLegacy(
      'evolution',
      { instance: own.instanceName },
      { ip, headers: {} },
    );
    expect([...queued.values()][0].productId).toBe(a.id);
    await instance(a, hosts[1], 'collision');
    await instance(b, hosts[0], 'collision');
    await ingress.receiveLegacy(
      'evolution',
      { instance: 'collision' },
      { ip, headers: {} },
    );
    expect(queued.size).toBe(1);
    expect(
      await prisma.pendingRelayEvent.count({
        where: { instanceName: 'collision', state: 'retained' },
      }),
    ).toBe(1);
  });

  it('ignores spoofed forwarded IP and accepts only an explicit trusted proxy chain', async () => {
    const row = await instance();
    const request = { ip: '203.0.113.8', headers: { 'x-forwarded-for': ip } };
    await expect(
      ingress.receiveLegacy(
        'evolution',
        { instance: row.instanceName },
        request,
      ),
    ).rejects.toThrow('IP não autorizado');
    config.set('RELAY_TRUSTED_PROXY_IPS', '203.0.113.8');
    await ingress.receiveLegacy(
      'evolution',
      { instance: row.instanceName },
      request,
    );
    expect(queued.size).toBe(1);
  });

  it('retains early events durably and recovers only the original provisioning identity after restart', async () => {
    const pending = await provision(hosts[0], a, 'early');
    const token = await callbackToken();
    await ingress.receiveAuthenticated(hosts[0].id, token, {
      instance: 'early',
      instanceId: 'early-id',
    });
    expect(queued.size).toBe(0);
    const row = await instance(a, hosts[0], 'early', 'early-id');
    await prisma.instanceProvisioning.update({
      where: { id: pending.id },
      data: {
        instanceId: row.id,
        providerInstanceId: row.providerInstanceId,
        state: 'committed',
        linkProductId: null,
        linkVpsProviderId: null,
      },
    });
    const restarted = new RelayIngressService(
      replica as PrismaService,
      config,
      queue as unknown as Queue,
    );
    await restarted.recoverPending();
    expect(
      [...queued.values()].find((item) => item.instanceId === row.id),
    ).toMatchObject({ productId: a.id });
  });

  it('retains an early event when its original provisioning ends instead of assigning a later namesake', async () => {
    const pending = await provision(hosts[0], a, 'ended');
    const token = await callbackToken();
    await ingress.receiveAuthenticated(hosts[0].id, token, {
      instance: 'ended',
    });
    await prisma.instanceProvisioning.update({
      where: { id: pending.id },
      data: {
        state: 'failed',
        linkProductId: null,
        linkVpsProviderId: null,
      },
    });
    await instance(b, hosts[0], 'ended');
    await ingress.recoverPending();
    expect(queued.size).toBe(0);
    expect(
      await prisma.pendingRelayEvent.count({
        where: {
          instanceName: 'ended',
          state: 'retained',
          errorCode: 'provisioning_ended',
        },
      }),
    ).toBe(1);
  });

  it('recovers a queue publication failure and deduplicates concurrent publishers by durable event ID', async () => {
    const row = await instance();
    const token = await callbackToken();
    queue.add.mockRejectedValueOnce(new Error('queue unavailable'));
    await ingress.receiveAuthenticated(hosts[0].id, token, {
      instance: row.instanceName,
    });
    expect(
      await prisma.pendingRelayEvent.count({
        where: { instanceId: row.id, state: 'pending' },
      }),
    ).toBe(1);
    await Promise.all([
      ingress.recoverPending(),
      new RelayIngressService(
        replica as PrismaService,
        config,
        queue as unknown as Queue,
      ).recoverPending(),
    ]);
    expect(
      [...queued.values()].filter((item) => item.instanceId === row.id),
    ).toHaveLength(1);
  });

  it('retains old jobs without origin and refuses to reinterpret a deleted/recreated session', async () => {
    await ingress.retainLegacyJob(
      { adapterType: 'evolution', instanceName: 'legacy', body: {} },
      randomUUID(),
    );
    const row = await instance();
    const token = await callbackToken();
    await ingress.receiveAuthenticated(hosts[0].id, token, {
      instance: row.instanceName,
    });
    const payload = [...queued.values()][0];
    await prisma.instance.delete({ where: { id: row.id } });
    await instance(b, hosts[0], row.instanceName);
    expect(await ingress.validateJob(payload)).toBeNull();
    expect(
      await prisma.pendingRelayEvent.count({
        where: { instanceName: 'legacy', state: 'retained' },
      }),
    ).toBeGreaterThan(0);
  });

  it('delivers the unchanged body with the owning product HMAC and filters its events', async () => {
    const row = await instance();
    const token = await callbackToken();
    const body = {
      event: 'connection.update',
      instance: row.instanceName,
      data: { state: 'open' },
    };
    await prisma.webhookConfig.create({
      data: {
        productId: a.id,
        url: 'https://a-client.invalid',
        secret: 'a-secret',
        events: ['CONNECTION_UPDATE'],
      },
    });
    await prisma.webhookConfig.create({
      data: {
        productId: b.id,
        url: 'https://b-client.invalid',
        secret: 'b-secret',
        events: [],
      },
    });
    await ingress.receiveAuthenticated(hosts[0].id, token, body);
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ status: 200 });
    await worker['relay']([...queued.values()][0]);
    expect(post).toHaveBeenCalledWith(
      'https://a-client.invalid',
      body,
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature': `sha256=${createHmac('sha256', 'a-secret').update(JSON.stringify(body)).digest('hex')}`,
        },
      }),
    );
    expect(
      await prisma.pendingRelayEvent.count({
        where: { instanceId: row.id, state: 'delivered' },
      }),
    ).toBe(1);
  });

  it.each([false, true])(
    'syncs absent webhooks on the original hosts with hubRelay=%s',
    async (hubRelay) => {
      await prisma.product.update({ where: { id: a.id }, data: { hubRelay } });
      const own = await instance(a, hosts[0], 'arbitrary-name');
      const second = await instance(a, hosts[1], 'another-name');
      const other = await instance(b, hosts[0]);
      const output = await prisma.webhookConfig.create({
        data: {
          productId: a.id,
          url: 'https://client.invalid',
          secret: 'fixture-secret',
          events: ['CONNECTION_UPDATE'],
        },
      });
      http.request.mockImplementation((_method, _host, _key, endpoint) =>
        Promise.resolve(endpoint.startsWith('/webhook/find/') ? null : {}),
      );
      const result = await new ProductsService(
        db,
        cache,
        config,
        adapters,
      ).syncRelay(a.id);
      expect(result).toEqual({
        total: 2,
        synced: 2,
        failed: 0,
        targetUrl: hubRelay
          ? 'https://hub.invalid/api/v1/internal/webhook/evolution'
          : output.url,
      });
      const writes = http.request.mock.calls.filter(
        (call) => call[0] === 'post',
      );
      expect(writes).toHaveLength(2);
      for (const [index, row] of [own, second].entries()) {
        const write = writes.find(
          (call) => call[3] === `/webhook/set/${row.instanceName}`,
        )!;
        expect(write[1]).toBe(hosts[index].providerUrl);
        const configured = write[4] as {
          webhook: { url: string; headers?: Record<string, string> };
        };
        expect(configured.webhook).toMatchObject({
          url: hubRelay
            ? `https://hub.invalid/api/v1/internal/webhook/evolution/${hosts[index].id}`
            : output.url,
          enabled: true,
          events: output.events,
          byEvents: false,
          base64: true,
        });
        const provider = await prisma.vpsProvider.findUniqueOrThrow({
          where: { id: hosts[index].id },
        });
        if (hubRelay) {
          const token = configured.webhook.headers![RELAY_TOKEN_HEADER];
          expect(token).toBeTruthy();
          expect(decryptAES256GCM(provider.callbackTokenEncrypted!, key)).toBe(
            token,
          );
          expect(JSON.stringify(result)).not.toContain(token);
        } else {
          expect(provider.callbackTokenEncrypted).toBeNull();
          expect(configured.webhook.headers).toBeUndefined();
        }
      }
      expect(
        http.request.mock.calls.every(
          (call) => !call[3].endsWith(other.instanceName),
        ),
      ).toBe(true);
      expect(
        await prisma.instance.count({
          where: { id: { in: [own.id, second.id, other.id] } },
        }),
      ).toBe(3);
    },
  );

  it('centralizes set/sync/default headers without touching another product or leaking the secret', async () => {
    const own = await instance(),
      other = await instance(b);
    const webhookService = new WebhookService(adapters, resolver, config, db);
    await webhookService.setWebhook(auth(), own.id, {
      webhook: {
        enabled: true,
        url: 'https://client.invalid',
        byEvents: true,
        base64: false,
        headers: { 'X-Custom': 'fixture' },
      },
    });
    const configured = http.request.mock.calls.at(-1)?.[4] as {
      webhook: {
        url: string;
        headers: Record<string, string>;
        byEvents: boolean;
      };
    };
    expect(configured.webhook.url).toBe(
      `https://hub.invalid/api/v1/internal/webhook/evolution/${hosts[0].id}`,
    );
    const token = configured.webhook.headers[RELAY_TOKEN_HEADER];
    expect(token).toBeTruthy();
    http.request.mockResolvedValueOnce(configured);
    expect(
      JSON.stringify(await webhookService.findWebhook(auth(), own.id)),
    ).not.toContain(token);
    http.request.mockClear();
    await new ProductsService(db, cache, config, adapters).syncRelay(a.id);
    expect(
      http.request.mock.calls.every(
        (call) => !String(call[3]).endsWith(other.instanceName),
      ),
    ).toBe(true);
    const synced = http.request.mock.calls.at(-1)?.[4] as typeof configured;
    expect(synced.webhook.headers[RELAY_TOKEN_HEADER]).toBe(token);
    expect(synced.webhook.byEvents).toBe(true);
    expect(synced.webhook.headers['X-Custom']).toBe('fixture');
    const raw = await prisma.vpsProvider.findUniqueOrThrow({
      where: { id: hosts[0].id },
    });
    expect(raw.callbackTokenEncrypted).not.toBe(token);
    expect(decryptAES256GCM(raw.callbackTokenEncrypted!, key)).toBe(token);
  });

  it('does not force Hub relay on direct webhooks and preserves token headers when toggling an internal webhook', async () => {
    const row = await instance();
    const webhookService = new WebhookService(adapters, resolver, config, db);
    const dto = {
      webhook: {
        enabled: true,
        url: 'https://direct.invalid',
        headers: { custom: 'value' },
      },
    };
    await webhookService.setWebhook(
      { ...auth(), hubRelay: false },
      row.id,
      dto,
    );
    expect(
      (http.request.mock.calls.at(-1)?.[4] as typeof dto).webhook,
    ).toMatchObject(dto.webhook);
    const token = await callbackToken();
    http.request.mockResolvedValueOnce({
      webhook: {
        url: 'https://hub.invalid/internal',
        headers: { [RELAY_TOKEN_HEADER]: token },
        events: [],
        byEvents: true,
        base64: false,
      },
    });
    await webhookService.toggleWebhook(auth(), row.id, { enabled: false });
    expect(
      (http.request.mock.calls.at(-1)?.[4] as typeof dto).webhook,
    ).toMatchObject({
      enabled: false,
      headers: { [RELAY_TOKEN_HEADER]: token },
      byEvents: true,
      base64: false,
    });
  });

  it('prepares creation defaults for the selected host without rotating the shared origin token', async () => {
    const token = await callbackToken();
    const inventory = new EvolutionInventoryService(db, adapters, config);
    const provisioning = new EvolutionProvisioningService(
      db,
      inventory,
      adapters,
      config,
      cache,
    );
    const prepared = await provisioning.prepare(
      a.id,
      { instanceName: 'new-default', qrcode: true },
      new QrRequestContext(60000, 50000),
    );
    expect(prepared.payload.webhook?.headers?.[RELAY_TOKEN_HEADER]).toBe(token);
    expect(prepared.payload.webhook?.url).toContain(hosts[0].id);
    expect(prepared.payload.webhookApplied).toBe(false);
    await provisioning.abandon(prepared.ticket);
  });
});
