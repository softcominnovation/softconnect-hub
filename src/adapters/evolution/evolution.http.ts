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
import type { ApplyInstanceDefaultsResult } from '../../providers/whatsapp-provider.interface';

export const INSTANCE_DEFAULT_PROXY_TIMEOUT_MS = 5000;

export interface QrHttpOptions {
  execution: QrRequestContext;
  operation: QrOperation;
}

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
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const timeoutMs = this.config.get('PROXY_TIMEOUT_MS', { infer: true });
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

  async trySetDefaultProxy(
    vpsUrl: string,
    apiKey: string,
    instanceName: string,
    data: unknown,
    execution?: QrRequestContext,
    deadlineAt?: number,
  ): Promise<ApplyInstanceDefaultsResult> {
    execution?.assertActive();
    const remainingMs = execution
      ? execution.remainingMs
      : deadlineAt === undefined
        ? Infinity
        : deadlineAt - performance.now();
    const timeoutMs = Math.min(
      INSTANCE_DEFAULT_PROXY_TIMEOUT_MS,
      Math.floor(remainingMs - QR_FINISH_MARGIN_MS),
    );
    if (timeoutMs <= 0) return { proxyFailure: 'budget_exhausted' };

    // An optional dependency must not open or reset the provider-wide circuit.
    const breaker = this.getBreaker(vpsUrl);
    if (
      breaker.state === 'OPEN' &&
      Date.now() - (breaker.openedAt ?? 0) < this.resetMs
    ) {
      return { proxyFailure: 'circuit_open' };
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
      const response = await this.client.request<unknown>({
        method: 'post',
        url: `${vpsUrl}/proxy/set/${instanceName}`,
        headers: { apikey: apiKey },
        data,
        timeout: timeoutMs,
        signal: controller.signal,
      });
      execution?.assertActive();
      if (controller.signal.aborted) return { proxyFailure: 'timeout' };
      return { proxy: response.data };
    } catch (error) {
      execution?.assertActive();
      if (
        controller.signal.aborted ||
        (axios.isAxiosError(error) &&
          !error.response &&
          (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'))
      ) {
        return { proxyFailure: 'timeout' };
      }
      return {
        proxyFailure:
          axios.isAxiosError(error) && error.response
            ? 'upstream_http'
            : 'transport_error',
      };
    } finally {
      clearTimeout(timer);
      execution?.signal.removeEventListener('abort', onAbort);
    }
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
    if (qr)
      return this.requestQr<T>(method, vpsUrl, apiKey, path, data, params, qr);
    this.checkCircuit(vpsUrl);

    const maxRetries = this.config.get('PROXY_MAX_RETRIES', { infer: true });
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const fullUrl = `${vpsUrl}${path}`;
        this.logger.log(
          `[evo:request] ${method.toUpperCase()} ${fullUrl}${data !== undefined ? ` body=${JSON.stringify(data)}` : ''}`,
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
            err.response.data as Record<string, unknown>,
            err.response.status,
          );
        }
        lastError = err as Error;
      }
    }

    this.recordFailure(vpsUrl);
    throw lastError ?? new Error('Unknown error');
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
          error.response.data as Record<string, unknown>,
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
