import {
  ArgumentsHost,
  ExecutionContext,
  HttpException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { EventEmitter } from 'node:events';
import { defer, firstValueFrom, of } from 'rxjs';
import { MEDIA_TIMEOUT_PROFILE } from '../decorators/media-timeout.decorator';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import {
  MediaRequestContext,
  MediaTimeoutException,
} from '../media-request-context';
import { TimeoutInterceptor } from './timeout.interceptor';

describe('TimeoutInterceptor — media lifecycle', () => {
  let interceptor: TimeoutInterceptor;
  let log: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    interceptor = new TimeoutInterceptor(
      {
        get: (_key: string, fallback: number) => fallback,
      } as ConfigService,
      new Reflector(),
    );
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function fixture(media = true) {
    const handler = () => undefined;
    if (media) Reflect.defineMetadata(MEDIA_TIMEOUT_PROFILE, true, handler);
    const request = {
      id: 'fixture-request',
      body: {},
      routeOptions: { url: '/message/sendMedia/:id' },
      raw: Object.assign(new EventEmitter(), { aborted: false }),
      mediaExecution: undefined as MediaRequestContext | undefined,
    };
    const reply = {
      statusCode: 201,
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
    const work = (delay: number, error?: HttpException) => ({
      handle: () =>
        defer(() => {
          request.mediaExecution?.startProviderCall();
          return new Promise((resolve, reject) => {
            setTimeout(
              () =>
                error ? reject(error) : resolve({ key: { id: 'result' } }),
              delay,
            );
          });
        }),
    });
    return { request, reply, context, work };
  }

  it.each([60000, 120000])(
    'allows a media response at %i ms without the legacy timer',
    async (delay) => {
      const { request, reply, context, work } = fixture();
      const result = firstValueFrom(
        interceptor.intercept(context, work(delay)),
      );
      await jest.advanceTimersByTimeAsync(delay);
      await expect(result).resolves.toEqual({ key: { id: 'result' } });
      expect(request.mediaExecution?.timeoutMs).toBe(900000);
      expect(request.raw.listenerCount('aborted')).toBe(0);
      expect(reply.raw.listenerCount('close')).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
      expect(log).toHaveBeenCalledTimes(1);
    },
  );

  it('retains the legacy deadline on an unmarked route', async () => {
    const { request, context, work } = fixture(false);
    const result = firstValueFrom(
      interceptor.intercept(context, work(60000)),
    ).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(15000);
    expect(await result).toBeInstanceOf(HttpException);
    expect(request.mediaExecution).toBeUndefined();
    jest.clearAllTimers();
  });

  it.each([false, true])(
    'observes a late provider result after disconnect (error=%s)',
    async (reject) => {
      const { request, reply, context, work } = fixture();
      const result = firstValueFrom(
        interceptor.intercept(
          context,
          work(
            120000,
            reject
              ? new HttpException({ error: 'provider rejected' }, 422)
              : undefined,
          ),
        ),
      ).catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(10000);
      reply.raw.emit('close');
      expect(await result).toMatchObject({ reason: 'client_disconnected' });
      expect(request.mediaExecution?.signal.aborted).toBe(false);
      expect(log).not.toHaveBeenCalled();
      expect(reply.raw.listenerCount('close')).toBe(0);
      await jest.advanceTimersByTimeAsync(110000);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('"clientDisconnected":true'),
      );
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('does not start the handler when already disconnected', async () => {
    const { request, reply, context } = fixture();
    reply.raw.destroyed = true;
    const handle = jest.fn(() => of({ sent: true }));
    await expect(
      firstValueFrom(interceptor.intercept(context, { handle })),
    ).rejects.toMatchObject({ reason: 'client_disconnected' });
    expect(handle).not.toHaveBeenCalled();
    expect(request.mediaExecution?.signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stops pre-dispatch work on disconnect and rejects a subsequent provider call', async () => {
    const { request, context } = fixture();
    let resume!: () => void;
    const result = firstValueFrom(
      interceptor.intercept(context, {
        handle: () =>
          defer(async () => {
            await new Promise<void>((resolve) => {
              resume = resolve;
            });
            request.mediaExecution!.startProviderCall();
            return 'unreachable';
          }),
      }),
    ).catch((error: unknown) => error);
    request.raw.emit('aborted');
    expect(await result).toMatchObject({ reason: 'client_disconnected' });
    resume();
    await jest.advanceTimersByTimeAsync(1);
    expect(request.mediaExecution?.calls).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cleans a detached observation at the original total deadline', async () => {
    const { request, reply, context } = fixture();
    const result = firstValueFrom(
      interceptor.intercept(context, {
        handle: () =>
          defer(() => {
            request.mediaExecution!.startProviderCall();
            return new Promise(() => undefined);
          }),
      }),
    ).catch((error: unknown) => error);
    reply.raw.emit('close');
    await result;
    await jest.advanceTimersByTimeAsync(900000);
    expect(request.mediaExecution?.reason).toBe('request_timeout');
    expect(log).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('preserves an upstream error and cleans a synchronous handler failure', async () => {
    const { context, request, reply } = fixture();
    const error = new HttpException({ message: 'fixture error' }, 400);
    await expect(
      firstValueFrom(
        interceptor.intercept(context, {
          handle: () => {
            throw error;
          },
        }),
      ),
    ).rejects.toBe(error);
    expect(request.raw.listenerCount('aborted')).toBe(0);
    expect(reply.raw.listenerCount('close')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not write an HTTP response after the consumer has disconnected', () => {
    const switchToHttp = jest.fn();
    new HttpExceptionFilter().catch(
      new MediaTimeoutException('client_disconnected'),
      {
        switchToHttp,
      } as unknown as ArgumentsHost,
    );
    expect(switchToHttp).not.toHaveBeenCalled();
  });
});
