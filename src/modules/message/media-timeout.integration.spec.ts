import { ExecutionContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  createServer,
  request as httpRequest,
  Server,
  ClientRequest,
} from 'node:http';
import { AddressInfo } from 'node:net';
import { EvolutionAdapter } from '../../adapters/evolution/evolution.adapter';
import { EvolutionHttpService } from '../../adapters/evolution/evolution.http';
import { ApiKeyGuard } from '../../auth/apikey.guard';
import { RateLimitGuard } from '../../auth/rate-limit.guard';
import { MEDIA_TIMEOUT_PROFILE } from '../../common/decorators/media-timeout.decorator';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { TimeoutInterceptor } from '../../common/interceptors/timeout.interceptor';
import { configSchema } from '../../config/config.schema';
import { PrismaService } from '../../prisma/prisma.service';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import { InstanceResolverService } from '../../resolver/instance.resolver';
import { BatchProducer } from '../queue/batch.producer';
import {
  MessageBatchController,
  MessageController,
} from './message.controller';
import { MessageService } from './message.service';

// Only loopback HTTP is real; no AppModule, database, Redis or external provider.
describe('Media timeouts — HTTP contract', () => {
  let upstream: Server;
  let app: NestFastifyApplication;
  let hubUrl: string;
  let received: Array<{ path: string; body: Record<string, unknown> }>;
  let receivedSignal: (() => void) | undefined;
  let resolvingSignal: (() => void) | undefined;
  let resolverDelay: number;
  let log: jest.SpyInstance;
  let values: ReturnType<typeof configSchema.parse>;
  const timers = new Set<NodeJS.Timeout>();
  const liveTiming = process.env.MEDIA_REALTIME_TESTS === 'true';
  const response = {
    key: { id: 'fixture-message-id', fromMe: true },
    status: 'PENDING',
  };

  beforeEach(async () => {
    received = [];
    resolverDelay = 0;
    receivedSignal = undefined;
    resolvingSignal = undefined;
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    values = configSchema.parse({
      DATABASE_URL: 'postgresql://fixture.invalid/not-used',
      REDIS_URL: 'redis://fixture.invalid/not-used',
      ENCRYPTION_KEY: 'a'.repeat(64),
      JWT_SECRET: 'fixture-secret-not-used',
      ADMIN_SECRET: 'fixture-admin-not-used',
      PROXY_TIMEOUT_MS: liveTiming ? 15000 : 50,
      PROXY_MAX_RETRIES: 0,
    });
    upstream = createServer((request, reply) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<
          string,
          unknown
        >;
        received.push({ path: request.url ?? '', body });
        receivedSignal?.();
        const timer = setTimeout(
          () => {
            timers.delete(timer);
            if (reply.destroyed) return;
            const status = Number(body.fixtureStatus ?? 201);
            reply.writeHead(status, { 'content-type': 'application/json' });
            reply.end(
              JSON.stringify(
                status >= 400 ? { error: 'fixture-provider-error' } : response,
              ),
            );
          },
          Number(body.fixtureDelayMs ?? 0),
        );
        timers.add(timer);
      });
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, '127.0.0.1', resolve),
    );
    const providerUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const module = await Test.createTestingModule({
      controllers: [MessageController],
      providers: [
        MessageService,
        EvolutionAdapter,
        EvolutionHttpService,
        { provide: ConfigService, useValue: new ConfigService(values) },
        { provide: PrismaService, useValue: {} },
        { provide: BatchProducer, useValue: {} },
        {
          provide: InstanceResolverService,
          useValue: {
            resolveById: async () => {
              resolvingSignal?.();
              if (resolverDelay)
                await new Promise((resolve) =>
                  setTimeout(resolve, resolverDelay),
                );
              return {
                providerUrl,
                providerApiKey: 'fixture-key',
                adapterType: 'evolution',
                instanceName: 'fixture-instance',
              };
            },
          },
        },
        {
          provide: AdapterResolverService,
          inject: [EvolutionAdapter],
          useFactory: (adapter: EvolutionAdapter) => ({
            resolve: () => adapter,
          }),
        },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context
            .switchToHttp()
            .getRequest<{ product: { productId: string } }>().product = {
            productId: 'fixture-product',
          };
          return true;
        },
      })
      .overrideGuard(RateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    hubUrl = await app.getUrl();
    log.mockClear();
  });

  afterEach(async () => {
    timers.forEach(clearTimeout);
    timers.clear();
    upstream?.closeAllConnections();
    if (upstream?.listening)
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await app?.close();
    jest.restoreAllMocks();
  });

  function post(route: string, body: Record<string, unknown>) {
    let request!: ClientRequest;
    const result = new Promise<{ status: number; body: unknown }>(
      (resolve, reject) => {
        request = httpRequest(
          `${hubUrl}/api/v1/message/${route}/fixture-hub-id`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              apikey: 'fixture-product-key',
            },
          },
          (reply) => {
            const chunks: Buffer[] = [];
            reply.on('data', (chunk: Buffer) => chunks.push(chunk));
            reply.on('error', reject);
            reply.on('end', () => {
              try {
                resolve({
                  status: reply.statusCode ?? 0,
                  body: JSON.parse(Buffer.concat(chunks).toString()) as unknown,
                });
              } catch (error) {
                reject(
                  error instanceof Error ? error : new Error(String(error)),
                );
              }
            });
          },
        );
        request.on('error', reject);
        request.end(JSON.stringify(body));
      },
    );
    return { request, result };
  }

  it.each(['sendMedia', 'sendDocument', 'sendSticker'])(
    'preserves %s body, route and response beyond the legacy deadline',
    async (route) => {
      const payload = {
        number: 'fixture-recipient',
        media: 'fixture-media',
        sticker: 'fixture-sticker',
        mediatype: 'video',
        fileName: 'fixture.mp4',
        caption: 'fixture caption',
        delay: 10,
        quoted: { key: { id: 'fixture-quote' } },
        mimetype: 'video/mp4',
        fixtureDelayMs: 150,
      };
      expect(await post(route, payload).result).toEqual({
        status: 201,
        body: response,
      });
      expect(received).toEqual([
        {
          path: `/message/${route === 'sendDocument' ? 'sendMedia' : route}/fixture-instance`,
          body:
            route === 'sendDocument'
              ? { ...payload, mediatype: 'document' }
              : payload,
        },
      ]);
    },
  );

  it('returns a real provider error with its current body', async () => {
    expect(
      await post('sendMedia', {
        media: 'fixture',
        fixtureDelayMs: 150,
        fixtureStatus: 422,
      }).result,
    ).toEqual({ status: 422, body: { error: 'fixture-provider-error' } });
  });

  it('retains the existing 408 envelope when the media provider budget really expires', async () => {
    values.MEDIA_PROVIDER_TIMEOUT_MS = 40;
    expect(
      await post('sendMedia', { media: 'fixture', fixtureDelayMs: 300 }).result,
    ).toEqual({
      status: 408,
      body: {
        statusCode: 408,
        error: 'REQUEST_TIMEOUT',
        message: 'Request timeout',
      },
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"source":"provider_timeout"'),
    );
  });

  it('keeps text and batch metadata on the original policy', async () => {
    expect(
      await post('sendText', { text: 'fixture', fixtureDelayMs: 300 }).result,
    ).toMatchObject({ status: 408 });
    expect(
      Reflect.getMetadata(
        MEDIA_TIMEOUT_PROFILE,
        MessageController.prototype.sendText,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        MEDIA_TIMEOUT_PROFILE,
        MessageBatchController.prototype.sendBatchMedia,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        MEDIA_TIMEOUT_PROFILE,
        MessageBatchController.prototype.sendBatchDocument,
      ),
    ).toBeUndefined();
  });

  it('records the provider response even when the original HTTP consumer leaves', async () => {
    const started = new Promise<void>((resolve) => {
      receivedSignal = resolve;
    });
    const client = post('sendMedia', { media: 'fixture', fixtureDelayMs: 150 });
    const ended = client.result.catch(() => undefined);
    await started;
    client.request.destroy(new Error('fixture disconnect'));
    await ended;
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /"upstreamStatusCode":201,"clientDisconnected":true/,
      ),
    );
    expect(received).toHaveLength(1);
  });

  it('does not dispatch after the consumer leaves during instance resolution', async () => {
    resolverDelay = 150;
    const resolving = new Promise<void>((resolve) => {
      resolvingSignal = resolve;
    });
    const client = post('sendMedia', { media: 'fixture' });
    const ended = client.result.catch(() => undefined);
    await resolving;
    client.request.destroy(new Error('fixture disconnect'));
    await ended;
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(received).toHaveLength(0);
  });

  (liveTiming ? it : it.skip)(
    'waits for real 60-second and 120-second provider responses on the original POST',
    async () => {
      const startedAt = performance.now();
      const results = await Promise.all(
        [60000, 120000].map(async (delay) => {
          const result = await post('sendMedia', {
            media: 'fixture-video',
            mediatype: 'video',
            fixtureDelayMs: delay,
          }).result;
          expect(performance.now() - startedAt).toBeGreaterThanOrEqual(delay);
          return result;
        }),
      );
      expect(results).toEqual([
        { status: 201, body: response },
        { status: 201, body: response },
      ]);
      expect(received).toHaveLength(2);
    },
    150000,
  );
});
