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
import {
  MEDIA_TIMEOUT_PROFILE,
  MediaHttpRequest,
} from '../decorators/media-timeout.decorator';
import {
  MEDIA_TIMEOUT_DEFAULTS,
  MediaRequestContext,
  MediaTimeoutException,
} from '../media-request-context';
import {
  MEDIA_ADMISSION,
  AdmittedMediaRequest,
} from '../../modules/media/media-http-admission';

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
    if (
      this.reflector.get<boolean>(MEDIA_TIMEOUT_PROFILE, context.getHandler())
    )
      return this.interceptMedia(context, next);
    const profile = this.reflector.get<QrTimeoutProfile | undefined>(
      QR_TIMEOUT_PROFILE,
      context.getHandler(),
    );
    const request = context.switchToHttp().getRequest<QrHttpRequest>();
    const body = request.body as { qrcode?: unknown } | undefined;
    if (profile === 'connect' || profile === 'create') {
      return this.interceptQr(
        context,
        next,
        profile === 'connect' || body?.qrcode === true,
      );
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

  private interceptMedia(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = context.switchToHttp().getRequest<MediaHttpRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const execution = new MediaRequestContext(
      this.config.get<number>(
        'MEDIA_REQUEST_TIMEOUT_MS',
        MEDIA_TIMEOUT_DEFAULTS.request,
      ),
      this.config.get<number>(
        'MEDIA_PROVIDER_TIMEOUT_MS',
        MEDIA_TIMEOUT_DEFAULTS.provider,
      ),
      this.config.get<number>(
        'MEDIA_DOWNLOAD_TIMEOUT_MS',
        MEDIA_TIMEOUT_DEFAULTS.download,
      ),
    );
    request.mediaExecution = execution;
    execution.takeAdmission = (request as AdmittedMediaRequest)[
      MEDIA_ADMISSION
    ]?.take;

    return new Observable((subscriber) => {
      let inner: Subscription | undefined;
      let settled = false;
      const removeListeners = () => {
        request.raw.removeListener('aborted', abandon);
        reply.raw.removeListener('close', onClose);
      };
      const finish = (statusCode: number, source: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        removeListeners();
        this.logger.log(
          JSON.stringify({
            event: 'media_request_finished',
            requestId: request.id,
            route: request.routeOptions?.url,
            durationMs: Math.round(execution.elapsedMs),
            timeoutMs: execution.timeoutMs,
            ...execution.diagnostics(),
            statusCode: execution.clientDisconnected ? 499 : statusCode,
            upstreamStatusCode: execution.upstreamStatusCode,
            clientDisconnected: execution.clientDisconnected,
            source: execution.reason ?? source,
          }),
        );
      };
      const fail = (error: unknown) => {
        if (settled) return;
        finish(
          error instanceof HttpException ? error.getStatus() : 500,
          execution.failureSource ?? 'error',
        );
        subscriber.error(error);
      };
      const abandon = () => {
        if (settled) return;
        execution.disconnect();
        const error = new MediaTimeoutException('client_disconnected');
        if (!execution.providerStarted) fail(error);
        else subscriber.error(error);
      };
      const onClose = () => {
        if (!reply.raw.writableFinished) abandon();
      };
      const timer = setTimeout(() => {
        execution.abort('request_timeout');
        fail(new MediaTimeoutException('request_timeout'));
        inner?.unsubscribe();
      }, execution.remainingMs);

      request.raw.once('aborted', abandon);
      reply.raw.once('close', onClose);
      if (request.raw.aborted || reply.raw.destroyed) {
        abandon();
      } else {
        inner = defer(() => next.handle()).subscribe({
          next: (value: unknown) => {
            if (settled) return;
            try {
              execution.assertActive();
              finish(reply.statusCode, 'upstream_success');
              subscriber.next(value);
              subscriber.complete();
            } catch (error) {
              fail(error);
            }
          },
          error: fail,
          complete: () => {
            if (!settled) finish(reply.statusCode, 'completed');
            subscriber.complete();
          },
        });
      }

      return () => {
        removeListeners();
        if (settled) inner?.unsubscribe();
        else {
          execution.disconnect();
          if (!execution.providerStarted) {
            finish(499, 'client_disconnected');
            inner?.unsubscribe();
          }
          // After dispatch, observe the provider until its original deadline.
        }
      };
    });
  }

  private interceptQr(
    context: ExecutionContext,
    next: CallHandler,
    qr = true,
  ): Observable<unknown> {
    const request = context.switchToHttp().getRequest<QrHttpRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const execution = new QrRequestContext(
      qr
        ? this.config.get<number>('QR_REQUEST_TIMEOUT_MS', 60000)
        : this.timeoutMs,
      qr
        ? this.config.get<number>('QR_PROVIDER_TIMEOUT_MS', 50000)
        : this.timeoutMs,
      qr ? undefined : Math.min(1000, Math.floor(this.timeoutMs / 10)),
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
            event: qr ? 'qr_request_finished' : 'instance_request_finished',
            requestId: request.id,
            route: request.routeOptions?.url,
            profile: qr ? 'qr' : 'create',
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
