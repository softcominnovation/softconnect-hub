import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as http from 'http';
import * as https from 'https';
import { AppConfig } from '../../config/config.schema';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreaker {
  state: CircuitState;
  failureCount: number;
  openedAt: number | null;
}

@Injectable()
export class EvolutionHttpService {
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

    this.client = axios.create({
      timeout: timeoutMs,
      httpAgent: new http.Agent({ keepAlive: true }),
      httpsAgent: new https.Agent({ keepAlive: true }),
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

  async request<T>(
    method: 'get' | 'post' | 'put' | 'delete',
    vpsUrl: string,
    apiKey: string,
    path: string,
    data?: unknown,
    params?: Record<string, string>,
  ): Promise<T> {
    this.checkCircuit(vpsUrl);

    const maxRetries = this.config.get('PROXY_MAX_RETRIES', { infer: true });
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
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
}
