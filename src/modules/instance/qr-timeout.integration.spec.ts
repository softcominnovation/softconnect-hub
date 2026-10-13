import { ExecutionContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createServer, get, Server } from 'node:http';
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

jest.mock('../../common/crypto.util', () => ({
  decryptAES256GCM: () => 'fixture-key',
}));

// Only loopback HTTP is real. No AppModule, database, Redis, queue or external Evolution.
describe('QR timeout — local HTTP integration', () => {
  let upstream: Server;
  let app: NestFastifyApplication;
  let providerUrl: string;
  let hubUrl: string;
  let responseBody: unknown;
  let responseStatus: number;
  let hang: boolean;
  let calls: string[];
  let started: Promise<void>;
  let closed: Promise<void>;
  let onStarted: () => void;
  let onClosed: () => void;
  let audit: jest.Mock;
  let terminalLog: jest.SpyInstance;
  let values: Record<string, unknown>;
  const publicConnect = '/api/v1/instance/hub-fixture/connect';
  const adminConnect =
    '/api/v1/admin/products/product-fixture/instances/hub-fixture/connect';
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
      calls.push(req.url ?? '');
      req.resume();
      if (req.url?.includes('/connect/')) {
        res.once('close', onClosed);
        onStarted();
        if (hang) return;
      }
      res.statusCode = responseStatus;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify(
          req.url === '/instance/fetchInstances' ? [] : responseBody,
        ),
      );
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, '127.0.0.1', resolve),
    );
    providerUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    responseBody = { base64: 'fixture-qr-must-not-be-logged' };
    responseStatus = 200;
    hang = false;
    calls = [];
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
    values = {
      PROXY_TIMEOUT_MS: 100,
      PROXY_MAX_RETRIES: 1,
      QR_REQUEST_TIMEOUT_MS: 2000,
      QR_PROVIDER_TIMEOUT_MS: 250,
      CIRCUIT_BREAKER_THRESHOLD: 5,
      CIRCUIT_BREAKER_RESET_MS: 30000,
      ENCRYPTION_KEY: 'a'.repeat(64),
    };
    const module = await Test.createTestingModule({
      controllers: [InstanceController, AdminInstancesController],
      providers: [
        InstanceService,
        AdminInstancesService,
        EvolutionHttpService,
        EvolutionAdapter,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => values[key],
            getOrThrow: (key: string) => values[key],
          },
        },
        {
          provide: PrismaService,
          useValue: {
            product: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ ...product, id: product.productId }),
            },
            vpsProvider: {
              findUnique: jest.fn().mockResolvedValue({
                id: product.vpsProviderId,
                providerUrl,
                providerApiKey: 'fixture-encrypted',
                adapterType: 'evolution',
              }),
            },
            instance: {
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue({ id: 'hub-created' }),
            },
            productDefaultWebhook: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
            productDefaultProxy: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
          },
        },
        { provide: CacheService, useValue: {} },
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
