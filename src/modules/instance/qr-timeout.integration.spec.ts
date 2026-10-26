import { EvolutionMediaService } from '../../adapters/evolution/evolution.media';
import { EvolutionProvisioningService } from '../provisioning/evolution-provisioning.service';
import { EvolutionInventoryService } from '../provisioning/evolution-inventory.service';
import { provisionPersistence } from '../../../test/support/provisioning-prisma.fixture';
import { ExecutionContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createServer, get, request as httpRequest, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { EvolutionAdapter } from '../../adapters/evolution/evolution.adapter';
import { EvolutionHttpService } from '../../adapters/evolution/evolution.http';
import { AuditInterceptor } from '../../audit/audit.interceptor';
import { AuditService } from '../../audit/audit.service';
import { ApiKeyGuard } from '../../auth/apikey.guard';
import { JwtGuard } from '../../auth/jwt.guard';
import { RateLimitGuard } from '../../auth/rate-limit.guard';
import { CacheService } from '../../cache/cache.service';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { TimeoutInterceptor } from '../../common/interceptors/timeout.interceptor';
import { PrismaService } from '../../prisma/prisma.service';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import { InstanceResolverService } from '../../resolver/instance.resolver';
import { AdminInstancesController } from '../admin/instances/admin-instances.controller';
import { AdminInstancesService } from '../admin/instances/admin-instances.service';
import { MessageService } from '../message/message.service';
import { InstanceController } from './instance.controller';
import { InstanceService } from './instance.service';

jest.mock('../../common/crypto.util', () => {
  const actual = jest.requireActual<typeof import('../../common/crypto.util')>(
    '../../common/crypto.util',
  );
  return {
    ...actual,
    decryptAES256GCM: (value: string, key: string) =>
      value.split(':').length === 3 && value.length > 100
        ? actual.decryptAES256GCM(value, key)
        : 'fixture-key',
  };
});

// Only loopback HTTP is real. No AppModule, database, Redis, queue or external Evolution.
describe('QR timeout — local HTTP integration', () => {
  let upstream: Server;
  let app: NestFastifyApplication;
  let providerUrl: string;
  let hubUrl: string;
  let responseBody: unknown;
  let proxySetBody: unknown;
  let proxyFindBody: unknown;
  let responseStatus: number;
  let responseStatuses: Record<string, number>;
  let hang: boolean;
  let calls: string[];
  let requestBodies: Record<string, string>;
  let started: Promise<void>;
  let closed: Promise<void>;
  let onStarted: () => void;
  let onClosed: () => void;
  let audit: jest.Mock;
  let terminalLog: jest.SpyInstance;
  let warningLog: jest.SpyInstance;
  let values: Record<string, unknown>;
  let delays: Record<string, number>;
  let stalledPaths: Set<string>;
  let legacyTimeoutMs = 100;
  let prisma: {
    $transaction: jest.Mock;
    product: { findUnique: jest.Mock };
    productEvolution: { createMany: jest.Mock };
    instance: {
      findFirst: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
    };
    productDefaultWebhook: { findUnique: jest.Mock };
    productDefaultProxy: { findUnique: jest.Mock };
  };
  const publicConnect = '/api/v1/instance/hub-fixture/connect';
  const adminConnect =
    '/api/v1/admin/products/product-fixture/instances/hub-fixture/connect';

  it.each([false, true])(
    'releases a definitive create rejection, then accepts the corrected request (qrcode=%s)',
    async (qrcode) => {
      const db = app.get(PrismaService);
      (db.instanceProvisioning.findFirst as jest.Mock).mockImplementation(
        async () => {
          const row = await db.instanceProvisioning.findUnique({
            where: { id: 'intent-fixture' },
          });
          return row &&
            ['reserved', 'creating', 'uncertain', 'cleanup_pending'].includes(
              row.state,
            )
            ? row
            : null;
        },
      );
      const body = {
        status: 400,
        error: 'Bad Request',
        response: { message: ['Invalid integration'] },
      };
      responseStatuses['/instance/create'] = 400;
      responseBody = body;
      const rejected = await app.inject({
        method: 'POST',
        url: '/api/v1/instance/create',
        payload: { instanceName: 'diagnostic', integration: 'INVALID', qrcode },
      });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json()).toEqual(body);
      const row = await db.instanceProvisioning.findUniqueOrThrow({
        where: { id: 'intent-fixture' },
      });
      expect(row.state).toBe('failed');
      expect(row.encryptedRequest).toBeNull();
      expect(row.errorCode).toBe('invalid_integration');
      responseStatuses['/instance/create'] = 201;
      responseBody = {
        instance: {
          instanceName: 'diagnostic',
          instanceId: 'remote-created',
          status: 'close',
        },
      };
      const corrected = await app.inject({
        method: 'POST',
        url: '/api/v1/instance/create',
        payload: {
          instanceName: 'diagnostic',
          integration: 'WHATSAPP-BAILEYS',
          qrcode,
        },
      });
      expect(corrected.statusCode).toBe(201);
      expect(corrected.json()).toMatchObject({
        hubId: 'hub-created',
        instanceId: 'remote-created',
      });
      expect(calls.filter((path) => path === '/instance/create')).toHaveLength(
        2,
      );
    },
  );

  it('keeps an unclassified upstream 400 uncertain and does not issue another POST', async () => {
    const db = app.get(PrismaService);
    (db.instanceProvisioning.findFirst as jest.Mock).mockImplementation(
      async () => {
        const row = await db.instanceProvisioning.findUnique({
          where: { id: 'intent-fixture' },
        });
        return row &&
          ['reserved', 'creating', 'uncertain', 'cleanup_pending'].includes(
            row.state,
          )
          ? row
          : null;
      },
    );
    responseStatuses['/instance/create'] = 400;
    responseBody = { message: 'Unclassified failure' };
    const payload = {
      instanceName: 'uncertain-diagnostic',
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/instance/create',
          payload,
        })
      ).statusCode,
    ).toBe(400);
    const row = await db.instanceProvisioning.findUniqueOrThrow({
      where: { id: 'intent-fixture' },
    });
    expect(row.state).toBe('uncertain');
    expect(row.errorCode).toBe('upstream_unclassified');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/instance/create',
          payload,
        })
      ).statusCode,
    ).toBe(409);
    expect(calls.filter((path) => path === '/instance/create')).toHaveLength(1);
  });
  const product = {
    productId: 'product-fixture',
    apiKeyHash: 'fixture-hash',
    isActive: true,
    origins: [],
    hubRelay: false,
    adapterType: 'evolution',
    vpsProviderId: 'provider-fixture',
    batchWebhookEnabled: false,
    batchWebhookUrl: null,
  };

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      const path = req.url ?? '';
      calls.push(path);
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        requestBodies[path] = body;
      });
      req.resume();
      if (path.includes('/connect/') || stalledPaths.has(path)) {
        res.once('close', onClosed);
        onStarted();
        if (hang || stalledPaths.has(path)) return;
      }
      const respond = () => {
        res.statusCode = responseStatuses[path] ?? responseStatus;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify(
            path === '/instance/fetchInstances'
              ? []
              : path.startsWith('/webhook/set/')
                ? { enabled: true }
                : path.startsWith('/proxy/set/')
                  ? proxySetBody
                  : path.startsWith('/proxy/find/')
                    ? proxyFindBody
                    : responseBody,
          ),
        );
      };
      if (delays[path]) {
        const timer = setTimeout(respond, delays[path]);
        res.once('close', () => clearTimeout(timer));
      } else respond();
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, '127.0.0.1', resolve),
    );
    providerUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    responseBody = { base64: 'fixture-qr-must-not-be-logged' };
    proxySetBody = { enabled: true };
    proxyFindBody = null;
    responseStatus = 200;
    responseStatuses = {};
    hang = false;
    delays = {};
    stalledPaths = new Set();
    calls = [];
    requestBodies = {};
    started = new Promise((resolve) => {
      onStarted = resolve;
    });
    closed = new Promise((resolve) => {
      onClosed = resolve;
    });
    audit = jest.fn();
    terminalLog = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    warningLog = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    values = {
      PROXY_TIMEOUT_MS: legacyTimeoutMs,
      PROXY_MAX_RETRIES: 1,
      QR_REQUEST_TIMEOUT_MS: 2000,
      QR_PROVIDER_TIMEOUT_MS: 250,
      CIRCUIT_BREAKER_THRESHOLD: 5,
      CIRCUIT_BREAKER_RESET_MS: 30000,
      ENCRYPTION_KEY: 'a'.repeat(64),
    };
    prisma = {
      $transaction: jest.fn((work: (tx: unknown) => unknown) => work(prisma)),
      product: {
        findUnique: jest.fn().mockResolvedValue({
          ...product,
          id: product.productId,
          allocationMode: 'legacy',
        }),
      },
      productEvolution: { createMany: jest.fn() },
      instance: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'hub-created' }),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      productDefaultWebhook: { findUnique: jest.fn().mockResolvedValue(null) },
      productDefaultProxy: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const module = await Test.createTestingModule({
      controllers: [InstanceController, AdminInstancesController],
      providers: [
        InstanceService,
        EvolutionProvisioningService,
        { provide: EvolutionInventoryService, useValue: {} },
        AdminInstancesService,
        EvolutionHttpService,
        EvolutionAdapter,
        { provide: EvolutionMediaService, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => values[key],
            getOrThrow: (key: string) => values[key],
          },
        },
        {
          provide: PrismaService,
          useValue: provisionPersistence({
            vpsProvider: {
              findUnique: jest.fn().mockResolvedValue({
                id: product.vpsProviderId,
                providerUrl,
                providerApiKey: 'fixture-encrypted',
                adapterType: 'evolution',
                isActive: true,
                maxInstances: null,
                acceptingNewInstances: true,
              }),
            },
            ...prisma,
          }),
        },
        { provide: CacheService, useValue: { del: jest.fn() } },
        { provide: MessageService, useValue: {} },
        {
          provide: InstanceResolverService,
          useValue: {
            resolveById: jest.fn().mockResolvedValue({
              providerUrl,
              providerApiKey: 'fixture-key',
              vpsProviderId: product.vpsProviderId,
              instanceId: 'hub-fixture',
              instanceName: 'fixture',
              adapterType: 'evolution',
            }),
          },
        },
        {
          provide: AdapterResolverService,
          inject: [EvolutionAdapter],
          useFactory: (adapter: EvolutionAdapter) => ({
            resolve: () => adapter,
          }),
        },
        { provide: AuditService, useValue: { log: audit } },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context
            .switchToHttp()
            .getRequest<{ product: typeof product }>().product = product;
          return true;
        },
      })
      .overrideGuard(RateLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(JwtGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    hubUrl = await app.getUrl();
    terminalLog.mockClear();
  });

  afterEach(async () => {
    upstream.closeAllConnections();
    await app.close();
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it.each([publicConnect, adminConnect])(
    'returns the existing 408 envelope and closes a stalled upstream: %s',
    async (url) => {
      hang = true;
      const response = await app.inject({ method: 'GET', url });
      await closed;
      expect(response.statusCode).toBe(408);
      expect(response.json<unknown>()).toEqual({
        statusCode: 408,
        error: 'REQUEST_TIMEOUT',
        message: 'Request timeout',
      });
      expect(calls).toEqual(['/instance/connect/fixture']);
      expect(terminalLog).toHaveBeenCalledTimes(1);
      expect(terminalLog).toHaveBeenCalledWith(
        expect.stringContaining('provider_timeout'),
      );
    },
  );

  it.each([
    { base64: 'fixture-qr-must-not-be-logged' },
    { instance: { instanceName: 'fixture', state: 'open' } },
    { count: 0 },
  ])('preserves connect response without requiring a QR: %p', async (body) => {
    responseBody = body;
    const response = await app.inject({ method: 'GET', url: publicConnect });
    expect(response.statusCode).toBe(200);
    expect(response.json<unknown>()).toEqual(body);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 200, errorMsg: undefined }),
    );
    expect(JSON.stringify(terminalLog.mock.calls)).not.toContain(
      'fixture-qr-must-not-be-logged',
    );
    expect(JSON.stringify(terminalLog.mock.calls)).not.toContain('fixture-key');
  });

  it.each([400, 408, 504])(
    'preserves an actual upstream HTTP %s and labels its origin internally',
    async (status) => {
      responseStatus = status;
      responseBody = { message: 'fixture upstream failure' };
      const response = await app.inject({ method: 'GET', url: publicConnect });
      expect(response.statusCode).toBe(status);
      expect(response.json<unknown>()).toEqual(responseBody);
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: status,
          errorMsg: 'upstream_http',
        }),
      );
      expect(calls).toHaveLength(1);
    },
  );

  it.each([
    ['/api/v1/instance/create', true],
    ['/api/v1/admin/products/product-fixture/instances', true],
    ['/api/v1/instance/create', false],
  ] as const)(
    'preserves successful create status/body: %s qrcode=%s',
    async (url, qrcode) => {
      responseBody = {
        instance: {
          instanceName: 'fixture',
          instanceId: 'remote-created',
          status: 'connecting',
        },
        qrcode: { base64: 'fixture' },
      };
      const response = await app.inject({
        method: 'POST',
        url,
        payload: { instanceName: 'fixture', qrcode },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json<unknown>()).toEqual({
        instanceName: 'fixture',
        instanceId: 'remote-created',
        status: 'connecting',
        qrcode: { base64: 'fixture' },
        hubId: 'hub-created',
      });
      expect(calls).toEqual(['/instance/fetchInstances', '/instance/create']);
    },
  );

  it('keeps a concurrent status request independent of a cancelled QR', async () => {
    hang = true;
    responseBody = { instance: { state: 'open' } };
    const qr = app
      .inject({ method: 'GET', url: publicConnect })
      .then((response) => response);
    await started;
    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/instance/hub-fixture/status',
    });
    expect(status.statusCode).toBe(200);
    expect(status.json<unknown>()).toEqual(responseBody);
    expect((await qr).statusCode).toBe(408);
    expect(calls).toEqual([
      '/instance/connect/fixture',
      '/instance/connectionState/fixture',
    ]);
  });

  it.each([
    '/api/v1/instance/create',
    '/api/v1/admin/products/product-fixture/instances',
  ])(
    'finishes lookup and both defaults beyond the legacy limit: %s',
    async (url) => {
      values.QR_REQUEST_TIMEOUT_MS = 3000;
      values.QR_PROVIDER_TIMEOUT_MS = 1000;
      responseBody = {
        instance: {
          instanceName: 'fixture',
          instanceId: 'remote-created',
          status: 'connecting',
        },
        qrcode: { base64: 'fixture-qr-must-not-be-logged' },
      };
      prisma.productDefaultWebhook.findUnique.mockResolvedValue({
        enabled: true,
        url: 'https://fixture.invalid/webhook',
      });
      prisma.productDefaultProxy.findUnique.mockResolvedValue({
        enabled: true,
        host: 'fixture.invalid',
        port: '8080',
        protocol: 'http',
        username: 'fixture-proxy-user',
        password: 'fixture-proxy-secret',
      });
      proxyFindBody = {
        enabled: true,
        host: 'fixture.invalid',
        port: '8080',
        protocol: 'http',
        username: 'fixture-proxy-user',
        password: 'fixture-proxy-secret',
      };
      delays = {
        '/instance/fetchInstances': 200,
        '/webhook/set/fixture': 200,
        '/proxy/set/fixture': 200,
      };

      const response = await app.inject({
        method: 'POST',
        url,
        payload: { instanceName: 'fixture', qrcode: true },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json<unknown>()).toEqual({
        instanceName: 'fixture',
        instanceId: 'remote-created',
        status: 'connecting',
        qrcode: { base64: 'fixture-qr-must-not-be-logged' },
        hubId: 'hub-created',
        webhook: { enabled: true },
        proxy: {
          enabled: true,
          host: 'fixture.invalid',
          port: '8080',
          protocol: 'http',
          username: 'fixture-proxy-user',
        },
      });
      expect(response.body).not.toContain('fixture-proxy-secret');
      expect(calls).toEqual([
        '/instance/fetchInstances',
        '/instance/create',
        '/webhook/set/fixture',
        '/proxy/set/fixture',
        '/proxy/find/fixture',
      ]);
      expect(prisma.instance.create).toHaveBeenCalledTimes(1);
      expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
      expect(
        JSON.parse(requestBodies['/proxy/set/fixture']) as unknown,
      ).toEqual({
        enabled: true,
        host: 'fixture.invalid',
        port: '8080',
        protocol: 'http',
        username: 'fixture-proxy-user',
        password: 'fixture-proxy-secret',
      });
      expect(warningLog).not.toHaveBeenCalled();
      const log = JSON.parse(
        String((terminalLog.mock.calls as unknown[][])[0][0]),
      ) as Record<string, unknown>;
      expect(log).toMatchObject({
        timeoutMs: 3000,
        providerTimeoutMs: 1000,
        lastOperation: 'proxy',
        calls: 5,
        statusCode: 201,
      });
      // The monotonic remaining budget can lose a millisecond before dispatch.
      expect(log.callTimeoutMs).toBeGreaterThanOrEqual(990);
      expect(log.callTimeoutMs).toBeLessThanOrEqual(1000);
      expect(JSON.stringify(terminalLog.mock.calls)).not.toMatch(
        /fixture-key|fixture-proxy-secret|fixture-qr-must-not-be-logged|fixture\.invalid/,
      );
    },
  );

  it.each(['lookup', 'proxy'] as const)(
    'bounds a stalled %s without retry or deletion',
    async (operation) => {
      responseBody = {
        instance: { instanceName: 'fixture', instanceId: 'remote-created' },
      };
      prisma.productDefaultProxy.findUnique.mockResolvedValue({
        enabled: true,
        host: 'fixture.invalid',
        port: '8080',
        protocol: 'http',
      });
      stalledPaths.add(
        operation === 'lookup'
          ? '/instance/fetchInstances'
          : '/proxy/set/fixture',
      );
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/instance/create',
        payload: { instanceName: 'fixture', qrcode: true },
      });
      await closed;
      expect(response.statusCode).toBe(operation === 'lookup' ? 408 : 201);
      if (operation === 'lookup') {
        expect(response.json<unknown>()).toEqual({
          statusCode: 408,
          error: 'REQUEST_TIMEOUT',
          message: 'Request timeout',
        });
      } else {
        expect(response.json<unknown>()).toEqual({
          instanceName: 'fixture',
          instanceId: 'remote-created',
          status: 'connecting',
          hubId: 'hub-created',
        });
        expect(warningLog).toHaveBeenCalledWith(
          expect.stringContaining('instance_default_proxy_unconfirmed'),
        );
      }
      expect(prisma.instance.create).toHaveBeenCalledTimes(
        operation === 'lookup' ? 0 : 1,
      );
      expect(prisma.instance.delete).not.toHaveBeenCalled();
      expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
      expect(calls).toEqual(
        operation === 'lookup'
          ? ['/instance/fetchInstances']
          : [
              '/instance/fetchInstances',
              '/instance/create',
              '/proxy/set/fixture',
            ],
      );
      const log = JSON.parse(
        String((terminalLog.mock.calls as unknown[][])[0][0]),
      ) as Record<string, unknown>;
      expect(log).toMatchObject({
        lastOperation: operation,
        source: operation === 'lookup' ? 'provider_timeout' : 'success',
        statusCode: operation === 'lookup' ? 408 : 201,
      });
    },
  );

  it.each([
    ['/api/v1/instance/create', 400],
    ['/api/v1/admin/products/product-fixture/instances', 504],
  ] as const)(
    'returns the created instance and QR despite a default proxy HTTP failure: %s',
    async (url, status) => {
      responseBody = {
        instance: {
          instanceName: 'fixture',
          instanceId: 'remote-created',
          status: 'connecting',
        },
        qrcode: { base64: 'fixture-qr-secret' },
      };
      responseStatuses['/proxy/set/fixture'] = status;
      prisma.productDefaultProxy.findUnique.mockResolvedValue({
        enabled: true,
        host: 'proxy-secret.invalid',
        port: '8080',
        protocol: 'http',
        password: 'proxy-secret',
      });
      const response = await app.inject({
        method: 'POST',
        url,
        payload: { instanceName: 'fixture', qrcode: true },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json<unknown>()).toEqual({
        instanceName: 'fixture',
        instanceId: 'remote-created',
        status: 'connecting',
        hubId: 'hub-created',
        qrcode: { base64: 'fixture-qr-secret' },
      });
      expect(calls).toEqual([
        '/instance/fetchInstances',
        '/instance/create',
        '/proxy/set/fixture',
      ]);
      expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
      expect(warningLog).toHaveBeenCalledWith(
        expect.stringContaining('upstream_http'),
      );
      expect(
        JSON.stringify([warningLog.mock.calls, terminalLog.mock.calls]),
      ).not.toMatch(/proxy-secret|fixture-qr-secret/);
    },
  );

  it('confirms a valid proxy slower than 5 seconds within the shared QR budget', async () => {
    values.QR_REQUEST_TIMEOUT_MS = 9000;
    values.QR_PROVIDER_TIMEOUT_MS = 8000;
    responseBody = {
      instance: { instanceName: 'fixture', instanceId: 'remote-created' },
      qrcode: { base64: 'fixture' },
    };
    const stored = {
      enabled: true,
      host: 'fixture.invalid',
      port: '8080',
      protocol: 'http',
      username: 'fixture-proxy-user',
      password: 'fixture-proxy-secret',
    };
    prisma.productDefaultProxy.findUnique.mockResolvedValue(stored);
    proxyFindBody = { instanceName: 'fixture', proxy: stored };
    delays = { '/proxy/set/fixture': 6000 };
    const begin = performance.now();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/products/product-fixture/instances',
      payload: { instanceName: 'fixture', qrcode: true },
    });
    expect(performance.now() - begin).toBeGreaterThanOrEqual(5900);
    expect(response.statusCode).toBe(201);
    expect(response.json<unknown>()).toEqual({
      instanceName: 'fixture',
      instanceId: 'remote-created',
      status: 'connecting',
      hubId: 'hub-created',
      qrcode: { base64: 'fixture' },
      proxy: {
        enabled: true,
        host: 'fixture.invalid',
        port: '8080',
        protocol: 'http',
        username: 'fixture-proxy-user',
      },
    });
    expect(response.body).not.toContain('fixture-proxy-secret');
    expect(calls).toEqual([
      '/instance/fetchInstances',
      '/instance/create',
      '/proxy/set/fixture',
      '/proxy/find/fixture',
    ]);
    expect(prisma.instance.create).toHaveBeenCalledTimes(1);
    expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
    expect(warningLog).not.toHaveBeenCalled();
    expect(terminalLog).toHaveBeenCalledWith(
      expect.stringContaining('"statusCode":201,"source":"success"'),
    );
  }, 15000);

  it('omits an unconfirmed proxy instead of returning an empty disabled state', async () => {
    responseBody = {
      instance: { instanceName: 'fixture', instanceId: 'remote-created' },
    };
    prisma.productDefaultProxy.findUnique.mockResolvedValue({
      enabled: true,
      host: 'fixture.invalid',
      port: '8080',
      protocol: 'http',
    });
    proxyFindBody = {
      enabled: false,
      host: '',
      port: '',
      protocol: '',
      username: '',
      password: '',
    };
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/instance/create',
      payload: { instanceName: 'fixture', qrcode: true },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<unknown>()).toEqual({
      instanceName: 'fixture',
      instanceId: 'remote-created',
      status: 'connecting',
      hubId: 'hub-created',
    });
    expect(calls).toEqual([
      '/instance/fetchInstances',
      '/instance/create',
      '/proxy/set/fixture',
      '/proxy/find/fixture',
      '/proxy/find/fixture',
      '/proxy/find/fixture',
    ]);
    expect(warningLog).toHaveBeenCalledWith(
      expect.stringContaining('confirmation_mismatch'),
    );
  });

  describe.each([
    ['/api/v1/instance/create', true],
    ['/api/v1/instance/create', false],
    ['/api/v1/admin/products/product-fixture/instances', true],
    ['/api/v1/admin/products/product-fixture/instances', false],
  ] as const)('proxy confirmation contract %s QR=%s', (url, qrcode) => {
    const stored = {
      enabled: true,
      host: 'fixture.invalid',
      port: '8080',
      protocol: 'http',
      username: 'fixture-user',
      password: 'fixture-proxy-secret',
    };

    beforeAll(() => {
      legacyTimeoutMs = 2000;
    });
    afterAll(() => {
      legacyTimeoutMs = 100;
    });

    beforeEach(() => {
      responseBody = {
        instance: { instanceName: 'fixture', instanceId: 'remote-created' },
      };
      prisma.productDefaultProxy.findUnique.mockResolvedValue(stored);
      proxyFindBody = stored;
    });

    it('keeps the persisted instance when the set response identifies another instance', async () => {
      proxySetBody = { instanceName: 'other', proxy: stored };
      const response = await app.inject({
        method: 'POST',
        url,
        payload: { instanceName: 'fixture', qrcode },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json<unknown>()).toEqual({
        instanceName: 'fixture',
        instanceId: 'remote-created',
        status: 'connecting',
        hubId: 'hub-created',
      });
      expect(prisma.instance.create).toHaveBeenCalledTimes(1);
      expect(prisma.instance.delete).not.toHaveBeenCalled();
      expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
      expect(calls).toEqual([
        '/instance/fetchInstances',
        '/instance/create',
        '/proxy/set/fixture',
      ]);
      const diagnostic = (warningLog.mock.calls as unknown[][]).find(
        ([entry]) =>
          typeof entry === 'string' &&
          entry.includes('instance_default_proxy_unconfirmed'),
      )?.[0] as string | undefined;
      expect(diagnostic).toBeDefined();
      expect(JSON.parse(diagnostic!)).toMatchObject({
        reason: 'confirmation_invalid',
        operation: 'set',
        reads: 0,
        durationMs: expect.any(Number) as unknown,
      });
      expect(
        JSON.stringify([warningLog.mock.calls, terminalLog.mock.calls]),
      ).not.toContain(stored.password);
    });

    it('returns the confirmed proxy without wrappers, repeated identity or password', async () => {
      proxySetBody = {
        proxy: {
          instanceName: 'fixture',
          proxy: { enabled: false, host: '', password: 'placeholder' },
        },
      };
      const response = await app.inject({
        method: 'POST',
        url,
        payload: { instanceName: 'fixture', qrcode },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json<unknown>()).toEqual({
        instanceName: 'fixture',
        instanceId: 'remote-created',
        status: 'connecting',
        hubId: 'hub-created',
        proxy: {
          enabled: true,
          host: stored.host,
          port: stored.port,
          protocol: stored.protocol,
          username: stored.username,
        },
      });
      expect(calls).toEqual([
        '/instance/fetchInstances',
        '/instance/create',
        '/proxy/set/fixture',
        '/proxy/find/fixture',
      ]);
      expect(prisma.instance.create).toHaveBeenCalledTimes(1);
      expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
      expect(warningLog).not.toHaveBeenCalled();
      expect(response.body).not.toMatch(/password|fixture-proxy-secret/);
    });
  });

  it('skips an optional proxy with no legacy budget and keeps the non-QR contract', async () => {
    responseBody = {
      instance: { instanceName: 'fixture', instanceId: 'remote-created' },
    };
    prisma.productDefaultProxy.findUnique.mockResolvedValue({
      enabled: true,
      host: 'fixture.invalid',
      port: '8080',
      protocol: 'http',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/instance/create',
      payload: { instanceName: 'fixture', qrcode: false },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<unknown>()).toEqual({
      instanceName: 'fixture',
      instanceId: 'remote-created',
      status: 'connecting',
      hubId: 'hub-created',
    });
    expect(calls).toEqual(['/instance/fetchInstances', '/instance/create']);
    expect(warningLog).toHaveBeenCalledWith(
      expect.stringContaining('budget_exhausted'),
    );
  });

  it('still propagates mandatory webhook failure before trying the optional proxy', async () => {
    responseBody = {
      instance: { instanceName: 'fixture', instanceId: 'remote-created' },
    };
    prisma.productDefaultWebhook.findUnique.mockResolvedValue({
      enabled: true,
      url: 'https://fixture.invalid',
    });
    prisma.productDefaultProxy.findUnique.mockResolvedValue({ enabled: true });
    responseStatuses['/webhook/set/fixture'] = 400;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/instance/create',
      payload: { instanceName: 'fixture', qrcode: true },
    });
    expect(response.statusCode).toBe(400);
    expect(calls).toEqual([
      '/instance/fetchInstances',
      '/instance/create',
      '/webhook/set/fixture',
      '/instance/delete/fixture',
    ]);
    expect(prisma.instance.delete).toHaveBeenCalledTimes(1);
  });

  it('cancels the optional proxy when the real create caller disconnects, preserving the binding', async () => {
    values.QR_REQUEST_TIMEOUT_MS = 90000;
    values.QR_PROVIDER_TIMEOUT_MS = 80000;
    responseBody = {
      instance: { instanceName: 'fixture', instanceId: 'remote-created' },
    };
    prisma.productDefaultProxy.findUnique.mockResolvedValue({
      enabled: true,
      host: 'fixture.invalid',
      port: '8080',
      protocol: 'http',
    });
    stalledPaths.add('/proxy/set/fixture');
    const caller = httpRequest(`${hubUrl}/api/v1/instance/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    caller.on('error', () => undefined);
    try {
      caller.end(JSON.stringify({ instanceName: 'fixture', qrcode: true }));
      await started;
      caller.destroy();
      await closed;
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 499,
          errorMsg: 'client_disconnected',
        }),
      );
      expect(prisma.instance.create).toHaveBeenCalledTimes(1);
      expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
      expect(calls).toEqual([
        '/instance/fetchInstances',
        '/instance/create',
        '/proxy/set/fixture',
      ]);
    } finally {
      caller.destroy();
    }
  });

  it('honors a real intermediary that closes after 15 seconds even with the 60-second QR budget', async () => {
    values.QR_REQUEST_TIMEOUT_MS = 60000;
    values.QR_PROVIDER_TIMEOUT_MS = 50000;
    hang = true;
    const proxy = createServer((_req, res) => {
      const forwarding = get(
        `${hubUrl}${publicConnect}`,
        (forwardedResponse) => {
          clearTimeout(timer);
          res.writeHead(forwardedResponse.statusCode ?? 502);
          forwardedResponse.pipe(res);
        },
      );
      forwarding.on('error', () => undefined);
      const timer = setTimeout(() => {
        forwarding.destroy();
        res.writeHead(504);
        res.end('intermediary timeout');
      }, 15000);
      res.once('close', () => {
        clearTimeout(timer);
        forwarding.destroy();
      });
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    try {
      const status = await new Promise<number>((resolve, reject) => {
        get(
          `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        ).on('error', reject);
      });
      await closed;
      expect(status).toBe(504);
      expect(audit).toHaveBeenCalledTimes(1);
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 499,
          errorMsg: 'client_disconnected',
        }),
      );
      expect(calls).toEqual(['/instance/connect/fixture']);
    } finally {
      proxy.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 25000);

  it('aborts the real outbound socket when the real caller disconnects', async () => {
    hang = true;
    const caller = get(`${hubUrl}${publicConnect}`);
    caller.on('error', () => undefined);
    try {
      await started;
      caller.destroy();
      await closed;
      expect(calls).toHaveLength(1);
      expect(audit).toHaveBeenCalledTimes(1);
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 499,
          errorMsg: 'client_disconnected',
        }),
      );
      expect(terminalLog).toHaveBeenCalledTimes(1);
    } finally {
      caller.destroy();
    }
  });
});
