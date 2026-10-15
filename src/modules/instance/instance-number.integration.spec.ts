import { BadGatewayException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { EvolutionAdapter } from '../../adapters/evolution/evolution.adapter';
import { EvolutionHttpService } from '../../adapters/evolution/evolution.http';
import type { AuthCachePayload } from '../../auth/apikey.guard';
import { CacheService } from '../../cache/cache.service';
import {
  encryptAES256GCM,
  hashSHA256,
  signJwt,
} from '../../common/crypto.util';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import { InstanceResolverService } from '../../resolver/instance.resolver';
import { AdminInstancesController } from '../admin/instances/admin-instances.controller';
import { AdminInstancesService } from '../admin/instances/admin-instances.service';
import { MessageService } from '../message/message.service';
import { EvolutionProvisioningService } from '../provisioning/evolution-provisioning.service';
import { InstanceController } from './instance.controller';
import { InstanceService } from './instance.service';

const PHONE = '5511999990000';
const KEY = 'a'.repeat(64);
const API_KEY = 'instance-number-fixture-key';
const JWT_SECRET = 'instance-number-fixture-secret';
const PUBLIC = '/api/v1/instance';
const ADMIN = '/api/v1/admin/products/product-fixture/instances';
const LISTS = [`${PUBLIC}/list`, ADMIN];
const DETAILS = [`${PUBLIC}/hub-fixture`, `${ADMIN}/hub-fixture`];
const READS = [...LISTS, ...DETAILS];
const REMOTE = Object.freeze({
  id: 'provider-instance-fixture',
  name: 'number-fixture',
  instanceName: 'number-fixture',
  status: 'open',
  connectionStatus: 'open',
  ownerJid: `${PHONE}@s.whatsapp.net`,
  number: null,
  profileName: 'Synthetic profile',
  profilePicUrl: 'https://fixture.invalid/photo',
  integration: 'WHATSAPP-BAILEYS',
  token: 'synthetic-token',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  Proxy: Object.freeze({ enabled: false, number: null }),
  Setting: Object.freeze({ readMessages: false }),
  _count: Object.freeze({ Message: 0, Contact: 1, Chat: 0 }),
});

// In-memory HTTP injection. No AppModule, listening socket, real provider, DB or Redis.
describe('Instance number — Data/Admin query contracts', () => {
  let app: NestFastifyApplication;
  let product: AuthCachePayload;
  const http = { request: jest.fn() };
  const prisma = {
    product: { findUnique: jest.fn() },
    vpsProvider: { findUnique: jest.fn() },
    instance: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const cache = {
    get: jest.fn(),
    setWithTTL: jest.fn(),
    increment: jest.fn(),
    expire: jest.fn(),
  };
  const provider = {
    id: 'provider-fixture',
    providerUrl: 'https://fixture.invalid',
    providerApiKey: encryptAES256GCM('synthetic-provider-key', KEY),
    adapterType: 'evolution',
    isActive: true,
  };
  const row = {
    id: 'hub-fixture',
    productId: 'product-fixture',
    vpsProviderId: provider.id,
    providerInstanceId: REMOTE.id,
    instanceName: REMOTE.name,
    isActive: true,
  };

  const headers = (url: string) =>
    url.startsWith(PUBLIC)
      ? { apikey: API_KEY }
      : {
          authorization: `Bearer ${signJwt({ sub: 'fixture-admin' }, JWT_SECRET, 3600)}`,
        };
  const get = (url: string) =>
    app.inject({ method: 'GET', url, headers: headers(url) });

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    product = {
      productId: row.productId,
      apiKeyHash: hashSHA256(API_KEY),
      isActive: true,
      origins: [],
      hubRelay: false,
      adapterType: 'evolution',
      vpsProviderId: provider.id,
      batchWebhookEnabled: false,
      batchWebhookUrl: null,
    };
    prisma.product.findUnique.mockImplementation(() =>
      Promise.resolve({ ...product, id: product.productId }),
    );
    prisma.vpsProvider.findUnique.mockResolvedValue(provider);
    prisma.instance.findMany.mockResolvedValue([row]);
    prisma.instance.findFirst.mockImplementation(() =>
      Promise.resolve({ ...row, product, vpsProvider: provider }),
    );
    cache.get.mockImplementation((key: string) =>
      Promise.resolve(key === `auth:${product.apiKeyHash}` ? product : null),
    );
    cache.increment.mockResolvedValue(1);
    http.request.mockResolvedValue([REMOTE]);

    const module = await Test.createTestingModule({
      controllers: [InstanceController, AdminInstancesController],
      providers: [
        InstanceService,
        AdminInstancesService,
        InstanceResolverService,
        EvolutionAdapter,
        {
          provide: ConfigService,
          useValue: new ConfigService({ ENCRYPTION_KEY: KEY, JWT_SECRET }),
        },
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
        { provide: EvolutionHttpService, useValue: http },
        { provide: EvolutionProvisioningService, useValue: {} },
        { provide: MessageService, useValue: {} },
        {
          provide: AdapterResolverService,
          inject: [EvolutionAdapter],
          useFactory: (adapter: EvolutionAdapter) => ({
            resolve: () => adapter,
          }),
        },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    expect(prisma.instance.create).not.toHaveBeenCalled();
    expect(prisma.instance.update).not.toHaveBeenCalled();
    expect(prisma.instance.delete).not.toHaveBeenCalled();
    expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it.each(READS)(
    'fills only number and retains the response contract: %s',
    async (url) => {
      const response = await get(url);
      const expected = { ...REMOTE, hubId: row.id, number: PHONE };
      expect(response.statusCode).toBe(200);
      expect(response.json<unknown>()).toStrictEqual(
        LISTS.includes(url) ? [expected] : expected,
      );
      expect(REMOTE.number).toBeNull();
      expect(http.request).toHaveBeenCalledTimes(1);
      expect(http.request).toHaveBeenCalledWith(
        'get',
        provider.providerUrl,
        'synthetic-provider-key',
        '/instance/fetchInstances',
        undefined,
        LISTS.includes(url) ? undefined : { instanceName: REMOTE.name },
        ...(LISTS.includes(url) ? [undefined] : []),
      );
      expect(prisma.instance.findMany).toHaveBeenCalledTimes(
        LISTS.includes(url) ? 1 : 0,
      );
      expect(prisma.instance.findFirst).toHaveBeenCalledTimes(
        LISTS.includes(url) ? 0 : 1,
      );
    },
  );

  it.each(READS)('keeps authentication mandatory: %s', async (url) => {
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(401);
    expect(http.request).not.toHaveBeenCalled();
    expect(prisma.instance.findMany).not.toHaveBeenCalled();
    expect(prisma.instance.findFirst).not.toHaveBeenCalled();
  });

  it.each(READS)('does not enrich another adapter: %s', async (url) => {
    product.adapterType = 'fixture-other';
    const response = await get(url);
    const expected = { ...REMOTE, hubId: row.id };
    expect(response.statusCode).toBe(200);
    expect(response.json<unknown>()).toStrictEqual(
      LISTS.includes(url) ? [expected] : expected,
    );
  });

  it.each(LISTS)(
    'preserves selection, order, existing numbers and omitted orphans: %s',
    async (url) => {
      const existing = {
        ...REMOTE,
        id: 'existing-id',
        name: 'existing',
        instanceName: 'existing',
        number: '+1 555 000 0000',
      };
      const unknown = {
        ...REMOTE,
        id: 'unknown-id',
        name: 'unknown',
        instanceName: 'unknown',
        ownerJid: '123@lid',
      };
      const foreign = {
        ...REMOTE,
        id: 'foreign-id',
        name: 'foreign',
        instanceName: 'foreign',
      };
      http.request.mockResolvedValue([unknown, REMOTE, foreign, existing]);
      prisma.instance.findMany.mockResolvedValue([
        {
          ...row,
          id: 'existing-hub',
          providerInstanceId: existing.id,
          instanceName: existing.name,
        },
        row,
        {
          ...row,
          id: 'unknown-hub',
          providerInstanceId: unknown.id,
          instanceName: unknown.name,
        },
        {
          ...row,
          id: 'orphan-hub',
          providerInstanceId: 'orphan-id',
          instanceName: 'orphan',
        },
      ]);
      const response = await get(url);
      expect(response.statusCode).toBe(200);
      expect(response.json<unknown>()).toStrictEqual([
        { ...existing, hubId: 'existing-hub' },
        { ...REMOTE, hubId: row.id, number: PHONE },
        { ...unknown, hubId: 'unknown-hub' },
      ]);
      expect(prisma.instance.findMany).toHaveBeenCalledWith({
        where: { productId: product.productId, isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      expect(http.request).toHaveBeenCalledTimes(1);
    },
  );

  it.each(LISTS)('retains instance_name filtering: %s', async (url) => {
    const response = await get(`${url}?instance_name=%20Number%20`);
    expect(response.statusCode).toBe(200);
    expect(prisma.instance.findMany).toHaveBeenCalledWith({
      where: {
        productId: product.productId,
        isActive: true,
        instanceName: { contains: 'Number', mode: 'insensitive' },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(response.json<unknown>()).toStrictEqual([
      { ...REMOTE, hubId: row.id, number: PHONE },
    ]);
  });

  it.each(LISTS)('retains an empty list: %s', async (url) => {
    prisma.instance.findMany.mockResolvedValue([]);
    const response = await get(url);
    expect(response.statusCode).toBe(200);
    expect(response.json<unknown>()).toStrictEqual([]);
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it.each(DETAILS)(
    'keeps product-scoped resolution and 404 before provider access: %s',
    async (url) => {
      prisma.instance.findFirst.mockResolvedValue(null);
      const response = await get(url);
      expect(response.statusCode).toBe(404);
      expect(response.json<unknown>()).toStrictEqual({
        statusCode: 404,
        error: 'NOT_FOUND',
        message: `Instância "${row.id}" não encontrada`,
      });
      expect(prisma.instance.findFirst).toHaveBeenCalledWith({
        where: {
          productId: product.productId,
          isActive: true,
          OR: [{ id: row.id }, { providerInstanceId: row.id }],
        },
        include: { vpsProvider: true, product: true },
      });
      expect(http.request).not.toHaveBeenCalled();
    },
  );

  it.each(DETAILS)('continues accepting the provider ID: %s', async (url) => {
    const response = await get(url.replace(row.id, REMOTE.id));
    expect(response.statusCode).toBe(200);
    expect(response.json<unknown>()).toStrictEqual({
      ...REMOTE,
      hubId: row.id,
      number: PHONE,
    });
    expect(prisma.instance.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          productId: product.productId,
          isActive: true,
          OR: [{ id: REMOTE.id }, { providerInstanceId: REMOTE.id }],
        },
      }),
    );
  });

  it.each(READS)(
    'keeps the existing provider error envelope: %s',
    async (url) => {
      http.request.mockRejectedValue(
        new BadGatewayException('Fixture provider unavailable'),
      );
      const response = await get(url);
      expect(response.statusCode).toBe(502);
      expect(response.json<unknown>()).toStrictEqual({
        statusCode: 502,
        error: 'BAD_GATEWAY',
        message: 'Fixture provider unavailable',
      });
      expect(http.request).toHaveBeenCalledTimes(1);
    },
  );

  it.each([`${ADMIN}/hub`, `${ADMIN}/hub/${row.id}`])(
    'leaves database-only responses unchanged: %s',
    async (url) => {
      const local = {
        id: row.id,
        instanceName: row.instanceName,
        providerInstanceId: REMOTE.id,
        status: 'connected',
        phoneNumber: null,
        createdAt: REMOTE.createdAt,
        updatedAt: REMOTE.updatedAt,
      };
      prisma.instance.findMany.mockResolvedValue([local]);
      prisma.instance.findFirst.mockResolvedValue(local);
      const response = await get(url);
      expect(response.statusCode).toBe(200);
      expect(response.json<unknown>()).toStrictEqual(
        url.endsWith('/hub') ? [local] : local,
      );
      expect(http.request).not.toHaveBeenCalled();
    },
  );

  it.each(DETAILS.flatMap((url) => [`${url}/connect`, `${url}/status`]))(
    'leaves connect/status payloads unchanged: %s',
    async (url) => {
      const body = {
        instance: { instanceName: REMOTE.name, state: 'open' },
        ownerJid: REMOTE.ownerJid,
        number: null,
      };
      http.request.mockResolvedValue(body);
      const response = await get(url);
      expect(response.statusCode).toBe(200);
      expect(response.json<unknown>()).toStrictEqual(body);
      expect(http.request).toHaveBeenCalledTimes(1);
      expect(http.request).toHaveBeenCalledWith(
        'get',
        provider.providerUrl,
        'synthetic-provider-key',
        url.endsWith('/connect')
          ? `/instance/connect/${REMOTE.name}`
          : `/instance/connectionState/${REMOTE.name}`,
        ...(url.endsWith('/connect') ? [undefined, undefined, undefined] : []),
      );
    },
  );

  it('does not alter adapter inventory used by provisioning and recovery', async () => {
    const adapter = app.get<EvolutionAdapter>(EvolutionAdapter);
    const inventory = await adapter.fetchInstances({
      providerUrl: provider.providerUrl,
      providerApiKey: 'synthetic-provider-key',
    });
    expect(inventory).toStrictEqual([REMOTE]);
    expect(REMOTE.number).toBeNull();
  });
});
