import {
  CallHandler,
  ExecutionContext,
  Injectable,
  HttpException,
  Logger,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { FastifyReply } from 'fastify';
import {
  defer,
  Observable,
  Subscription,
  TimeoutError,
  throwError,
} from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import {
  QR_TIMEOUT_PROFILE,
  QrHttpRequest,
  QrTimeoutProfile,
} from '../decorators/qr-timeout.decorator';
import { QrRequestContext, QrTimeoutException } from '../qr-request-context';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TimeoutInterceptor.name);
  private readonly timeoutMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {
    this.timeoutMs = this.config.get<number>('PROXY_TIMEOUT_MS', 15000);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const profile = this.reflector.get<QrTimeoutProfile | undefined>(
      QR_TIMEOUT_PROFILE,
      context.getHandler(),
    );
    const request = context.switchToHttp().getRequest<QrHttpRequest>();
    const body = request.body as { qrcode?: unknown } | undefined;
    if (
      profile === 'connect' ||
      (profile === 'create' && body?.qrcode === true)
    ) {
      return this.interceptQr(context, next);
    }
    return next.handle().pipe(
      timeout(this.timeoutMs),
      catchError((err: unknown) => {
        if (err instanceof TimeoutError) {
          return throwError(
            () => new RequestTimeoutException('Request timeout'),
          );
        }
        return throwError(() => err);
      }),
    );
  }

  private interceptQr(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = context.switchToHttp().getRequest<QrHttpRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const execution = new QrRequestContext(
      this.config.get<number>('QR_REQUEST_TIMEOUT_MS', 60000),
      this.config.get<number>('QR_PROVIDER_TIMEOUT_MS', 50000),
    );
    request.qrExecution = execution;

    return new Observable((subscriber) => {
      let inner: Subscription | undefined;
      const fail = (error: unknown) => {
        execution.finish(
          execution.reason === 'client_disconnected'
            ? 499
            : error instanceof HttpException
              ? error.getStatus()
              : 500,
          execution.failureSource ?? 'error',
        );
        subscriber.error(error);
      };
      const abandon = () => {
        execution.abort('client_disconnected');
        fail(new QrTimeoutException('client_disconnected'));
      };
      const onClose = () => {
        if (!reply.raw.writableFinished) abandon();
      };
      const timer = setTimeout(() => {
        execution.abort('request_timeout');
        fail(new QrTimeoutException('request_timeout'));
      }, execution.remainingMs);

      request.raw.once('aborted', abandon);
      reply.raw.once('close', onClose);
      if (request.raw.aborted || reply.raw.destroyed) {
        abandon();
      } else {
        inner = defer(() => next.handle()).subscribe({
          next: (value: unknown) => {
            try {
              execution.assertActive();
              execution.finish(reply.statusCode, 'success');
              subscriber.next(value);
            } catch (error) {
              fail(error);
            }
          },
          error: fail,
          complete: () => subscriber.complete(),
        });
      }

      return () => {
        clearTimeout(timer);
        request.raw.removeListener('aborted', abandon);
        reply.raw.removeListener('close', onClose);
        inner?.unsubscribe();
        this.logger.log(
          JSON.stringify({
            event: 'qr_request_finished',
            requestId: request.id,
            route: request.routeOptions?.url,
            profile: 'qr',
            durationMs: Math.round(execution.elapsedMs),
            timeoutMs: execution.timeoutMs,
            providerTimeoutMs: execution.providerTimeoutMs,
            lastOperation: execution.lastOperation,
            callTimeoutMs: execution.callTimeoutMs,
            calls: execution.calls,
            productId: execution.productId,
            providerId: execution.providerId,
            instanceId: execution.instanceId,
            ...execution.outcome,
          }),
        );
      };
    });
  }
}
