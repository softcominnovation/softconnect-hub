import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AppConfig } from '../../config/config.schema';
import { EvolutionHttpService } from './evolution.http';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeConfig(
  overrides: Record<string, unknown> = {},
): ConfigService<AppConfig, true> {
  const values: Record<string, unknown> = {
    PROXY_TIMEOUT_MS: 5000,
    PROXY_MAX_RETRIES: 0,
    CIRCUIT_BREAKER_THRESHOLD: 5,
    CIRCUIT_BREAKER_RESET_MS: 30000,
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService<AppConfig, true>;
}

describe('EvolutionHttpService — circuit breaker', () => {
  const VPS_URL = 'http://vps.test:8080';
  const API_KEY = 'test-api-key';

  beforeEach(() => {
    mockedAxios.create = jest.fn().mockReturnValue({
      request: jest.fn(),
    });
  });

  it('should be in CLOSED state initially', () => {
    const svc = new EvolutionHttpService(makeConfig());
    expect(svc.getCircuitState(VPS_URL)).toBe('CLOSED');
  });

  it('should open the circuit after threshold failures', async () => {
    const mockRequest = jest
      .fn()
      .mockRejectedValue(new Error('Connection refused'));
    mockedAxios.create = jest.fn().mockReturnValue({ request: mockRequest });

    const svc = new EvolutionHttpService(
      makeConfig({ CIRCUIT_BREAKER_THRESHOLD: 3 }),
    );

    for (let i = 0; i < 3; i++) {
      try {
        await svc.request('get', VPS_URL, API_KEY, '/test');
      } catch {
        /* ignore */
      }
    }

    expect(svc.getCircuitState(VPS_URL)).toBe('OPEN');
  });

  it('should throw ServiceUnavailableException when circuit is OPEN', async () => {
    const mockRequest = jest.fn().mockRejectedValue(new Error('fail'));
    mockedAxios.create = jest.fn().mockReturnValue({ request: mockRequest });

    const svc = new EvolutionHttpService(
      makeConfig({ CIRCUIT_BREAKER_THRESHOLD: 2 }),
    );

    for (let i = 0; i < 2; i++) {
      try {
        await svc.request('get', VPS_URL, API_KEY, '/test');
      } catch {
        /* ignore */
      }
    }

    await expect(svc.request('get', VPS_URL, API_KEY, '/test')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('should transition to HALF_OPEN after reset timeout', async () => {
    const mockRequest = jest.fn().mockRejectedValue(new Error('fail'));
    mockedAxios.create = jest.fn().mockReturnValue({ request: mockRequest });

    const svc = new EvolutionHttpService(
      makeConfig({ CIRCUIT_BREAKER_THRESHOLD: 2, CIRCUIT_BREAKER_RESET_MS: 0 }),
    );

    for (let i = 0; i < 2; i++) {
      try {
        await svc.request('get', VPS_URL, API_KEY, '/test');
      } catch {
        /* ignore */
      }
    }

    await new Promise((r) => setTimeout(r, 10));

    expect(svc.getCircuitState(VPS_URL)).toBe('OPEN');
    try {
      await svc.request('get', VPS_URL, API_KEY, '/test');
    } catch {
      /* ignore */
    }
    expect(svc.getCircuitState(VPS_URL)).toBe('OPEN');
  });

  it('should reset to CLOSED on successful request', async () => {
    const mockRequest = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ data: 'ok' });

    mockedAxios.create = jest.fn().mockReturnValue({ request: mockRequest });

    const svc = new EvolutionHttpService(
      makeConfig({ CIRCUIT_BREAKER_THRESHOLD: 5 }),
    );

    try {
      await svc.request('get', VPS_URL, API_KEY, '/test');
    } catch {
      /* ignore */
    }
    try {
      await svc.request('get', VPS_URL, API_KEY, '/test');
    } catch {
      /* ignore */
    }

    expect(svc.getCircuitState(VPS_URL)).toBe('CLOSED');

    const result = await svc.request('get', VPS_URL, API_KEY, '/test');
    expect(result).toBe('ok');
    expect(svc.getCircuitState(VPS_URL)).toBe('CLOSED');
  });

  it('should maintain independent circuits per VPS URL', async () => {
    const mockRequest = jest.fn().mockRejectedValue(new Error('fail'));
    mockedAxios.create = jest.fn().mockReturnValue({ request: mockRequest });

    const svc = new EvolutionHttpService(
      makeConfig({ CIRCUIT_BREAKER_THRESHOLD: 2 }),
    );
    const VPS_B = 'http://vps-b.test:8080';

    for (let i = 0; i < 2; i++) {
      try {
        await svc.request('get', VPS_URL, API_KEY, '/test');
      } catch {
        /* ignore */
      }
    }

    expect(svc.getCircuitState(VPS_URL)).toBe('OPEN');
    expect(svc.getCircuitState(VPS_B)).toBe('CLOSED');
  });
});
