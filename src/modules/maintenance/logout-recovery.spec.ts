import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VpsProvider } from '@prisma/client';
import { CacheService } from '../../cache/cache.service';
import { MaintenanceLogoutError } from '../../adapters/evolution/evolution.maintenance';
import { EvolutionProvisioningService } from '../provisioning/evolution-provisioning.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MaintenanceWorker } from './maintenance.worker';
import { dispatchDisconnect } from './logout-recovery';

const refused = (name: string, status = 400, text?: string) =>
  new MaintenanceLogoutError(
    status,
    status === 401 ? 'Unauthorized' : 'Bad Request',
    text ??
      (status === 401
        ? 'Unauthorized'
        : `The "${name}" instance is not connected`),
  );

describe('logout recovery sequence', () => {
  function harness(name = 'shop') {
    const calls: string[] = [];
    let logouts = 0;
    let states: string[] = ['connecting', 'connecting'];
    let expired = false;
    const input = {
      name,
      sawConnecting: true,
      expired: () => expired,
      logout: jest.fn(() => {
        calls.push('logout');
        logouts += 1;
        if (logouts === 1) throw refused(name);
      }),
      state: jest.fn(() => {
        calls.push('state');
        return states.shift() ?? 'connecting';
      }),
      connect: jest.fn(() => {
        calls.push('connect');
        return { base64: 'QRSECRET', code: 'PAIRCODE' };
      }),
    };
    return {
      calls,
      input,
      setStates: (next: string[]) => {
        states = next;
      },
      expire: () => {
        expired = true;
      },
    };
  }

  it('connects once and logs out once after the exact 400', async () => {
    const run = harness();
    await expect(dispatchDisconnect(run.input)).resolves.toBe('confirm');
    expect(run.calls).toEqual([
      'logout',
      'state',
      'connect',
      'state',
      'logout',
    ]);
    expect(JSON.stringify(run.calls)).not.toContain('QRSECRET');
  });

  it('does not connect again when the second logout is also refused', async () => {
    const run = harness();
    run.input.logout.mockImplementation(() => {
      run.calls.push('logout');
      throw refused('shop');
    });
    await expect(dispatchDisconnect(run.input)).resolves.toBe('failed');
    expect(run.calls.filter((call) => call === 'connect')).toHaveLength(1);
    expect(run.calls.filter((call) => call === 'logout')).toHaveLength(2);
  });

  it('uses the same single sequence for 401 after a connecting read', async () => {
    const run = harness();
    let attempts = 0;
    run.input.logout.mockImplementation(() => {
      run.calls.push('logout');
      attempts += 1;
      if (attempts === 1) throw refused('shop', 401);
    });
    await expect(dispatchDisconnect(run.input)).resolves.toBe('confirm');
    expect(run.calls).toEqual([
      'logout',
      'state',
      'connect',
      'state',
      'logout',
    ]);
  });

  it.each([
    ['missing state', false, refused('shop', 401)],
    ['other 400', true, refused('shop', 400, 'something else')],
    ['404', true, new Error('upstream_404')],
    ['503', true, new Error('upstream_503')],
  ])('does not connect on %s', async (_label, sawConnecting, error) => {
    const run = harness();
    run.input.sawConnecting = sawConnecting;
    run.input.logout.mockRejectedValue(error);
    await expect(dispatchDisconnect(run.input)).rejects.toBe(error);
    expect(run.input.connect).not.toHaveBeenCalled();
  });

  it('does not log out again when the session is open before or after connect', async () => {
    const before = harness();
    before.setStates(['open']);
    await expect(dispatchDisconnect(before.input)).resolves.toBe(
      'skipped_open',
    );
    expect(before.calls).toEqual(['logout', 'state']);
    const after = harness();
    after.setStates(['connecting', 'open']);
    await expect(dispatchDisconnect(after.input)).resolves.toBe('skipped_open');
    expect(after.calls).toEqual(['logout', 'state', 'connect', 'state']);
  });

  it('does not connect when the session is already closed', async () => {
    const run = harness();
    run.setStates(['close']);
    await expect(dispatchDisconnect(run.input)).resolves.toBe('confirm');
    expect(run.calls).toEqual(['logout', 'state']);
  });

  it('stops one recovery on deadline without a further logout', async () => {
    const run = harness();
    run.input.state.mockImplementation(() => {
      run.calls.push('state');
      run.expire();
      return 'connecting';
    });
    await expect(dispatchDisconnect(run.input)).resolves.toBe('failed');
    expect(run.calls).toEqual(['logout', 'state']);
  });

  it('records connect failure without delete or a second logout', async () => {
    const run = harness();
    run.input.connect.mockImplementation(() => {
      run.calls.push('connect');
      throw new Error('connect_rejected');
    });
    await expect(dispatchDisconnect(run.input)).resolves.toBe('failed');
    expect(run.calls).toEqual(['logout', 'state', 'connect']);
  });
});

describe('maintenance dispatch boundaries', () => {
  const now = new Date();
  const provider = {
    id: 'p',
    isActive: true,
    adapterType: 'evolution',
    configurationRevision: 1,
    providerUrl: 'http://127.0.0.1/evo',
  } as VpsProvider;
  const policy = {
    enabled: true,
    mode: 'execute',
    action: 'disconnect',
    revision: 3,
    generation: 1,
    leaseOwner: 'owner',
    fencingToken: 4,
    leaseUntil: new Date(now.getTime() + 120000),
    connectingMaxAgeMinutes: 1,
    manualLeases: null,
  };

  function observation(name: string) {
    return {
      id: `obs-${name}`,
      instanceId: `inst-${name}`,
      providerId: 'p',
      productId: 'product',
      remoteId: `remote-${name}`,
      instanceName: name,
      episode: `episode-${name}`,
      remoteStatus: 'connecting',
      samples: 2,
      connectingObservedSince: new Date(now.getTime() - 120000),
      lastObservedAt: now,
      generation: 'g',
    };
  }

  function fixture(action = 'disconnect', dryRun = false) {
    const updates: Array<{ data: { state?: string; reason?: string } }> = [];
    const logs: string[] = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((message) => {
      logs.push(String(message));
    });
    jest.spyOn(Logger.prototype, 'error').mockImplementation((message) => {
      logs.push(String(message));
    });
    const currentPolicy = { ...policy, action };
    const tx = {
      $queryRaw: jest.fn(() => [{ id: 'p', now: new Date() }]),
      providerMaintenancePolicy: {
        findUnique: jest.fn(() => currentPolicy),
      },
      vpsProvider: {
        findUnique: jest.fn(() => provider),
        findUniqueOrThrow: jest.fn(() => provider),
      },
      instanceMaintenanceObservation: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          observation(where.id.replace('obs-', '')),
        ),
        updateMany: jest.fn(() => ({ count: 1 })),
      },
      instance: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) => ({
          id: where.id,
          vpsProviderId: 'p',
          providerInstanceId: `remote-${where.id.replace('inst-', '')}`,
          instanceName: where.id.replace('inst-', ''),
          productId: 'product',
        })),
      },
      instanceProvisioning: { findFirst: jest.fn(() => null) },
      instanceMaintenanceAction: {
        findUnique: jest.fn(() => null),
        findFirst: jest.fn(() => null),
        create: jest.fn(
          ({
            data,
          }: {
            data: {
              instanceName: string;
              action: string;
              remoteId: string;
              state: string;
              destinationFingerprint?: string;
              attempts?: number;
            };
          }) => ({
            id: `action-${data.instanceName}`,
            attempts: 0,
            ...data,
          }),
        ),
        update: jest.fn(
          (args: { data: { state?: string; reason?: string } }) => {
            updates.push(args);
            return args.data;
          },
        ),
      },
      batchJob: { findFirst: jest.fn(() => null) },
      pendingRelayEvent: { findFirst: jest.fn(() => null) },
      evolutionChange: { findFirst: jest.fn(() => null) },
    };
    const calls: string[] = [];
    const client = {
      inventory: jest.fn(() => []),
      state: jest.fn(() => 'connecting'),
      act: jest.fn((_provider: VpsProvider, name: string, kind: string) => {
        calls.push(`${kind}:${name}`);
        if (kind === 'delete') throw new Error('upstream_401');
        throw refused(name);
      }),
      connect: jest.fn((_provider: VpsProvider, name: string) => {
        calls.push(`connect:${name}`);
        return { base64: 'QRSECRET', code: 'PAIRCODE' };
      }),
    };
    const worker = new MaintenanceWorker(
      tx as unknown as PrismaService,
      new ConfigService({
        MAINTENANCE_ENABLED: true,
        MAINTENANCE_DRY_RUN: dryRun,
        MAINTENANCE_HTTP_TIMEOUT_MS: 100,
        MAINTENANCE_CONNECTING_MAX_AGE_MINUTES: 1,
      }),
      { del: jest.fn(() => undefined) } as unknown as CacheService,
      client as never,
      {} as EvolutionProvisioningService,
    );
    (tx as { $transaction?: unknown }).$transaction = jest.fn(
      (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );
    return { worker, client, calls, updates, logs, tx, currentPolicy };
  }

  async function run(setup: ReturnType<typeof fixture>, name: string) {
    setup.client.inventory.mockResolvedValue([
      { id: `remote-${name}`, name, status: 'connecting' },
    ]);
    await (
      setup.worker as unknown as {
        execute: (
          lease: unknown,
          row: ReturnType<typeof observation>,
          cycle: unknown,
        ) => Promise<void>;
      }
    ).execute(
      {
        provider,
        policy: setup.currentPolicy,
        owner: 'owner',
        token: 4,
      },
      observation(name),
      {
        deadline: Date.now() + 60000,
        signal: new AbortController().signal,
        remaining: 3,
      },
    );
  }

  afterEach(() => jest.restoreAllMocks());

  it('keeps going after a failed recovery and never calls delete', async () => {
    const first = fixture();
    first.client.connect.mockImplementation((_provider, name: string) => {
      first.calls.push(`connect:${name}`);
      throw new Error('connect_rejected');
    });
    await run(first, 'shop');
    await run(first, 'other');
    expect(first.calls).toEqual([
      'disconnect:shop',
      'connect:shop',
      'disconnect:other',
      'connect:other',
    ]);
    expect(first.calls.some((call) => call.startsWith('delete'))).toBe(false);
    expect(first.updates.map((item) => item.data.reason)).toEqual([
      'logout_recovery_failed',
      'logout_recovery_failed',
    ]);
    expect(JSON.stringify(first.logs)).not.toContain('QRSECRET');
    expect(JSON.stringify(first.updates)).not.toContain('QRSECRET');
  });

  it('deletes directly when logout would have been unauthorized', async () => {
    const runDelete = fixture('delete');
    await run(runDelete, 'shop');
    expect(runDelete.calls).toEqual(['delete:shop']);
    expect(runDelete.client.connect).not.toHaveBeenCalled();
    expect(runDelete.updates[0].data).toMatchObject({
      state: 'uncertain',
      reason: 'remote_result_unconfirmed',
    });
  });

  it('does not connect while observing or simulating', async () => {
    const observing = fixture('disconnect');
    observing.currentPolicy.mode = 'observe';
    await run(observing, 'shop');
    const simulating = fixture('disconnect', true);
    await run(simulating, 'shop');
    expect(observing.client.act).not.toHaveBeenCalled();
    expect(observing.client.connect).not.toHaveBeenCalled();
    expect(simulating.client.act).not.toHaveBeenCalled();
    expect(simulating.client.connect).not.toHaveBeenCalled();
  });
});
