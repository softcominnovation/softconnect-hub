import { RequestTimeoutException } from '@nestjs/common';

export const MEDIA_FINISH_MARGIN_MS = 30000;
export const MEDIA_TIMEOUT_DEFAULTS = {
  request: 900000,
  provider: 600000,
  download: 240000,
};

export type MediaStopReason =
  | 'request_timeout'
  | 'provider_timeout'
  | 'download_timeout'
  | 'client_disconnected';

export interface MediaSourceDiagnostics {
  host?: string;
  stage?:
    | 'resolve'
    | 'request'
    | 'response'
    | 'redirect'
    | 'decode'
    | 'download';
  statusCode?: number;
  errorCode?: string;
}

export class MediaTimeoutException extends RequestTimeoutException {
  constructor(readonly reason: MediaStopReason) {
    super('Request timeout');
  }
}

export class MediaRequestContext {
  private readonly controller = new AbortController();
  private readonly startedAt = performance.now();
  readonly signal = this.controller.signal;
  reason?: MediaStopReason;
  clientDisconnected = false;
  providerStarted = false;
  calls = 0;
  callTimeoutMs?: number;
  upstreamStatusCode?: number;
  failureSource?:
    | 'upstream_http'
    | 'transport_error'
    | 'circuit_open'
    | 'preparation_error'
    | 'size_limit';
  mediaBytes?: number;
  preparationMs?: number;
  providerMs?: number;
  preparationStartedAt?: number;
  providerStartedAt?: number;
  takeAdmission?: () => () => void;
  readonly mediaSource: MediaSourceDiagnostics = {};

  diagnostics() {
    return {
      mediaBytes: this.mediaBytes,
      preparationMs:
        this.preparationMs ??
        (this.preparationStartedAt === undefined
          ? undefined
          : Math.round(performance.now() - this.preparationStartedAt)),
      providerMs:
        this.providerMs ??
        (this.providerStartedAt === undefined
          ? undefined
          : Math.round(performance.now() - this.providerStartedAt)),
      providerTimeoutMs: this.providerTimeoutMs,
      callTimeoutMs: this.callTimeoutMs,
      calls: this.calls,
      sourceHost: this.mediaSource.host,
      sourceStage: this.mediaSource.stage,
      sourceStatusCode: this.mediaSource.statusCode,
      sourceErrorCode: this.mediaSource.errorCode,
    };
  }

  constructor(
    readonly timeoutMs: number,
    readonly providerTimeoutMs: number,
    readonly downloadTimeoutMs: number,
    private readonly finishMarginMs = MEDIA_FINISH_MARGIN_MS,
  ) {}

  get elapsedMs(): number {
    return performance.now() - this.startedAt;
  }

  get remainingMs(): number {
    return Math.max(0, this.timeoutMs - this.elapsedMs);
  }

  abort(reason: MediaStopReason): void {
    if (this.signal.aborted) return;
    this.reason = reason;
    this.controller.abort(new MediaTimeoutException(reason));
  }

  disconnect(): void {
    this.clientDisconnected = true;
    if (!this.providerStarted) this.abort('client_disconnected');
  }

  assertActive(): void {
    if (!this.signal.aborted && this.remainingMs <= 0)
      this.abort('request_timeout');
    if (this.reason) throw new MediaTimeoutException(this.reason);
  }

  callTimeout(limitMs: number): number {
    this.assertActive();
    const available = Math.floor(this.remainingMs - this.finishMarginMs);
    if (available <= 0) {
      this.abort('request_timeout');
      this.assertActive();
    }
    return Math.min(limitMs, available);
  }

  startProviderCall(): number {
    const timeoutMs = this.callTimeout(this.providerTimeoutMs);
    this.providerStarted = true;
    this.providerStartedAt = performance.now();
    this.calls += 1;
    this.callTimeoutMs = timeoutMs;
    return timeoutMs;
  }
}
