import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { finalize, Observable, tap } from 'rxjs';
import type { QrRequestContext } from '../common/qr-request-context';
import { AuthCachePayload } from '../auth/apikey.guard';
import { AuditService } from './audit.service';

interface FastifyRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  ip: string;
  product?: AuthCachePayload;
  resolvedInstanceId?: string;
  qrExecution?: QrRequestContext;
}

interface FastifyReply {
  statusCode: number;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const reply = context.switchToHttp().getResponse<FastifyReply>();

    const startTime = Date.now();

    if (request.qrExecution) {
      const execution = request.qrExecution;
      return next.handle().pipe(
        finalize(() => {
          if (!execution.outcome) return;
          request.resolvedInstanceId = execution.instanceId;
          this.record(
            request,
            execution.outcome.statusCode,
            startTime,
            execution.outcome.source === 'success'
              ? undefined
              : execution.outcome.source,
          );
        }),
      );
    }

    return next.handle().pipe(
      tap({
        next: () => {
          this.record(request, reply.statusCode, startTime);
        },
        error: (err: { status?: number; message?: string }) => {
          const msg = err?.message ?? JSON.stringify(err);
          this.record(request, err.status ?? 500, startTime, msg);
        },
      }),
    );
  }

  private record(
    request: FastifyRequest,
    statusCode: number,
    startTime: number,
    errorMsg?: string,
  ): void {
    const product = request.product;
    if (!product) return;

    this.audit.log({
      productId: product.productId,
      instanceId: request.resolvedInstanceId,
      endpoint: request.url,
      method: request.method,
      statusCode,
      latencyMs: Date.now() - startTime,
      origin: request.headers['origin'],
      ip: request.ip,
      errorMsg,
    });
  }
}
