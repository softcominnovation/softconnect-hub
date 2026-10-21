import { ConfigService } from '@nestjs/config';
import { PrismaClient, VpsProvider } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { CacheService } from '../src/cache/cache.service';
import { MaintenanceWorker } from '../src/modules/maintenance/maintenance.worker';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import { MaintenanceGuard } from '../src/modules/maintenance/maintenance.guard';
import { EvolutionMaintenanceClient } from '../src/adapters/evolution/evolution.maintenance';
import { EvolutionProvisioningService } from '../src/modules/provisioning/evolution-provisioning.service';
import { EvolutionInventoryService } from '../src/modules/provisioning/evolution-inventory.service';
import { AdapterResolverService } from '../src/providers/adapter-resolver.service';
import { MaintenanceRemote } from '../src/modules/maintenance/maintenance.observation';
import { fingerprint } from '../src/modules/maintenance/maintenance.config';
import { canonicalEvolutionEndpoint } from '../src/prisma/evolution-identity';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL required');
const address = new URL(url);
if (
  !['127.0.0.1', 'localhost'].includes(address.hostname) ||
  !/^\/softconnect_mc01_test_\d+$/.test(address.pathname)
)
  throw new Error('Only dedicated local MC01 database allowed');
address.searchParams.set('connection_limit','2');
const prisma = new PrismaClient({ datasources: { db: { url:address.toString() } } });
const db = prisma as PrismaService;
const settings = {
  MAINTENANCE_ENABLED: true,
  MAINTENANCE_DRY_RUN: false,
  MAINTENANCE_CONNECTING_MAX_AGE_MINUTES: 1,
  MAINTENANCE_HTTP_TIMEOUT_MS: 100,
  MAINTENANCE_CYCLE_TIMEOUT_MS: 10000,
};
const config = new ConfigService(settings);
const cache = {
  del: jest.fn().mockResolvedValue(undefined),
  get: jest.fn().mockResolvedValue(null),
} as unknown as CacheService;
const provision = new EvolutionProvisioningService(
  db,
  {} as EvolutionInventoryService,
  {} as AdapterResolverService,
  config,
  cache,
);
const remote = new Map<string, MaintenanceRemote[]>();
let live = 'connecting';
const client = {
  inventory: jest.fn((p: VpsProvider) => Promise.resolve(remote.get(p.id) ?? [])),
  state: jest.fn(() => Promise.resolve(live)),
  act: jest.fn((p: VpsProvider, _name: string, action: string) => {
    if (action === 'delete') remote.set(p.id, []);
    else live = 'close';
    return Promise.resolve({ status: 'SUCCESS', error: false });
  }),
  connect: jest.fn(() => Promise.resolve()),
};
const worker = () =>
  new MaintenanceWorker(
    db,
    config,
    cache,
    client as unknown as EvolutionMaintenanceClient,
    provision,
  );
const service = new MaintenanceService(db, config, cache);
let provider: VpsProvider;
let instanceId: string;
let productId: string;

beforeEach(async () => {
  await db.providerMaintenancePolicy.updateMany({ data: { enabled: false } });
  remote.clear();
  live = 'connecting';
  client.inventory.mockClear();
  client.state.mockClear();
  client.act.mockClear();
  client.connect.mockClear();
  const id = randomUUID();
  const vps = await db.vpsServer.create({
    data: { label: 'test', subdomain: id, ip: '127.0.0.1' },
  });
  provider = await db.vpsProvider.create({
    data: {
      vpsId: vps.id,
      label: 'test',
      providerUrl: `http://127.0.0.1/${id}`,
      providerApiKey: 'synthetic',
    },
  });
  const product = await db.product.create({
    data: { id, name: 'test', slug: id, apiKeyHash: id, origins: [] },
  });
  productId = product.id;
  await db.productEvolution.create({
    data: { productId, vpsProviderId: provider.id },
  });
  const instance = await db.instance.create({
    data: {
      productId,
      vpsProviderId: provider.id,
      instanceName: 'test',
      providerInstanceId: id,
      hubToken: id,
    },
  });
  instanceId = instance.id;
  remote.set(provider.id, [{ id, name: 'test', status: 'connecting' }]);
});
afterAll(() => prisma.$disconnect());

async function enable(action = 'disconnect', mode = 'execute') {
  await db.providerMaintenancePolicy.create({
    data: {
      providerId: provider.id,
      enabled: true,
      action,
      mode,
      connectingMaxAgeMinutes: 1,
    },
  });
}
async function age() {
  await worker().scan();
  await db.instanceMaintenanceObservation.updateMany({
    where: { providerId: provider.id },
    data: {
      connectingObservedSince: new Date(Date.now() - 61000),
      lastObservedAt: new Date(Date.now() - 1000),
      samples: 2,
    },
  });
}

it('does not consult providers with no policy or disabled policy, including pending actions', async () => {
  await worker().scan();
  expect(client.inventory).not.toHaveBeenCalled();
  await enable();
  await db.providerMaintenancePolicy.update({
    where: { providerId: provider.id },
    data: { enabled: false },
  });
  await worker().scan();
  expect(client.inventory).not.toHaveBeenCalled();
  expect(client.act).not.toHaveBeenCalled();
});
it('requires opt-in confirmation, preserves policy on stale revision and resets observation on disable', async () => {
  const view = await service.get(provider.id);
  const input = {
    expectedRevision: 0,
    expectedProviderRevision: view.providerRevision,
    expectedScopeFingerprint: view.scopeFingerprint,
    enabled: true,
    mode: 'observe' as const,
    action: 'disconnect' as const,
    connectingMaxAgeMinutes: 1,
  };
  await expect(service.update(provider.id, input, 'test')).rejects.toThrow(
    'Confirme',
  );
  const saved = await service.update(
    provider.id,
    {
      ...input,
      confirmation: { action: 'disconnect', acknowledgeSharedScope: true },
    },
    'test',
  );
  expect(saved.policy.enabled).toBe(true);
  await expect(service.update(provider.id, input, 'test')).rejects.toThrow(
    'alterados',
  );
  await age();
  await service.update(
    provider.id,
    { ...input, enabled: false, expectedRevision: 1 },
    'test',
  );
  expect(
    (
      await db.instanceMaintenanceObservation.findFirst({
        where: { providerId: provider.id },
      })
    )?.connectingObservedSince,
  ).toBeNull();
});
it('simulates without mutation and does not duplicate the episode on the next cycle', async () => {
  await enable('delete', 'observe');
  await age();
  await worker().scan();
  await worker().scan();
  expect(client.act).not.toHaveBeenCalled();
  expect(client.connect).not.toHaveBeenCalled();
  expect(
    await db.instanceMaintenanceAction.count({
      where: { providerId: provider.id, state: 'simulated' },
    }),
  ).toBe(1);
});
it('disconnects and confirms close without removing Hub identity or capacity', async () => {
  await enable();
  await age();
  await worker().scan();
  expect(client.act).toHaveBeenCalledTimes(1);
  expect(client.connect).not.toHaveBeenCalled();
  expect(
    await db.instance.findUnique({ where: { id: instanceId } }),
  ).not.toBeNull();
  expect(
    (await db.vpsProvider.findUnique({ where: { id: provider.id } }))
      ?.occupancyRevision,
  ).toBe(provider.occupancyRevision);
  expect(
    (
      await db.instanceMaintenanceAction.findFirst({
        where: { providerId: provider.id },
      })
    )?.state,
  ).toBe('succeeded');
});
it('confirms remote absence before deleting locally and updates occupancy', async () => {
  await enable('delete');
  await age();
  await worker().scan();
  expect(client.act).toHaveBeenCalledTimes(1);
  expect(client.connect).not.toHaveBeenCalled();
  expect(
    await db.instance.findUnique({ where: { id: instanceId } }),
  ).toBeNull();
  expect(
    (await db.vpsProvider.findUnique({ where: { id: provider.id } }))
      ?.occupancyRevision,
  ).toBe(provider.occupancyRevision + 1);
  expect(
    (
      await db.instanceMaintenanceAction.findFirst({
        where: { providerId: provider.id },
      })
    )?.state,
  ).toBe('succeeded');
});
it('does not target open/close or an external unknown instance', async () => {
  await enable('delete');
  remote.set(provider.id, [
    { id: 'external', name: 'external', status: 'connecting' },
    { id: remote.get(provider.id)![0].id, name: 'test', status: 'open' },
  ]);
  await age();
  await worker().scan();
  expect(client.act).not.toHaveBeenCalled();
});
it('disconnects a connecting inventory whose live state is already closed', async () => {
  await enable();
  await age();
  live = 'close';
  await worker().scan();
  expect(client.act).toHaveBeenCalledTimes(1);
  expect(client.connect).not.toHaveBeenCalled();
  expect(
    (
      await db.instanceMaintenanceAction.findFirst({
        where: { providerId: provider.id },
      })
    )?.state,
  ).toBe('succeeded');
});
it('does not resend a timed-out deletion, and does not verify while disabled', async () => {
  await enable('delete');
  await age();
  client.act.mockRejectedValueOnce(new Error('timeout'));
  await worker().scan();
  expect(
    (
      await db.instanceMaintenanceAction.findFirst({
        where: { providerId: provider.id },
      })
    )?.state,
  ).toBe('uncertain');
  await db.instanceMaintenanceAction.updateMany({
    where: { providerId: provider.id },
    data: { nextCheckAt: null },
  });
  await worker().scan();
  expect(client.act).toHaveBeenCalledTimes(1);
  expect(
    await db.instance.findUnique({ where: { id: instanceId } }),
  ).not.toBeNull();
  client.inventory.mockClear();
  await db.providerMaintenancePolicy.update({
    where: { providerId: provider.id },
    data: { enabled: false },
  });
  await worker().scan();
  expect(client.inventory).not.toHaveBeenCalled();
});
it('coordinates two replicas so only one action is dispatched', async () => {
  await enable();
  await age();
  await Promise.all([worker().scan(), worker().scan()]);
  expect(client.act).toHaveBeenCalledTimes(1);
});
it('manual operation wins before dispatch and invalidates the observed clock', async () => {
  await enable();
  await age();
  const guard = new MaintenanceGuard(db);
  await guard.run(provider.providerUrl, 'test', async () => {
    await worker().scan();
    expect(client.act).not.toHaveBeenCalled();
  });
  await worker().scan();
  expect(client.act).not.toHaveBeenCalled();
});
it('blocks manual operation while automatic result is uncertain', async () => {
  await enable('delete');
  await age();
  client.act.mockRejectedValueOnce(new Error('timeout'));
  await worker().scan();
  const call = jest.fn();
  await expect(
    new MaintenanceGuard(db).run(provider.providerUrl, 'test', call),
  ).rejects.toThrow('aguardando confirmação');
  expect(call).not.toHaveBeenCalled();
});
it('restarts observation after a long gap and does not infer age from creation', async () => {
  await enable();
  await age();
  await db.instanceMaintenanceObservation.updateMany({
    where: { providerId: provider.id },
    data: { lastObservedAt: new Date(Date.now() - 180001) },
  });
  await worker().scan();
  expect(client.act).not.toHaveBeenCalled();
});
it('preserves a recreated identity under the same name', async () => {
  await enable('delete');
  await age();
  remote.set(provider.id, [
    { id: 'replacement', name: 'test', status: 'connecting' },
  ]);
  await worker().scan();
  expect(client.act).not.toHaveBeenCalled();
  expect(
    await db.instance.findUnique({ where: { id: instanceId } }),
  ).not.toBeNull();
});
it('does not act during active provisioning or batch jobs', async () => {
  await enable();
  await age();
  await db.batchJob.create({
    data: { productId, instanceId, totalMessages: 1 },
  });
  await worker().scan();
  expect(client.act).not.toHaveBeenCalled();
});
it('detects shared-scope changes before accepting a confirmation', async () => {
  const view = await service.get(provider.id);
  const id = randomUUID();
  const product = await db.product.create({
    data: { id, name: 'second', slug: id, apiKeyHash: id, origins: [] },
  });
  await db.productEvolution.create({
    data: { productId: product.id, vpsProviderId: provider.id },
  });
  await expect(
    service.update(
      provider.id,
      {
        expectedRevision: 0,
        expectedProviderRevision: view.providerRevision,
        expectedScopeFingerprint: view.scopeFingerprint,
        enabled: true,
        mode: 'observe',
        action: 'disconnect',
        connectingMaxAgeMinutes: null,
        confirmation: { action: 'disconnect', acknowledgeSharedScope: true },
      },
      'test',
    ),
  ).rejects.toThrow('alterados');
});

it('recovers a persisted dispatch after a crash without sending DELETE again', async () => {
  await enable('delete');
  await age();
  const observation = await db.instanceMaintenanceObservation.findFirstOrThrow({
    where: { providerId: provider.id },
  });
  await db.instanceMaintenanceAction.create({
    data: {
      providerId: provider.id,
      instanceId,
      productId,
      instanceName: 'test',
      remoteId: observation.remoteId,
      episode: observation.episode,
      action: 'delete',
      state: 'dispatching',
      providerRevision: 0,
      policyRevision: 0,
      destinationFingerprint: fingerprint(
        canonicalEvolutionEndpoint(provider.providerUrl),
      ),
    },
  });
  remote.set(provider.id, []);
  await worker().scan();
  expect(client.act).not.toHaveBeenCalled();
  expect(
    await db.instance.findUnique({ where: { id: instanceId } }),
  ).toBeNull();
  expect(
    (
      await db.instanceMaintenanceAction.findFirst({
        where: { providerId: provider.id },
      })
    )?.state,
  ).toBe('succeeded');
});

it('retries only local cleanup after a local failure and a harmless provider revision change', async () => {
  await enable('delete');
  await age();
  const cleanup = jest
    .spyOn(provision, 'removeConfirmed')
    .mockRejectedValueOnce(new Error('local unavailable'));
  try {
    await worker().scan();
    expect(client.act).toHaveBeenCalledTimes(1);
    expect(
      (
        await db.instanceMaintenanceAction.findFirst({
          where: { providerId: provider.id },
        })
      )?.state,
    ).toBe('local_cleanup_pending');
    expect(
      await db.instance.findUnique({ where: { id: instanceId } }),
    ).not.toBeNull();
    await db.vpsProvider.update({
      where: { id: provider.id },
      data: { configurationRevision: { increment: 1 }, maxInstances: 50 },
    });
    await worker().scan();
    expect(client.act).toHaveBeenCalledTimes(1);
    expect(
      await db.instance.findUnique({ where: { id: instanceId } }),
    ).toBeNull();
  } finally {
    cleanup.mockRestore();
  }
});

it('stops before dispatch when the provider is disabled during verification', async () => {
  await enable();
  await age();
  client.state.mockImplementationOnce(async () => {
    await db.providerMaintenancePolicy.update({
      where: { providerId: provider.id },
      data: { enabled: false },
    });
    return 'connecting';
  });
  await worker().scan();
  expect(client.act).not.toHaveBeenCalled();
});

it('uses fencing to stop a stale lease before dispatch', async () => {
  await enable();
  await age();
  client.state.mockImplementationOnce(async () => {
    await db.providerMaintenancePolicy.update({
      where: { providerId: provider.id },
      data: { fencingToken: { increment: 1 } },
    });
    return 'connecting';
  });
  await worker().scan();
  expect(client.act).not.toHaveBeenCalled();
});

it('preserves pending deletion if the same remote name was recreated', async () => {
  await enable('delete');
  await age();
  client.act.mockImplementationOnce((p) => {
    remote.set(p.id, [
      { id: 'replacement', name: 'test', status: 'connecting' },
    ]);
    return Promise.resolve({ status: 'SUCCESS', error: false });
  });
  await worker().scan();
  expect(client.act).toHaveBeenCalledTimes(1);
  expect(
    await db.instance.findUnique({ where: { id: instanceId } }),
  ).not.toBeNull();
  expect(
    (
      await db.instanceMaintenanceAction.findFirst({
        where: { providerId: provider.id },
      })
    )?.state,
  ).toBe('uncertain');
});

it('requires permanent deletion acknowledgement and returns scoped pages', async () => {
  const view = await service.get(provider.id);
  const input = {
    expectedRevision: 0,
    expectedProviderRevision: view.providerRevision,
    expectedScopeFingerprint: view.scopeFingerprint,
    enabled: true,
    mode: 'execute' as const,
    action: 'delete' as const,
    connectingMaxAgeMinutes: 1,
    confirmation: {
      action: 'delete' as const,
      acknowledgeSharedScope: true as const,
    },
  };
  await expect(service.update(provider.id, input, 'test')).rejects.toThrow(
    'Confirme',
  );
  await service.update(
    provider.id,
    {
      ...input,
      confirmation: {
        ...input.confirmation,
        acknowledgePermanentDeletion: true,
      },
    },
    'test',
  );
  await age();
  const observations = await service.page(provider.id, 'observations', {
    limit: 25,
  });
  expect(observations.items).toHaveLength(1);
  await expect(
    service.page(provider.id, 'actions', { limit: 25, cursor: randomUUID() }),
  ).rejects.toThrow('Cursor inválido');
});

it('bounds actions with a simulated inventory of 200 managed instances',async()=>{
  await enable('disconnect','observe');
  const rows=Array.from({length:199},(_,i)=>({productId,vpsProviderId:provider.id,instanceName:`load-${i}`,providerInstanceId:randomUUID(),hubToken:randomUUID()}));
  await db.instance.createMany({data:rows});
  remote.set(provider.id,[...remote.get(provider.id)!,...rows.map(r=>({id:r.providerInstanceId,name:r.instanceName,status:'connecting'}))]);
  await age();client.inventory.mockClear();client.state.mockClear();
  const started=performance.now(),cpu=process.cpuUsage(),heap=process.memoryUsage().heapUsed;
  await worker().scan();
  expect(client.act).not.toHaveBeenCalled();
  expect(client.connect).not.toHaveBeenCalled();
  expect(client.inventory).toHaveBeenCalledTimes(4);
  expect(client.state).toHaveBeenCalledTimes(3);
  expect(await db.instanceMaintenanceAction.count({where:{providerId:provider.id,state:'simulated'}})).toBe(3);
  const usage=process.cpuUsage(cpu);
  console.log(JSON.stringify({maintenanceSyntheticSample:{instances:200,pool:2,durationMs:Math.round(performance.now()-started),cpuMs:Math.round((usage.user+usage.system)/1000),heapDeltaMiB:Number(((process.memoryUsage().heapUsed-heap)/1048576).toFixed(2)),rssMiB:Math.round(process.memoryUsage().rss/1048576),inventoryCalls:4,stateCalls:3,mutations:0}}));
});
