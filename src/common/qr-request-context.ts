import { RequestTimeoutException } from '@nestjs/common';
import type { CreateOutcome } from './create-outcome';

export const QR_FINISH_MARGIN_MS = 1000;

export type QrStopReason =
  | 'request_timeout'
  | 'provider_timeout'
  | 'client_disconnected';

export type QrOperation =
  | 'lookup'
  | 'create'
  | 'connect'
  | 'webhook'
  | 'proxy'
  | 'delete';

export class QrTimeoutException extends RequestTimeoutException {
  constructor(readonly reason: QrStopReason) {
    super('Request timeout');
  }
}

export class QrRequestContext {
  private readonly controller = new AbortController();
  private readonly startedAt = performance.now();
  readonly signal = this.controller.signal;
  reason?: QrStopReason;
  outcome?: { statusCode: number; source: string };
  failureSource?: 'upstream_http' | 'transport_error' | 'circuit_open';
  providerId?: string;
  instanceId?: string;
  productId?: string;
  calls = 0;
  lastOperation?: QrOperation;
  callTimeoutMs?: number;
  createOutcome?: CreateOutcome;

  constructor(
    readonly timeoutMs: number,
    readonly providerTimeoutMs: number,
    private readonly finishMarginMs = QR_FINISH_MARGIN_MS,
  ) {}

  get elapsedMs(): number {
    return performance.now() - this.startedAt;
  }

  get remainingMs(): number {
    return Math.max(0, this.timeoutMs - this.elapsedMs);
  }

  abort(reason: QrStopReason): void {
    if (this.signal.aborted) return;
    this.reason = reason;
    this.controller.abort(new QrTimeoutException(reason));
  }

  assertActive(): void {
    if (!this.signal.aborted && this.remainingMs <= 0) {
      this.abort('request_timeout');
    }
    if (this.reason) throw new QrTimeoutException(this.reason);
  }

  callTimeout(limitMs: number): number {
    this.assertActive();
    const remaining = Math.floor(this.remainingMs - this.finishMarginMs);
    if (remaining <= 0) {
      this.abort('request_timeout');
      this.assertActive();
    }
    return Math.min(limitMs, remaining);
  }

  finish(statusCode: number, source: string): void {
    this.outcome ??= { statusCode, source: this.reason ?? source };
  }
}
