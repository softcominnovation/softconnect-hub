import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { EvolutionMediaService } from '../../adapters/evolution/evolution.media';
import { MediaPreparationService } from '../media/media-preparation.service';
import { MediaTempStore } from '../media/media-temp-store';
import { MediaSourceClient } from '../media/media-source.client';
import { MediaSourcePolicy } from '../media/media-source-policy';
import { installMediaHttpAdmission } from '../media/media-http-admission';
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
  let root: string;
  let sourceBytes: number;
  let sourceCalls: number;
  let sourceDelayMs: number;
  let sourceStatus: number;
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

  async function setup(maxSizeMb = 50) {
    root = await mkdtemp(join(tmpdir(), 'mid03-http-'));
    sourceBytes = 64;
    sourceCalls = 0;
    sourceDelayMs = 0;
    sourceStatus = 200;
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
      MEDIA_TMP_DIR: root,
      MEDIA_MAX_SIZE_MB: maxSizeMb,
    });
    upstream = createServer((request, reply) => {
      if (request.method === 'GET') {
        sourceCalls++;
        if (sourceStatus !== 200) {
          reply.writeHead(sourceStatus);
          reply.end('source rejection');
          return;
        }
        reply.writeHead(200, { 'content-type': 'video/mp4' });
        let remaining = sourceBytes;
        const write = () => {
          while (remaining > 0 && !reply.destroyed) {
            const chunk = Buffer.alloc(Math.min(65536, remaining), 71);
            remaining -= chunk.length;
            if (!reply.write(chunk)) {
              reply.once('drain', write);
              return;
            }
          }
          reply.end();
        };
        if (sourceDelayMs) {
          const timer = setTimeout(() => {
            timers.delete(timer);
            write();
          }, sourceDelayMs);
          timers.add(timer);
          reply.flushHeaders();
        } else write();
        return;
      }
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
      controllers: [MessageController, MessageBatchController],
      providers: [
        MessageService,
        EvolutionAdapter,
        EvolutionMediaService,
        MediaPreparationService,
        MediaTempStore,
        MediaSourceClient,
        MediaSourcePolicy,
        EvolutionHttpService,
        { provide: ConfigService, useValue: new ConfigService(values) },
        {
          provide: PrismaService,
          useValue: {
            batchJob: {
              create: jest.fn().mockResolvedValue({ id: 'fixture-batch-id' }),
            },
          },
        },
        {
          provide: BatchProducer,
          useValue: { addJobs: jest.fn().mockResolvedValue(undefined) },
        },
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
    installMediaHttpAdmission(
      app.getHttpAdapter().getInstance(),
      app.get(ConfigService),
    );
    // Network policy is covered separately; only this named synthetic origin may use loopback.
    jest
      .spyOn(app.get(MediaSourcePolicy), 'resolve')
      .mockImplementation((value) => {
        const url = new URL(value);
        if (url.hostname !== 'source.fixture')
          throw new Error('Unexpected fixture source');
        return Promise.resolve({
          url: new URL(url.pathname + url.search, providerUrl),
          address: '127.0.0.1',
          family: 4,
        });
      });
    await app.listen(0, '127.0.0.1');
    hubUrl = await app.getUrl();
    log.mockClear();
  }

  beforeEach(() => setup());

  async function teardown() {
    timers.forEach(clearTimeout);
    timers.clear();
    upstream?.closeAllConnections();
    if (upstream?.listening)
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await app?.close();
    if (root) await rm(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  }

  afterEach(teardown);

  it.each([403, 404, 429, 503])(
    'logs source status %i while preserving the public 502 envelope',
    async (status) => {
      sourceStatus = status;
      const result = await post('sendMedia', {
        number: 'fixture-number',
        mediatype: 'image',
        media: 'http://source.fixture/private-file?token=secret-source-token',
      }).result;
      expect(result).toEqual({
        status: 502,
        body: {
          statusCode: 502,
          error: 'BAD_GATEWAY',
          message: 'Media source did not return a complete file',
        },
      });
      expect(received).toHaveLength(0);
      const lines = log.mock.calls.map((call: unknown[]) => String(call[0]));
      const line = lines.find((entry) =>
        entry.includes('media_request_finished'),
      );
      expect(line).toBeDefined();
      expect(JSON.parse(line!)).toMatchObject({
        event: 'media_request_finished',
        sourceHost: 'source.fixture',
        sourceStage: 'response',
        sourceStatusCode: status,
        sourceErrorCode: 'HTTP_STATUS',
        statusCode: 502,
        calls: 0,
        source: 'preparation_error',
      });
      expect(lines.join('\n')).not.toMatch(/private-file|secret-source-token/);
    },
  );

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
        media: Buffer.from('fixture-media').toString('base64'),
        sticker: Buffer.from('fixture-sticker').toString('base64'),
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
        media: Buffer.from('fixture').toString('base64'),
        fixtureDelayMs: 150,
        fixtureStatus: 422,
      }).result,
    ).toEqual({ status: 422, body: { error: 'fixture-provider-error' } });
  });

  it('retains the existing 408 envelope when the media provider budget really expires', async () => {
    values.MEDIA_PROVIDER_TIMEOUT_MS = 40;
    expect(
      await post('sendMedia', {
        media: Buffer.from('fixture').toString('base64'),
        fixtureDelayMs: 300,
      }).result,
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
    const client = post('sendMedia', {
      media: Buffer.from('fixture').toString('base64'),
      fixtureDelayMs: 150,
    });
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
    const client = post('sendMedia', {
      media: Buffer.from('fixture').toString('base64'),
    });
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
            media: Buffer.from('fixture-video').toString('base64'),
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
  it.each(['sendMedia', 'sendDocument'])(
    'streams a 50 MB URL through %s once, preserving bytes and cleaning storage',
    async (route) => {
      sourceBytes = 50000000;
      const result = await post(route, {
        number: 'fixture-recipient',
        mediatype: 'video',
        media: 'http://source.fixture/file.mp4?signature=secret-fixture',
        fileName: 'ação.mp4',
        caption: 'Olá 😀',
        mimetype: 'video/mp4',
        extra: { retain: true },
      }).result;
      expect(result).toEqual({ status: 201, body: response });
      expect(sourceCalls).toBe(1);
      const bytes = Buffer.from(received[0].body.media as string, 'base64');
      expect(bytes.length).toBe(50000000);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        createHash('sha256')
          .update(Buffer.alloc(sourceBytes, 71))
          .digest('hex'),
      );
      expect(received[0].body).toMatchObject({
        fileName: 'ação.mp4',
        caption: 'Olá 😀',
        extra: { retain: true },
        mediatype: route === 'sendDocument' ? 'document' : 'video',
      });
      expect(
        (await readdir(root, { recursive: true })).filter((x) =>
          x.endsWith('.bin'),
        ),
      ).toEqual([]);
      expect(log.mock.calls.flat().join(' ')).not.toContain(
        'signature=secret-fixture',
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('"mediaBytes":50000000'),
      );
    },
    30000,
  );

  it('rejects a URL over 50 MB before dispatch and frees the admission', async () => {
    sourceBytes = 50000001;
    expect(
      await post('sendMedia', { media: 'http://source.fixture/file' }).result,
    ).toMatchObject({ status: 413 });
    expect(received).toHaveLength(0);
    expect(
      (await readdir(root, { recursive: true })).filter((x) =>
        x.endsWith('.bin'),
      ),
    ).toEqual([]);
    expect(await post('sendMedia', { media: 'YQ==' }).result).toMatchObject({
      status: 201,
    });
  }, 30000);

  it('accepts base64 beyond the old 1 MiB body ceiling through the real endpoint', async () => {
    const bytes = Buffer.alloc(1100000, 71);
    expect(
      await post('sendDocument', {
        media: bytes.toString('base64'),
        fileName: 'file.pdf',
      }).result,
    ).toMatchObject({ status: 201 });
    expect(Buffer.from(received[0].body.media as string, 'base64')).toEqual(
      bytes,
    );
  });

  it('retains both occupied slots after a consumer disconnect until the provider finishes', async () => {
    const firstStarted = new Promise<void>((resolve) => {
      receivedSignal = resolve;
    });
    const first = post('sendMedia', { media: 'YQ==', fixtureDelayMs: 600 });
    const firstEnded = first.result.catch(() => undefined);
    await firstStarted;
    const secondStarted = new Promise<void>((resolve) => {
      receivedSignal = resolve;
    });
    const second = post('sendMedia', { media: 'YQ==', fixtureDelayMs: 600 });
    await secondStarted;
    first.request.destroy();
    await firstEnded;
    expect(await post('sendMedia', { media: 'YQ==' }).result).toMatchObject({
      status: 503,
    });
    await second.result;
    expect(await post('sendMedia', { media: 'YQ==' }).result).toMatchObject({
      status: 201,
    });
    expect(
      (await readdir(root, { recursive: true })).filter((x) =>
        x.endsWith('.bin'),
      ),
    ).toEqual([]);
  });

  it('classifies a slow source as download timeout, cleans storage and does not dispatch', async () => {
    values.MEDIA_DOWNLOAD_TIMEOUT_MS = 40;
    sourceDelayMs = 200;
    expect(
      await post('sendMedia', { media: 'http://source.fixture/slow' }).result,
    ).toMatchObject({ status: 408 });
    expect(received).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"source":"download_timeout"'),
    );
    expect(
      (await readdir(root, { recursive: true })).filter((x) =>
        x.endsWith('.bin'),
      ),
    ).toEqual([]);
  });

  it('cancels URL preparation on disconnect without an Evolution POST', async () => {
    sourceDelayMs = 500;
    const client = post('sendMedia', { media: 'http://source.fixture/slow' });
    const ended = client.result.catch(() => undefined);
    while (!sourceCalls) await new Promise((resolve) => setTimeout(resolve, 5));
    client.request.destroy();
    await ended;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toHaveLength(0);
    expect(
      (await readdir(root, { recursive: true })).filter((x) =>
        x.endsWith('.bin'),
      ),
    ).toEqual([]);
    sourceDelayMs = 0;
    expect(await post('sendMedia', { media: 'YQ==' }).result).toMatchObject({
      status: 201,
    });
  });
  it.each(['send-media', 'send-document'])(
    'preserves the immediate batch enqueue contract for %s without preparing or sending',
    async (route) => {
      const messages = [
        {
          number: 'fixture',
          media: 'http://source.fixture/not-downloaded',
          mediatype: 'video',
        },
      ];
      expect(await post('batch/' + route, { messages }).result).toEqual({
        status: 201,
        body: { batchJobId: 'fixture-batch-id' },
      });
      expect(sourceCalls).toBe(0);
      expect(received).toHaveLength(0);
      expect(app.get(BatchProducer).addJobs).toHaveBeenCalledTimes(1);
    },
  );

  it('uses a custom 1 MB setting for both file admission and HTTP body ceiling on startup', async () => {
    await teardown();
    await setup(1);
    sourceBytes = 1000000;
    expect(
      await post('sendDocument', {
        media: 'http://source.fixture/document.pdf',
        fileName: 'document.pdf',
      }).result,
    ).toMatchObject({ status: 201 });
    sourceBytes = 1000001;
    expect(
      await post('sendMedia', { media: 'http://source.fixture/file' }).result,
    ).toMatchObject({ status: 413 });
    expect(received).toHaveLength(1);
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/message/sendMedia/fixture-hub-id',
      payload: { media: 'A'.repeat(2400000) },
    });
    expect(result.statusCode).toBe(413);
    expect(result.json()).toEqual({
      statusCode: 413,
      error: 'PAYLOAD_TOO_LARGE',
      message: 'Request body is too large',
    });
  });
});
