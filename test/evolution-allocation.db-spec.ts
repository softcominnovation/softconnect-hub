import { InstanceService } from '../src/modules/instance/instance.service';
import { InstanceResolverService } from '../src/resolver/instance.resolver';
import { AuthCachePayload } from '../src/auth/apikey.guard';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, VpsProvider, Product } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { CacheService } from '../src/cache/cache.service';
import { encryptAES256GCM } from '../src/common/crypto.util';
import { QrRequestContext } from '../src/common/qr-request-context';
import { EvolutionInventoryService } from '../src/modules/provisioning/evolution-inventory.service';
import { EvolutionProvisioningService } from '../src/modules/provisioning/evolution-provisioning.service';
import { EvolutionRecoveryService } from '../src/modules/provisioning/evolution-recovery.service';
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
