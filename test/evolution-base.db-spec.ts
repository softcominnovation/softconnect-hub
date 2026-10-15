import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { EvolutionHttpService } from '../src/adapters/evolution/evolution.http';
import { CacheService } from '../src/cache/cache.service';
import { encryptAES256GCM } from '../src/common/crypto.util';
import { AdminInstancesService } from '../src/modules/admin/instances/admin-instances.service';
import { ProductsService } from '../src/modules/admin/products/products.service';
import { ProductsController } from '../src/modules/admin/products/products.controller';
import { VpsProviderController } from '../src/modules/admin/vps/vps-provider.controller';
import { VpsController } from '../src/modules/admin/vps/vps.controller';
import { JwtGuard } from '../src/auth/jwt.guard';
import { UpdateProductDto } from '../src/modules/admin/products/dto/update-product.dto';
import { VpsProviderService } from '../src/modules/admin/vps/vps-provider.service';
import { VpsService } from '../src/modules/admin/vps/vps.service';
import { InstanceService } from '../src/modules/instance/instance.service';
import { MessageService } from '../src/modules/message/message.service';
import { AdapterResolverService } from '../src/providers/adapter-resolver.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createLinkedInstance } from '../src/prisma/evolution-links';
import { diagnoseEvolutionBase } from '../src/prisma/evolution-base-diagnostics';
const productFields = [
  'id',
  'name',
  'slug',
  'adapterType',
  'origins',
  'hubRelay',
  'batchWebhookEnabled',
  'batchWebhookUrl',
  'isActive',
  'vpsProviderId',
  'createdAt',
  'updatedAt',
];
const providerFields = [
  'id',
  'vpsId',
  'label',
  'providerUrl',
  'providerApiKey',
  'adapterType',
  'isHealthy',
  'lastHealthAt',
  'isActive',
  'createdAt',
  'updatedAt',
];

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl)
  throw new Error(
    'TEST_DATABASE_URL must identify an empty local test database',
  );
const address = new URL(testUrl);
if (
  !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname) ||
  !/^\/softconnect_phase01_test_[a-z0-9_]+$/.test(address.pathname) ||
  (address.searchParams.get('schema') ?? 'public') !== 'public'
) {
  throw new Error(
    'Only a dedicated local softconnect_phase01_test_* database is allowed',
  );
}
const prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
const replica = new PrismaClient({ datasources: { db: { url: testUrl } } });
const db = prisma as PrismaService;
const root = resolve(__dirname, '..');
const key = 'a'.repeat(64);
const config = new ConfigService({ ENCRYPTION_KEY: key });
const cache = {
  del: jest.fn().mockResolvedValue(undefined),
} as unknown as CacheService;
const products = new ProductsService(
  db,
  cache,
  config,
  {} as AdapterResolverService,
);
const providers = new VpsProviderService(db, config, cache);
const vps = new VpsService(db, config, cache);

function sqlFile(file: string) {
  try {
    execFileSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'db',
        'execute',
        '--file',
        file,
        '--schema',
        'prisma/schema.prisma',
      ],
      {
        cwd: root,
        env: { ...process.env, DATABASE_URL: testUrl },
        stdio: 'pipe',
      },
    );
  } catch {
    throw new Error(`SQL operation failed: ${file}`);
  }
}

function instanceData(
  name: string,
  productId = 'product-a',
  providerId = 'evo-a',
) {
  return {
    productId,
    vpsProviderId: providerId,
    instanceName: name,
    hubToken: `test-${productId}-${name}`,
    providerInstanceId: `remote-${name}`,
  };
}

function reservation(
  name: string,
  productId = 'product-a',
  providerId = 'evo-a',
) {
  return {
    productId,
    vpsProviderId: providerId,
    instanceName: name,
    linkProductId: productId,
    linkVpsProviderId: providerId,
    requestHash: 'fixture-hash',
  };
}

describe('Evolution phase 01 — isolated PostgreSQL', () => {
  beforeAll(async () => {
    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`;
    if (count !== 0n)
      throw new Error('Test database must be empty; no reset is performed');
    sqlFile(
      'prisma/migrations/20260508000000_init_multi_provider/migration.sql',
    );
    sqlFile(
      'prisma/migrations/20260511000000_product_instance_defaults/migration.sql',
    );
    await prisma.$executeRaw`INSERT INTO "VpsServer" (id,label,subdomain,ip,"updatedAt")
      VALUES ('vps-test','Test','test.invalid','127.0.0.1',NOW())`;
    const encrypted = encryptAES256GCM('fixture-provider-key', key);
    await prisma.$executeRaw`INSERT INTO "VpsProvider" (id,"vpsId",label,"providerUrl","providerApiKey","isActive","updatedAt")
      VALUES ('evo-a','vps-test','A','https://evo-a.invalid',${encrypted},true,NOW()),
      ('evo-b','vps-test','B','https://evo-b.invalid',${encrypted},false,NOW())`;
    await prisma.$executeRaw`INSERT INTO "Product" (id,name,slug,"apiKeyHash",origins,"vpsProviderId","updatedAt")
      VALUES ('product-a','A','a','hash-a',ARRAY[]::text[],'evo-a',NOW()),
      ('product-b','B','b','hash-b',ARRAY[]::text[],'evo-a',NOW()),
      ('product-empty','Empty','empty','hash-empty',ARRAY[]::text[],NULL,NOW())`;
    await prisma.$executeRaw`INSERT INTO "Instance" (id,"productId","vpsProviderId","instanceName","providerInstanceId","instanceToken","hubToken","updatedAt")
      VALUES ('instance-a','product-a','evo-a','original-a','remote-original-a','token-a','hub-a',NOW()),
      ('instance-b','product-b','evo-a','original-b','remote-original-b','token-b','hub-b',NOW()),
      ('instance-historical','product-a','evo-b','historical','remote-historical','token-historical','hub-historical',NOW())`;
    sqlFile(
      'prisma/migrations/20261015000000_evolution_shared_base/migration.sql',
    );
  }, 60000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await Promise.all([prisma.$disconnect(), replica.$disconnect()]);
  });

  it('backfills shared/default/historical hosts without changing sessions or activation', async () => {
    expect(await prisma.productEvolution.count()).toBe(3);
    expect(
      await prisma.product.findUnique({ where: { id: 'product-a' } }),
    ).toMatchObject({
      allocationMode: 'legacy',
      allocationRevision: 0,
      vpsProviderId: 'evo-a',
      capacityFirstAllocationAt: null,
    });
    expect(
      await prisma.vpsProvider.findUnique({ where: { id: 'evo-b' } }),
    ).toMatchObject({
      isActive: false,
      maxInstances: null,
      acceptingNewInstances: true,
      identityStatus: 'pending',
      inventoryStatus: 'unknown',
      callbackTokenEncrypted: null,
    });
    expect(
      await prisma.productEvolution.findUnique({
        where: {
          productId_vpsProviderId: {
            productId: 'product-a',
            vpsProviderId: 'evo-b',
          },
        },
      }),
    ).toMatchObject({ acceptingNewInstances: false });
    expect(
      await prisma.instance.findUnique({
        where: { id: 'instance-historical' },
      }),
    ).toMatchObject({
      productId: 'product-a',
      vpsProviderId: 'evo-b',
      providerInstanceId: 'remote-historical',
      instanceToken: 'token-historical',
      hubToken: 'hub-historical',
    });
    expect(await prisma.instanceProvisioning.count()).toBe(0);
    expect(await prisma.evolutionReconciliation.count()).toBe(0);
  });

  it('repeated backfill preserves an explicit pause and priority', async () => {
    await prisma.product.create({
      data: {
        id: 'capacity-backfill',
        name: 'Capacity backfill',
        slug: 'capacity-backfill',
        apiKeyHash: 'hash-capacity-backfill',
        origins: [],
        allocationMode: 'capacity',
        vpsProviderId: 'evo-a',
      },
    });
    await prisma.productEvolution.update({
      where: {
        productId_vpsProviderId: {
          productId: 'product-a',
          vpsProviderId: 'evo-a',
        },
      },
      data: {
        acceptingNewInstances: false,
        allocationPriority: 7,
        configurationRevision: 2,
      },
    });
    sqlFile('prisma/operations/evolution-base-backfill.sql');
    expect(
      await prisma.productEvolution.findUnique({
        where: {
          productId_vpsProviderId: {
            productId: 'capacity-backfill',
            vpsProviderId: 'evo-a',
          },
        },
      }),
    ).toMatchObject({ acceptingNewInstances: false });
    expect(
      await prisma.productEvolution.findUnique({
        where: {
          productId_vpsProviderId: {
            productId: 'product-a',
            vpsProviderId: 'evo-a',
          },
        },
      }),
    ).toMatchObject({
      acceptingNewInstances: false,
      allocationPriority: 7,
      configurationRevision: 2,
    });
  });

  it('permits old writers during expansion and refuses ambiguous consolidation', async () => {
    await prisma.$executeRaw`INSERT INTO "Product" (id,name,slug,"apiKeyHash",origins,"vpsProviderId","updatedAt")
      VALUES ('late-product','Late','late','hash-late',ARRAY[]::text[],'evo-b',NOW())`;
    await prisma.instance.create({
      data: {
        id: 'late-instance',
        ...instanceData('late', 'late-product', 'evo-b'),
      },
    });
    expect(
      await prisma.productEvolution.findUnique({
        where: {
          productId_vpsProviderId: {
            productId: 'late-product',
            vpsProviderId: 'evo-b',
          },
        },
      }),
    ).toBeNull();
    const duplicate = await prisma.instance.create({
      data: {
        ...instanceData('ambiguous'),
        providerInstanceId: 'remote-original-a',
      },
    });
    expect((await diagnoseEvolutionBase(prisma)).duplicateRemoteIds).toBe(1);
    expect(() =>
      sqlFile('prisma/operations/evolution-base-constraints.sql'),
    ).toThrow('SQL operation failed');
    await prisma.instance.delete({ where: { id: duplicate.id } });
    sqlFile('prisma/operations/evolution-base-constraints.sql');
    sqlFile('prisma/operations/evolution-base-constraints.sql');
    expect((await diagnoseEvolutionBase(prisma)).missingLinks).toBe(0);
  });

  it('enforces instance membership and protects the current default from detachment', async () => {
    await expect(
      prisma.instance.create({
        data: instanceData('invalid-link', 'product-empty'),
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.productEvolution.delete({
        where: {
          productId_vpsProviderId: {
            productId: 'product-b',
            vpsProviderId: 'evo-a',
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('preserves uniqueness by product/name, provider/name and remote identity', async () => {
    await expect(
      prisma.instance.create({
        data: {
          ...instanceData('original-a', 'product-b'),
          providerInstanceId: 'different-id',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.instance.create({
        data: instanceData('original-a', 'product-a', 'evo-b'),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.instance.create({
        data: {
          ...instanceData('new-name'),
          providerInstanceId: 'remote-original-a',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows null/positive capacity and rejects invalid numeric values', async () => {
    for (const value of [3, null]) {
      expect(
        (
          await prisma.vpsProvider.update({
            where: { id: 'evo-b' },
            data: { maxInstances: value },
          })
        ).maxInstances,
      ).toBe(value);
    }
    for (const value of [0, -1]) {
      await expect(
        prisma.vpsProvider.update({
          where: { id: 'evo-b' },
          data: { maxInstances: value },
        }),
      ).rejects.toThrow();
    }
    expect(
      (await prisma.vpsProvider.findUniqueOrThrow({ where: { id: 'evo-b' } }))
        .maxInstances,
    ).toBeNull();
  });

  it('serializes conflicting open names across independent PostgreSQL connections', async () => {
    const outcomes = await Promise.allSettled([
      prisma.instanceProvisioning.create({ data: reservation('race') }),
      replica.instanceProvisioning.create({
        data: reservation('race', 'product-b'),
      }),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(1);
    await prisma.instanceProvisioning.updateMany({
      where: { instanceName: 'race' },
      data: { state: 'uncertain', leaseExpiresAt: new Date(0) },
    });
    await expect(
      replica.instanceProvisioning.create({ data: reservation('race') }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await prisma.instanceProvisioning.updateMany({
      where: { instanceName: 'race' },
      data: { state: 'released', linkProductId: null, linkVpsProviderId: null },
    });
    await expect(
      replica.instanceProvisioning.create({ data: reservation('race') }),
    ).resolves.toBeDefined();
  });

  it('protects a product name across hosts and requires the matching active link', async () => {
    await prisma.instanceProvisioning.create({
      data: reservation('same-product'),
    });
    await expect(
      replica.instanceProvisioning.create({
        data: reservation('same-product', 'product-a', 'evo-b'),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.instanceProvisioning.create({
        data: {
          ...reservation('invalid-reservation'),
          linkProductId: null,
          linkVpsProviderId: null,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.instanceProvisioning.create({
        data: {
          ...reservation('wrong-link'),
          linkProductId: 'product-b',
        },
      }),
    ).rejects.toThrow();
  });

  it('retains terminal provisioning evidence after deleting an instance', async () => {
    const instance = await createLinkedInstance(db, instanceData('history'));
    const operation = await prisma.instanceProvisioning.create({
      data: {
        productId: instance.productId,
        vpsProviderId: instance.vpsProviderId,
        instanceName: instance.instanceName,
        requestHash: 'history',
        state: 'committed',
        instanceId: instance.id,
      },
    });
    await prisma.instance.delete({ where: { id: instance.id } });
    expect(
      await prisma.instanceProvisioning.findUnique({
        where: { id: operation.id },
      }),
    ).toMatchObject({
      instanceId: null,
      state: 'committed',
      productId: 'product-a',
      vpsProviderId: 'evo-a',
    });
  });

  it('allows one active reconciliation per provider even after a lease expires', async () => {
    const outcomes = await Promise.allSettled([
      prisma.evolutionReconciliation.create({
        data: { vpsProviderId: 'evo-a', leaseExpiresAt: new Date(0) },
      }),
      replica.evolutionReconciliation.create({
        data: { vpsProviderId: 'evo-a' },
      }),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('keeps old product responses and writes the default link in the same transaction', async () => {
    const created = await products.create({
      name: 'New',
      slug: 'new',
      vpsProviderId: 'evo-a',
    });
    expect(Object.keys(created).sort()).toEqual(
      [...[...productFields], 'apiKey'].sort(),
    );
    expect(created.apiKey).toHaveLength(64);
    expect(
      await prisma.productEvolution.findUnique({
        where: {
          productId_vpsProviderId: {
            productId: created.id,
            vpsProviderId: 'evo-a',
          },
        },
      }),
    ).toMatchObject({ acceptingNewInstances: true });
    await products.update(created.id, {
      name: 'Updated',
      allocationMode: 'capacity',
      allocationRevision: 50,
      evolutions: { deleteMany: {} },
    } as UpdateProductDto);
    expect(
      await prisma.product.findUnique({ where: { id: created.id } }),
    ).toMatchObject({ allocationMode: 'legacy', allocationRevision: 0 });
    expect(Object.keys(await products.findOne(created.id)).sort()).toEqual(
      [...productFields].sort(),
    );
    expect(Object.keys(await products.deactivate(created.id)).sort()).toEqual(
      [...productFields].sort(),
    );
    expect(Object.keys(await products.rotateKey(created.id)).sort()).toEqual(
      [...[...productFields], 'apiKey'].sort(),
    );
  });

  it('does not overwrite an explicit pause when the legacy product form saves', async () => {
    await products.update('product-a', {
      name: 'A updated',
      vpsProviderId: 'evo-a',
    });
    expect(
      await prisma.productEvolution.findUnique({
        where: {
          productId_vpsProviderId: {
            productId: 'product-a',
            vpsProviderId: 'evo-a',
          },
        },
      }),
    ).toMatchObject({
      acceptingNewInstances: false,
      allocationPriority: 7,
      configurationRevision: 2,
    });
    await products.update('product-empty', { vpsProviderId: 'evo-a' });
    await products.update('product-empty', { vpsProviderId: 'evo-b' });
    expect(
      await prisma.productEvolution.count({
        where: { productId: 'product-empty' },
      }),
    ).toBe(2);
    await expect(
      products.create({
        name: 'Invalid',
        slug: 'invalid-provider',
        vpsProviderId: 'missing',
      }),
    ).rejects.toThrow();
    expect(
      await prisma.product.count({ where: { slug: 'invalid-provider' } }),
    ).toBe(0);
  });

  it('leaves new defaults paused when only the legacy field of a capacity product changes', async () => {
    const product = await products.create({
      name: 'Capacity fixture',
      slug: 'capacity-fixture',
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { allocationMode: 'capacity' },
    });
    await products.update(product.id, { vpsProviderId: 'evo-a' });
    expect(
      await prisma.productEvolution.findUnique({
        where: {
          productId_vpsProviderId: {
            productId: product.id,
            vpsProviderId: 'evo-a',
          },
        },
      }),
    ).toMatchObject({ acceptingNewInstances: false });
  });

  it('keeps provider and nested VPS responses unchanged, without leaking new fields', async () => {
    const provider = await providers.create('vps-test', {
      label: 'Alias',
      providerUrl: 'HTTPS://EVO-A.INVALID:443/',
      providerApiKey: 'fixture-new-key',
    });
    expect(Object.keys(provider).sort()).toEqual([...providerFields].sort());
    expect(provider.providerApiKey).toBe('fixture-new-key');
    await prisma.vpsProvider.update({
      where: { id: provider.id },
      data: { callbackTokenEncrypted: 'private-callback' },
    });
    expect(
      await providers.update('vps-test', provider.id, { label: 'Renamed' }),
    ).not.toHaveProperty('callbackTokenEncrypted');
    expect(await providers.deactivate('vps-test', provider.id)).toMatchObject({
      isActive: false,
    });
    const list = (await vps.findAll()) as Array<{
      providers?: Record<string, unknown>[];
    }>;
    for (const entry of list.flatMap((row) => row.providers ?? [])) {
      expect(Object.keys(entry).sort()).toEqual([...providerFields].sort());
    }
    const report = await diagnoseEvolutionBase(prisma);
    expect(report.endpointAliasGroups).toBe(1);
    expect(report.sharedProviders).toBeGreaterThan(0);
    expect(report.missingLinks).toBe(0);
    expect(JSON.stringify(report)).not.toContain('fixture-new-key');
  });

  it('preserves individual and bulk import contracts, linking each successful insert', async () => {
    const http = { request: jest.fn() };
    const admin = new AdminInstancesService(
      db,
      {} as InstanceService,
      {} as MessageService,
      http as unknown as EvolutionHttpService,
      config,
    );
    const single = await admin.importSingleInstance('product-b', {
      id: 'remote-single',
      name: 'single',
      token: 'fixture-token',
    });
    expect(Object.keys(single).sort()).toEqual(['hubInstanceId', 'result']);
    expect(single.result).toBe('created');
    expect(typeof single.hubInstanceId).toBe('string');
    http.request.mockResolvedValue([
      { id: 'remote-single', name: 'single', token: 'fixture-token' },
      { id: 'remote-bulk', name: 'bulk', token: 'fixture-token' },
      { id: 'remote-original-a', name: 'original-a', token: 'fixture-token' },
    ]);
    const bulk = await admin.importBulkInstances('product-b');
    expect(bulk).toMatchObject({ created: 1, skipped: 1, errors: 1 });
    expect(bulk.details.find((d) => d.result === 'error')).toHaveProperty(
      'reason',
    );
    expect((await diagnoseEvolutionBase(prisma)).missingLinks).toBe(0);
  });

  it('preserves old administrative HTTP paths, bodies, statuses and response fields', async () => {
    const module = await Test.createTestingModule({
      controllers: [ProductsController, VpsProviderController, VpsController],
      providers: [
        { provide: ProductsService, useValue: products },
        { provide: VpsProviderService, useValue: providers },
        { provide: VpsService, useValue: vps },
      ],
    })
      .overrideGuard(JwtGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    try {
      const providerResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/vps/vps-test/providers',
        payload: {
          label: 'HTTP provider',
          providerUrl: 'https://http.invalid',
          providerApiKey: 'fixture-http-key',
        },
      });
      expect(providerResponse.statusCode).toBe(201);
      const provider = providerResponse.json<{ id: string }>();
      expect(Object.keys(provider).sort()).toEqual([...providerFields].sort());
      const create = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/products',
        payload: {
          name: 'HTTP product',
          slug: 'http-product',
          vpsProviderId: provider.id,
        },
      });
      expect(create.statusCode).toBe(201);
      const product = create.json<{ id: string }>();
      expect(Object.keys(product).sort()).toEqual(
        [...productFields, 'apiKey'].sort(),
      );
      const update = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/products/${product.id}`,
        payload: { name: 'HTTP changed', hubRelay: false },
      });
      expect(update.statusCode).toBe(200);
      expect(
        Object.keys(update.json<Record<string, unknown>>()).sort(),
      ).toEqual([...productFields].sort());
      const list = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/products',
      });
      expect(list.statusCode).toBe(200);
      expect(Array.isArray(list.json<unknown>())).toBe(true);
      const deactivate = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/vps/vps-test/providers/${provider.id}`,
      });
      expect(deactivate.statusCode).toBe(200);
      expect(deactivate.json<{ isActive: boolean }>().isActive).toBe(false);
    } finally {
      await app.close();
    }
  });
});
