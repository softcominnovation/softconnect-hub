import { ExecutionContext, HttpException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'node:events';
import { defer, firstValueFrom, Observable, of } from 'rxjs';
import { AuditInterceptor } from '../../audit/audit.interceptor';
import { AuditService } from '../../audit/audit.service';
import {
  QR_TIMEOUT_PROFILE,
  QrTimeoutProfile,
} from '../decorators/qr-timeout.decorator';
import { QrRequestContext, QrTimeoutException } from '../qr-request-context';
import { TimeoutInterceptor } from './timeout.interceptor';

describe('TimeoutInterceptor — coordinated QR budget', () => {
  let interceptor: TimeoutInterceptor;
  let log: jest.SpyInstance;
  const config = {
    get: (key: string, fallback: number) =>
      ({
        PROXY_TIMEOUT_MS: 15000,
        QR_REQUEST_TIMEOUT_MS: 60000,
        QR_PROVIDER_TIMEOUT_MS: 50000,
      })[key] ?? fallback,
  } as ConfigService;

  beforeEach(() => {
    jest.useFakeTimers();
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    interceptor = new TimeoutInterceptor(config, new Reflector());
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function fixture(profile?: QrTimeoutProfile, body?: unknown) {
    const handler = () => undefined;
    if (profile) Reflect.defineMetadata(QR_TIMEOUT_PROFILE, profile, handler);
    const request = {
      id: 'request-fixture',
      body,
      method: 'GET',
      url: '/instance/fixture/connect',
      headers: {},
      ip: '127.0.0.1',
      routeOptions: { url: '/instance/:id/connect' },
      product: { productId: 'product-fixture' },
      raw: Object.assign(new EventEmitter(), { aborted: false }),
      qrExecution: undefined as QrRequestContext | undefined,
    };
    const reply = {
      statusCode: 200,
      raw: Object.assign(new EventEmitter(), {
        writableFinished: false,
        destroyed: false,
      }),
    };
    const context = {
      getHandler: () => handler,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => reply,
      }),
    } as unknown as ExecutionContext;
    return { request, reply, context };
  }

  function delayed(delayMs: number, value: unknown = { base64: 'fixture-qr' }) {
    return {
      handle: () =>
        defer(
          () =>
            new Promise((resolve) => setTimeout(() => resolve(value), delayMs)),
        ),
    };
  }

  it('returns QR after 20 seconds under the 60-second profile', async () => {
    const { context, request, reply } = fixture('connect');
    const result = firstValueFrom(
      interceptor.intercept(context, delayed(20000)),
    );
    request.raw.emit('close');
    await jest.advanceTimersByTimeAsync(20000);
    await expect(result).resolves.toEqual({ base64: 'fixture-qr' });
    expect(request.qrExecution?.signal.aborted).toBe(false);
    expect(request.raw.listenerCount('aborted')).toBe(0);
    expect(reply.raw.listenerCount('close')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, false, 'true'])(
    'keeps legacy create timeout for qrcode=%s',
    async (qrcode) => {
      const { context, request } = fixture('create', { qrcode });
      const result = firstValueFrom(
        interceptor.intercept(context, delayed(20000)),
      ).catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(15000);
      expect(await result).toBeInstanceOf(HttpException);
      expect(((await result) as HttpException).getStatus()).toBe(408);
      expect(request.qrExecution?.timeoutMs).toBe(15000);
      expect(request.qrExecution?.signal.aborted).toBe(true);
      jest.clearAllTimers();
    },
  );

  it('selects the create profile only for boolean true', async () => {
    const { context, request } = fixture('create', { qrcode: true });
    await firstValueFrom(
      interceptor.intercept(context, {
        handle: () => of({ instanceId: 'fixture-id' }),
      }),
    );
    expect(request.qrExecution?.timeoutMs).toBe(60000);
  });

  it('keeps non-QR requests at their original deadline', async () => {
    const { context, request } = fixture();
    const result = firstValueFrom(
      interceptor.intercept(context, delayed(20000)),
    ).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(15000);
    expect(((await result) as HttpException).getStatus()).toBe(408);
    expect(request.qrExecution).toBeUndefined();
    jest.clearAllTimers();
  });

  it('aborts at the global deadline, audits once and ignores late completion', async () => {
    const { context, request } = fixture('connect');
    const auditLog = jest.fn();
    const audit = new AuditInterceptor({
      log: auditLog,
    } as unknown as AuditService);
    const result = firstValueFrom(
      interceptor.intercept(context, {
        handle: () => audit.intercept(context, delayed(61000)),
      }),
    ).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(60000);
    expect(((await result) as HttpException).getStatus()).toBe(408);
    expect(request.qrExecution?.signal.aborted).toBe(true);
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 408, errorMsg: 'request_timeout' }),
    );
    await jest.advanceTimersByTimeAsync(1000);
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps the outer proxy limit observable without changing the QR budget', async () => {
    const { context, request, reply } = fixture('connect');
    const result = firstValueFrom(
      interceptor.intercept(context, delayed(20000)),
    ).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(15000);
    reply.raw.emit('close');
    expect(await result).toMatchObject({ reason: 'client_disconnected' });
    expect(request.qrExecution?.outcome).toMatchObject({
      statusCode: 499,
      source: 'client_disconnected',
    });
    await jest.advanceTimersByTimeAsync(5000);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes cancellable work and cleans listeners on a real request abort', () => {
    const { context, request, reply } = fixture('connect');
    const cleanup = jest.fn();
    const errors = jest.fn();
    interceptor
      .intercept(context, { handle: () => new Observable(() => cleanup) })
      .subscribe({ error: errors });
    request.raw.emit('aborted');
    expect(errors).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(reply.raw.listenerCount('close')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('finalizes once when global timeout, upstream rejection and client close race', async () => {
    const { context, request, reply } = fixture('connect');
    const auditLog = jest.fn();
    const audit = new AuditInterceptor({
      log: auditLog,
    } as unknown as AuditService);
    const result = firstValueFrom(
      interceptor.intercept(context, {
        handle: () =>
          audit.intercept(context, {
            handle: () =>
              defer(
                () =>
                  new Promise((_resolve, reject) => {
                    setTimeout(() => {
                      request.qrExecution?.abort('provider_timeout');
                      reject(new QrTimeoutException('provider_timeout'));
                      reply.raw.emit('close');
                    }, 60000);
                  }),
              ),
          }),
      }),
    ).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(60000);
    expect(await result).toMatchObject({ reason: 'request_timeout' });
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(request.raw.listenerCount('aborted')).toBe(0);
    expect(reply.raw.listenerCount('close')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cleans up a synchronous downstream error', async () => {
    const { context, request, reply } = fixture('connect');
    const error = new Error('fixture failure');
    await expect(
      firstValueFrom(
        interceptor.intercept(context, {
          handle: () => {
            throw error;
          },
        }),
      ),
    ).rejects.toBe(error);
    expect(request.qrExecution?.outcome).toEqual({
      statusCode: 500,
      source: 'error',
    });
    expect(reply.raw.listenerCount('close')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
