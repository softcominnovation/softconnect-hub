import { ConfigService } from '@nestjs/config';
import { InstanceMaintenanceObservation } from '@prisma/client';
import { maintenanceConfigShape, manualLeases } from './maintenance.config';
import { maintenancePolicySchema } from './maintenance.dto';
import {
  eligibleObservation,
  observeConnecting,
  parseMaintenanceInventory,
} from './maintenance.observation';
import { configSchema } from '../../config/config.schema';
import { MaintenanceWorker } from './maintenance.worker';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { EvolutionMaintenanceClient } from '../../adapters/evolution/evolution.maintenance';
import { EvolutionProvisioningService } from '../provisioning/evolution-provisioning.service';

describe('Maintenance policy and observation', () => {
  const remote = { id: 'remote', name: 'test', status: 'connecting' };
  const first = () =>
    ({
      ...observeConnecting(null, remote, 'generation', new Date(0), 180000),
      id: 'o',
      instanceId: 'i',
      providerId: 'p',
      productId: 'product',
    }) as InstanceMaintenanceObservation;
  it('is opt-in and dry-run by default', () => {
    expect(maintenanceConfigShape.MAINTENANCE_ENABLED.parse(undefined)).toBe(
      false,
    );
    expect(maintenanceConfigShape.MAINTENANCE_DRY_RUN.parse(undefined)).toBe(
      true,
    );
    expect(() =>
      maintenanceConfigShape.MAINTENANCE_ENABLED.parse('yes'),
    ).toThrow();
  });
  it('observes elapsed time without using timestamps of QR updates', () => {
    const old = first();
    const next = {
      ...old,
      ...observeConnecting(old, remote, 'generation', new Date(60000), 180000),
    };
    expect(next.connectingObservedSince).toEqual(new Date(0));
    expect(eligibleObservation(next, new Date(60000), 1, 180000)).toBe(true);
    expect(eligibleObservation(old, new Date(60000), 1, 180000)).toBe(false);
  });
  it.each(['open', 'close', 'unknown'])('never targets %s', (status) => {
    const old = first();
    const next = {
      ...old,
      ...observeConnecting(
        old,
        { ...remote, status },
        'generation',
        new Date(60000),
        180000,
      ),
    };
    expect(next.connectingObservedSince).toBeNull();
    expect(eligibleObservation(next, new Date(600000), 1, 180000)).toBe(false);
  });
  it('keeps the connecting clock when only the remote id changes', () => {
    const old = first();
    const next = observeConnecting(
      old,
      { ...remote, id: 'replacement' },
      'generation',
      new Date(60000),
      180000,
    );
    expect(next.episode).toBe(old.episode);
    expect(next.connectingObservedSince).toEqual(old.connectingObservedSince);
    expect(next.remoteId).toBe('replacement');
    expect(next.samples).toBe(old.samples + 1);
  });
  it.each(['gap', 'clock', 'name', 'generation'])(
    'restarts history for %s',
    (reason) => {
      const old = first();
      const now = new Date(
        reason === 'gap' ? 180001 : reason === 'clock' ? -1 : 60000,
      );
      const next = observeConnecting(
        old,
        {
          ...remote,
          id: remote.id,
          name: reason === 'name' ? 'new' : remote.name,
        },
        reason === 'generation' ? 'new' : 'generation',
        now,
        180000,
      );
      expect(next.episode).not.toBe(old.episode);
      expect(next.samples).toBe(1);
      expect(next.connectingObservedSince).toEqual(now);
    },
  );
  it.each([
    {},
    null,
    [{ id: 'r', name: 'n' }],
    [
      { id: 'r', name: 'n', status: 'connecting' },
      { id: 'r', name: 'other', status: 'close' },
    ],
  ])('rejects incomplete inventories', (input) =>
    expect(() => parseMaintenanceInventory(input)).toThrow('inventory_invalid'),
  );
  it('accepts a proven empty inventory and nested identities', () => {
    expect(parseMaintenanceInventory([])).toEqual([]);
    expect(
      parseMaintenanceInventory([
        {
          instance: {
            instanceId: 'r',
            instanceName: 'n',
            status: 'connecting',
          },
        },
      ]),
    ).toEqual([{ id: 'r', name: 'n', status: 'connecting' }]);
  });
  it('rejects oversized inventory instead of accepting partial data', () =>
    expect(() =>
      parseMaintenanceInventory(
        Array(10001).fill({ id: 'r', name: 'n', status: 'close' }),
      ),
    ).toThrow());
  it('expires manual leases and ignores malformed data', () =>
    expect(
      manualLeases({ old: 1, live: 100, invalid: 'abc' }, new Date(50)),
    ).toEqual({ live: 100 }));
  it('does not accept arbitrary states/actions or implicit enabled flag', () => {
    expect(
      maintenancePolicySchema.safeParse({ enabled: true, action: 'delete_all' })
        .success,
    ).toBe(false);
  });
  it('validates coordinated settings without introducing required envs', () => {
    const base = {
      DATABASE_URL: 'postgresql://local/test',
      REDIS_URL: 'redis://local',
      ENCRYPTION_KEY: 'a'.repeat(64),
      JWT_SECRET: 'a'.repeat(16),
      ADMIN_SECRET: 'a'.repeat(8),
    };
    expect(configSchema.parse(base).MAINTENANCE_ENABLED).toBe(false);
    expect(
      configSchema.safeParse({ ...base, MAINTENANCE_INTERVAL_MS: 180000 })
        .success,
    ).toBe(false);
    expect(
      configSchema.safeParse({ ...base, MAINTENANCE_CYCLE_TIMEOUT_MS: 1000 })
        .success,
    ).toBe(false);
    expect(
      configSchema.parse({ ...base, RUNTIME_MODE: 'worker-maintenance' })
        .RUNTIME_MODE,
    ).toBe('worker-maintenance');
  });
});

describe('Maintenance worker admission', () => {
  function fixture(enabled = true) {
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([{ ready: true }]),
      providerMaintenancePolicy: { findMany: jest.fn().mockResolvedValue([]) },
      instanceMaintenanceAction: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const client = { inventory: jest.fn(), state: jest.fn(), act: jest.fn() };
    const worker = new MaintenanceWorker(
      db as unknown as PrismaService,
      new ConfigService({ MAINTENANCE_ENABLED: enabled }),
      {} as CacheService,
      client as unknown as EvolutionMaintenanceClient,
      {} as EvolutionProvisioningService,
    );
    return { db, client, worker };
  }
  it('does not even scan providers when master is off', async () => {
    const f = fixture(false);
    await f.worker.scan();
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
    expect(f.client.inventory).not.toHaveBeenCalled();
  });
  it('only selects enabled policies on active Evolution providers', async () => {
    const f = fixture();
    await f.worker.scan();
    expect(f.db.providerMaintenancePolicy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          enabled: true,
          provider: { isActive: true, adapterType: 'evolution' },
        },
      }),
    );
    expect(f.client.inventory).not.toHaveBeenCalled();
    expect(f.client.act).not.toHaveBeenCalled();
  });
  it('waits for additive migration without provider access', async () => {
    const f = fixture();
    f.db.$queryRaw.mockResolvedValue([{ ready: false }]);
    await f.worker.scan();
    expect(f.db.providerMaintenancePolicy.findMany).not.toHaveBeenCalled();
    expect(f.client.inventory).not.toHaveBeenCalled();
  });
});
