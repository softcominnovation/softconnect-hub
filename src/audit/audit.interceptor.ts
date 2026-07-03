import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuthCachePayload } from '../auth/apikey.guard';
import { AuditService } from './audit.service';

interface FastifyRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  ip: string;
  product?: AuthCachePayload;
  resolvedInstanceId?: string;
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
