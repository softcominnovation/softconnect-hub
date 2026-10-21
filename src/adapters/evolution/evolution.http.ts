import type { PreparedMedia } from '../../modules/media/prepared-media';
import { Optional } from '@nestjs/common';
import { MaintenanceGuard } from '../../modules/maintenance/maintenance.guard';
import { withoutRelayToken } from '../../modules/webhook/relay-configuration';
import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as http from 'http';
import * as https from 'https';
import { AppConfig } from '../../config/config.schema';
import {
  QR_FINISH_MARGIN_MS,
  QrRequestContext,
  QrTimeoutException,
  QrOperation,
} from '../../common/qr-request-context';
import type { OptionalCallFailure } from '../../providers/whatsapp-provider.interface';
import {
  MediaRequestContext,
  MediaTimeoutException,
} from '../../common/media-request-context';

export interface QrHttpOptions {
  execution: QrRequestContext;
  operation: QrOperation;
}

/** Single finite deadline shared by every call/interval of an optional step. */
export interface OptionalCallBudget {
  readonly execution?: QrRequestContext;
  /** `performance.now()` instant, with the finish margin already deducted. */
  readonly deadlineAt: number;
  readonly callLimitMs: number;
}

export type OptionalCallResult<T> =
  | { data: T }
  | { failure: OptionalCallFailure; status?: number };

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreaker {
  state: CircuitState;
  failureCount: number;
  openedAt: number | null;
}

@Injectable()
export class EvolutionHttpService {
  private readonly logger = new Logger(EvolutionHttpService.name);
  private readonly client: AxiosInstance;
  private readonly threshold: number;
  private readonly resetMs: number;
  private readonly legacyTimeoutMs: number;
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    @Optional() private readonly maintenance?: MaintenanceGuard,
  ) {
    const timeoutMs = this.config.get('PROXY_TIMEOUT_MS', { infer: true });
    this.legacyTimeoutMs = timeoutMs;
    this.threshold = this.config.get('CIRCUIT_BREAKER_THRESHOLD', {
      infer: true,
    });
    this.resetMs = this.config.get('CIRCUIT_BREAKER_RESET_MS', { infer: true });

    const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
    const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

    httpAgent.setMaxListeners(0);
    httpsAgent.setMaxListeners(0);

    this.client = axios.create({
      timeout: timeoutMs,
      httpAgent,
      httpsAgent,
    });
  }

  private getBreaker(vpsUrl: string): CircuitBreaker {
    if (!this.breakers.has(vpsUrl)) {
      this.breakers.set(vpsUrl, {
        state: 'CLOSED',
        failureCount: 0,
        openedAt: null,
      });
    }
    return this.breakers.get(vpsUrl)!;
  }

  private checkCircuit(vpsUrl: string): void {
    const breaker = this.getBreaker(vpsUrl);

    if (breaker.state === 'OPEN') {
      const elapsed = Date.now() - (breaker.openedAt ?? 0);
      if (elapsed >= this.resetMs) {
        breaker.state = 'HALF_OPEN';
      } else {
        throw new ServiceUnavailableException(
          `Circuit breaker aberto para ${vpsUrl}`,
        );
      }
    }
  }

  private recordSuccess(vpsUrl: string): void {
    const breaker = this.getBreaker(vpsUrl);
    breaker.failureCount = 0;
    breaker.state = 'CLOSED';
    breaker.openedAt = null;
  }

  private recordFailure(vpsUrl: string): void {
    const breaker = this.getBreaker(vpsUrl);
    breaker.failureCount += 1;
    if (breaker.failureCount >= this.threshold) {
      breaker.state = 'OPEN';
      breaker.openedAt = Date.now();
    }
  }

  getCircuitState(vpsUrl: string): CircuitState {
    return this.getBreaker(vpsUrl).state;
  }

  /**
   * QR: remaining request budget and `QR_PROVIDER_TIMEOUT_MS` per call.
   * Legacy: the request deadline and `PROXY_TIMEOUT_MS` per call.
   * Returns undefined when no finite deadline is known.
   */
  createOptionalBudget(
    execution?: QrRequestContext,
    deadlineAt?: number,
  ): OptionalCallBudget | undefined {
    execution?.assertActive();
    if (execution) {
      return {
        execution,
        deadlineAt:
          performance.now() + execution.remainingMs - QR_FINISH_MARGIN_MS,
        callLimitMs: execution.providerTimeoutMs,
      };
    }
    if (deadlineAt === undefined || !Number.isFinite(deadlineAt)) {
      return undefined;
    }
    return {
      deadlineAt: deadlineAt - QR_FINISH_MARGIN_MS,
      callLimitMs: this.legacyTimeoutMs,
    };
  }

  private optionalRemainingMs(budget: OptionalCallBudget): number {
    return Math.max(0, Math.floor(budget.deadlineAt - performance.now()));
  }

  /**
   * Optional call: no retry, child timeout that never aborts the parent
   * context, and no effect on the provider-wide circuit breaker.
   */
  async tryOptionalRequest<T>(
    budget: OptionalCallBudget,
    method: 'get' | 'post',
    vpsUrl: string,
    apiKey: string,
    path: string,
    data?: unknown,
  ): Promise<OptionalCallResult<T>> {
    const { execution } = budget;
    execution?.assertActive();
    const startedAt = performance.now();
    const callDeadlineAt = Math.min(
      budget.deadlineAt,
      startedAt + budget.callLimitMs,
    );
    const timeoutMs = Math.floor(callDeadlineAt - startedAt);
    if (timeoutMs <= 0) return { failure: 'budget_exhausted' };

    const breaker = this.getBreaker(vpsUrl);
    if (
      breaker.state === 'OPEN' &&
      Date.now() - (breaker.openedAt ?? 0) < this.resetMs
    ) {
      return { failure: 'circuit_open' };
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    execution?.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (execution) {
      execution.calls += 1;
      execution.lastOperation = 'proxy';
      execution.callTimeoutMs = timeoutMs;
    }
    try {
      const response = await this.client.request<T>({
        method,
        url: `${vpsUrl}${path}`,
        headers: { apikey: apiKey },
        data: method === 'post' ? data : undefined,
        timeout: timeoutMs,
        signal: controller.signal,
      });
      execution?.assertActive();
      // A busy event loop may settle the response before dispatching the timer.
      if (controller.signal.aborted || performance.now() >= callDeadlineAt)
        return { failure: 'timeout' };
      return { data: response.data };
    } catch (error) {
      execution?.assertActive();
      if (
        controller.signal.aborted ||
        performance.now() >= callDeadlineAt ||
        (axios.isAxiosError(error) &&
          !error.response &&
          (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'))
      ) {
        return { failure: 'timeout' };
      }
      if (axios.isAxiosError(error) && error.response) {
        return { failure: 'upstream_http', status: error.response.status };
      }
      return { failure: 'transport_error' };
    } finally {
      clearTimeout(timer);
      execution?.signal.removeEventListener('abort', onAbort);
    }
  }

  /** Cancellable pause inside the budget; false when it does not fit. */
  async waitOptional(
    budget: OptionalCallBudget,
    delayMs: number,
  ): Promise<boolean> {
    const { execution } = budget;
    execution?.assertActive();
    if (this.optionalRemainingMs(budget) <= delayMs) return false;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        execution?.signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, delayMs);
      execution?.signal.addEventListener('abort', done, { once: true });
    });
    execution?.assertActive();
    return this.optionalRemainingMs(budget) > 0;
  }

  async request<T>(
    method: 'get' | 'post' | 'put' | 'delete',
    vpsUrl: string,
    apiKey: string,
    path: string,
    data?: unknown,
    params?: Record<string, string>,
    qr?: QrHttpOptions,
  ): Promise<T> {
    const lifecycle =
      /^\/instance\/(?:connect|restart|logout|delete)\/(.+)$/.exec(path);
    const createName =
      path === '/instance/create' && data && typeof data === 'object'
        ? (data as { instanceName?: unknown }).instanceName
        : undefined;
    const name =
      lifecycle?.[1] ??
      (typeof createName === 'string' ? createName : undefined);
    const call = () =>
      this.requestInternal<T>(method, vpsUrl, apiKey, path, data, params, qr);
    return name && this.maintenance
      ? this.maintenance.run(vpsUrl, name, call)
      : call();
  }

  private async requestInternal<T>(
    method: 'get' | 'post' | 'put' | 'delete',
    vpsUrl: string,
    apiKey: string,
    path: string,
    data?: unknown,
    params?: Record<string, string>,
    qr?: QrHttpOptions,
  ): Promise<T> {
    if (qr)
      return this.requestQr<T>(method, vpsUrl, apiKey, path, data, params, qr);
    this.checkCircuit(vpsUrl);

    const maxRetries = this.config.get('PROXY_MAX_RETRIES', { infer: true });
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const fullUrl = `${vpsUrl}${path}`;
        this.logger.log(
          `[evo:request] ${method.toUpperCase()} ${fullUrl}${data !== undefined ? ` body=${JSON.stringify(withoutRelayToken(data))}` : ''}`,
        );
        const response = await this.client.request<T>({
          method,
          url: `${vpsUrl}${path}`,
          headers: { apikey: apiKey },
          params,
          data: method !== 'get' && method !== 'delete' ? data : undefined,
        });
        this.recordSuccess(vpsUrl);
        return response.data;
      } catch (err) {
        if (axios.isAxiosError(err) && err.response) {
          throw new HttpException(
            withoutRelayToken(err.response.data) as Record<string, unknown>,
            err.response.status,
          );
        }
        lastError = err as Error;
      }
    }

    this.recordFailure(vpsUrl);
    throw lastError ?? new Error('Unknown error');
  }

  async requestMedia<T>(
    vpsUrl: string,
    apiKey: string,
    path: string,
    data: unknown,
    execution: MediaRequestContext,
    prepared?: PreparedMedia,
  ): Promise<T> {
    execution.assertActive();
    try {
      this.checkCircuit(vpsUrl);
    } catch (error) {
      execution.failureSource = 'circuit_open';
      throw error;
    }
    const body = prepared?.body(data as Record<string, unknown>);
    const startedAt = performance.now();
    const timeoutMs = execution.startProviderCall();
    const deadlineAt = performance.now() + timeoutMs;
    const reason =
      timeoutMs < execution.providerTimeoutMs
        ? 'request_timeout'
        : 'provider_timeout';
    const timer = setTimeout(() => execution.abort(reason), timeoutMs);
    try {
      const response = await this.client.request<T>({
        method: 'post',
        url: `${vpsUrl}${path}`,
        headers: { apikey: apiKey, ...body?.headers },
        data: body?.stream ?? data,
        ...(body ? { maxRedirects: 0, maxBodyLength: Infinity } : {}),
        timeout: timeoutMs,
        signal: execution.signal,
      });
      if (performance.now() >= deadlineAt) execution.abort(reason);
      execution.assertActive();
      execution.upstreamStatusCode = response.status;
      this.recordSuccess(vpsUrl);
      return response.data;
    } catch (error) {
      if (
        performance.now() >= deadlineAt ||
        (axios.isAxiosError(error) &&
          !error.response &&
          (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'))
      )
        execution.abort(reason);
      if (execution.reason) {
        if (execution.reason === 'provider_timeout') this.recordFailure(vpsUrl);
        throw new MediaTimeoutException(execution.reason);
      }
      if (axios.isAxiosError(error) && error.response) {
        execution.failureSource = 'upstream_http';
        execution.upstreamStatusCode = error.response.status;
        throw new HttpException(
          withoutRelayToken(error.response.data) as Record<string, unknown>,
          error.response.status,
        );
      }
      execution.failureSource = 'transport_error';
      this.recordFailure(vpsUrl);
      throw error;
    } finally {
      execution.providerMs = Math.round(performance.now() - startedAt);
      clearTimeout(timer);
    }
  }

  private async requestQr<T>(
    method: 'get' | 'post' | 'put' | 'delete',
    vpsUrl: string,
    apiKey: string,
    path: string,
    data: unknown,
    params: Record<string, string> | undefined,
    { execution, operation }: QrHttpOptions,
  ): Promise<T> {
    const limit = execution.providerTimeoutMs;
    const timeoutMs = execution.callTimeout(limit);
    execution.failureSource = undefined;
    try {
      this.checkCircuit(vpsUrl);
    } catch (error) {
      execution.failureSource = 'circuit_open';
      throw error;
    }
    const reason = timeoutMs < limit ? 'request_timeout' : 'provider_timeout';
    const timer = setTimeout(() => execution.abort(reason), timeoutMs);
    execution.calls += 1;
    execution.lastOperation = operation;
    execution.callTimeoutMs = timeoutMs;

    try {
      const response = await this.client.request<T>({
        method,
        url: `${vpsUrl}${path}`,
        headers: { apikey: apiKey },
        params,
        data: method !== 'get' && method !== 'delete' ? data : undefined,
        timeout: timeoutMs,
        signal: execution.signal,
      });
      execution.assertActive();
      this.recordSuccess(vpsUrl);
      return response.data;
    } catch (error) {
      if (
        !execution.signal.aborted &&
        axios.isAxiosError(error) &&
        !error.response &&
        (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')
      ) {
        execution.abort(reason);
      }
      if (execution.reason) {
        if (execution.reason === 'provider_timeout') this.recordFailure(vpsUrl);
        throw new QrTimeoutException(execution.reason);
      }
      if (axios.isAxiosError(error) && error.response) {
        execution.failureSource = 'upstream_http';
        throw new HttpException(
          withoutRelayToken(error.response.data) as Record<string, unknown>,
          error.response.status,
        );
      }
      execution.failureSource = 'transport_error';
      this.recordFailure(vpsUrl);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
