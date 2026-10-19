import { Body, Controller, Logger, Param, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { request as httpRequest } from 'node:http';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import {
  installMediaHttpAdmission,
  MEDIA_ADMISSION,
} from './media-http-admission';
import type { AdmittedMediaRequest } from './media-http-admission';
import { mediaBodyLimit } from './media-limits';

let called: string[];
let releaseExecution: (() => void) | undefined;
let executionStarted: (() => void) | undefined;

@Controller('message')
class FixtureController {
  @Post('sendMedia/:instanceId')
  async media(
    @Body() body: Record<string, unknown>,
    @Req() request: AdmittedMediaRequest,
    @Param('instanceId') id: string,
  ) {
    called.push(id);
    const release = request[MEDIA_ADMISSION]?.take();
    try {
      if (body.wait)
        await new Promise<void>((resolve) => {
          releaseExecution = resolve;
          executionStarted?.();
        });
      return { accepted: true };
    } finally {
      release?.();
    }
  }
  @Post('sendDocument/:instanceId')
  document() {
    called.push('document');
    return {};
  }
  @Post('sendSticker/:instanceId')
  sticker() {
    called.push('sticker');
    return {};
  }
  @Post('sendText/:instanceId')
  text() {
    called.push('text');
    return {};
  }
}
@Controller('message/batch')
class BatchFixtureController {
  @Post('send-media/:instanceId')
  media() {
    called.push('batch');
    return { batchJobId: 'fixture' };
  }
}

describe('Media admission before parsing, with Nest/Fastify', () => {
  let app: NestFastifyApplication;
  let url: string;
  beforeEach(async () => {
    called = [];
    releaseExecution = undefined;
    executionStarted = undefined;
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const module = await Test.createTestingModule({
      controllers: [FixtureController, BatchFixtureController],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    app.setGlobalPrefix('api/v1');
    installMediaHttpAdmission(
      app.getHttpAdapter().getInstance(),
      new ConfigService({
        MEDIA_MAX_SIZE_MB: 1,
        MEDIA_MAX_CONCURRENT: 1,
        MEDIA_REQUEST_TIMEOUT_MS: 1000,
      }),
    );
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });
  afterEach(async () => {
    releaseExecution?.();
    await app.close();
    jest.restoreAllMocks();
  });

  it('calculates the default 50 MB body envelope without increasing other routes', () => {
    expect(mediaBodyLimit(50)).toBe(67715244);
  });
  it.each(['sendMedia', 'sendDocument', 'sendSticker'])(
    'accepts a >1 MiB JSON only on %s and returns compatible 413 above its budget',
    async (route) => {
      const body = { media: 'A'.repeat(1200000), sticker: 'A'.repeat(10) };
      const ok = await app.inject({
        method: 'POST',
        url: `/api/v1/message/${route}/fixture`,
        payload: body,
      });
      expect(ok.statusCode).toBe(201);
      const denied = await app.inject({
        method: 'POST',
        url: `/api/v1/message/${route}/fixture`,
        payload: { media: 'A'.repeat(mediaBodyLimit(1)) },
      });
      expect(denied.statusCode).toBe(413);
      expect(denied.json()).toEqual({
        statusCode: 413,
        error: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large',
      });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/v1/message/${route}/after`,
            payload: {},
          })
        ).statusCode,
      ).toBe(201);
    },
  );
  it.each(['sendText', 'batch/send-media'])(
    'keeps the old 1 MiB ceiling at %s',
    async (route) => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/message/${route}/fixture`,
        payload: { media: 'A'.repeat(1200000) },
      });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(called).toEqual([]);
    },
  );

  it('reserves before reading a large body, rejects overload, and releases on parse error', async () => {
    const first = httpRequest(`${url}/api/v1/message/sendMedia/held`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '2000000',
      },
    });
    first.on('error', () => undefined);
    first.flushHeaders();
    first.write('{');
    await new Promise((resolve) => setTimeout(resolve, 40));
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/message/sendMedia/denied',
      payload: {},
    });
    expect(denied.statusCode).toBe(503);
    expect(called).toEqual([]);
    first.destroy();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/message/sendMedia/invalid',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });
    expect(invalid.statusCode).toBeGreaterThanOrEqual(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/message/sendMedia/ok',
          payload: {},
        })
      ).statusCode,
    ).toBe(201);
  });

  it('holds the reservation after HTTP disconnect until the adopted execution finishes', async () => {
    const started = new Promise<void>((resolve) => {
      executionStarted = resolve;
    });
    const first = httpRequest(`${url}/api/v1/message/sendMedia/held`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    first.on('error', () => undefined);
    first.end(JSON.stringify({ wait: true }));
    await started;
    first.destroy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/message/sendMedia/denied',
          payload: {},
        })
      ).statusCode,
    ).toBe(503);
    releaseExecution?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/message/sendMedia/ok',
          payload: {},
        })
      ).statusCode,
    ).toBe(201);
  });

  it('ends a stalled body upload with a finite 408 and releases admission', async () => {
    const response = await new Promise<number | undefined>(
      (resolve, reject) => {
        const request = httpRequest(
          `${url}/api/v1/message/sendMedia/stalled`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'content-length': '2000000',
            },
          },
          (reply) => {
            reply.resume();
            reply.once('end', () => {
              request.destroy();
              resolve(reply.statusCode);
            });
          },
        );
        request.on('error', reject);
        request.flushHeaders();
        request.write('{');
      },
    );
    expect(response).toBe(408);
    expect(called).toEqual([]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/message/sendMedia/after',
          payload: {},
        })
      ).statusCode,
    ).toBe(201);
  });
});
