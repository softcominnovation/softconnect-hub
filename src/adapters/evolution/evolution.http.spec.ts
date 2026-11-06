import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AppConfig } from '../../config/config.schema';
import { EvolutionHttpService } from './evolution.http';
import { MediaRequestContext } from '../../common/media-request-context';
import { SendRequestContext } from '../../common/send-request-context';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Evolution send requests wait for the provider', () => {
  afterEach(() => jest.useRealTimers());

  it.each(['text', 'media'])(
    'keeps %s pending up to an explicitly extended safety deadline',
    async (kind) => {
      jest.useFakeTimers();
      let respond!: (response: unknown) => void;
      const request = jest.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            respond = resolve;
          }),
      );
      mockedAxios.create = jest.fn().mockReturnValue({ request });
      const http = new EvolutionHttpService(
        makeConfig({
          PROXY_MAX_RETRIES: 3,
          SEND_PROVIDER_TIMEOUT_MS: 86400001,
        }),
      );
      const execution =
        kind === 'text'
          ? new SendRequestContext()
          : new MediaRequestContext(900000, 600000, 240000);
      let finished = false;
      const pending = http
        .requestMedia(
          'https://provider.invalid',
          'fixture',
          '/message/sendMedia/fixture',
          {},
          execution,
        )
        .then((result) => {
          finished = true;
          return result;
        });
      await jest.advanceTimersByTimeAsync(86400000);
      expect(finished).toBe(false);
      expect(execution.signal.aborted).toBe(false);
      expect(() => execution.assertActive()).not.toThrow();
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 0 }),
      );
      expect(jest.getTimerCount()).toBe(1);
      respond({ status: 200, data: { message: 'provider result' } });
      await expect(pending).resolves.toEqual({ message: 'provider result' });
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('dispatches sends even when the legacy circuit is open', async () => {
    const request = jest.fn().mockRejectedValue(new Error('fixture failure'));
    mockedAxios.create = jest.fn().mockReturnValue({ request });
    mockedAxios.isAxiosError.mockReturnValue(false);
    const http = new EvolutionHttpService(
      makeConfig({ CIRCUIT_BREAKER_THRESHOLD: 1 }),
    );
    await expect(
      http.request('get', 'https://provider.invalid', 'fixture', '/test'),
    ).rejects.toThrow();
    expect(http.getCircuitState('https://provider.invalid')).toBe('OPEN');
    request.mockResolvedValue({ status: 200, data: { result: true } });
    await expect(
      http.requestSend(
        'https://provider.invalid',
        'fixture',
        '/chat/sendPresence/fixture',
        {},
      ),
    ).resolves.toEqual({ result: true });
  });

  it('does not manufacture an HTTP timeout for a socket error without provider response', async () => {
    const request = jest
      .fn()
      .mockRejectedValue({ code: 'ETIMEDOUT', isAxiosError: true });
    mockedAxios.create = jest.fn().mockReturnValue({ request });
    mockedAxios.isAxiosError.mockReturnValue(true);
    const http = new EvolutionHttpService(makeConfig());
    await expect(
      http.requestSend(
        'https://provider.invalid',
        'fixture',
        '/message/sendText/fixture',
        {},
      ),
    ).rejects.toMatchObject({
      status: 502,
      message:
        'A conexão com a Evolution foi interrompida ou não pôde ser estabelecida, sem resposta do provider. O resultado da operação não foi confirmado; isso não confirma falha na entrega.',
    });
  });
});

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

describe('EvolutionHttpService — provider error pass-through', () => {
  const VPS_URL = 'http://vps.test:8080';
  const API_KEY = 'test-api-key';

  function makeAxiosResponseError(status: number, data: unknown) {
    const err = Object.assign(
      new Error(`Request failed with status ${status}`),
      {
        isAxiosError: true as const,
        response: { status, data, headers: {}, config: {}, statusText: '' },
        config: {},
        request: {},
        toJSON: () => ({}),
        name: 'AxiosError',
      },
    );
    return err;
  }

  beforeEach(() => {
    (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);
  });

  it('should throw HttpException with provider status and body on 4xx response', async () => {
    const providerBody = {
      status: 403,
      error: 'Forbidden',
      response: { message: ['This name "my-instance" is already in use.'] },
    };
    const mockRequest = jest
      .fn()
      .mockRejectedValue(makeAxiosResponseError(403, providerBody));
    mockedAxios.create = jest.fn().mockReturnValue({ request: mockRequest });

    const svc = new EvolutionHttpService(makeConfig());

    const error = await svc
      .request('post', VPS_URL, API_KEY, '/instance/create', {})
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(403);
    expect((error as HttpException).getResponse()).toEqual(providerBody);
  });

  it('should NOT increment circuit breaker on provider 4xx response', async () => {
    const mockRequest = jest
      .fn()
      .mockRejectedValue(
        makeAxiosResponseError(400, { message: ['Invalid integration'] }),
      );
    mockedAxios.create = jest.fn().mockReturnValue({ request: mockRequest });

    const svc = new EvolutionHttpService(
      makeConfig({ CIRCUIT_BREAKER_THRESHOLD: 2 }),
    );

    for (let i = 0; i < 3; i++) {
      try {
        await svc.request('post', VPS_URL, API_KEY, '/instance/create', {});
      } catch {
        /* ignore */
      }
    }

    expect(svc.getCircuitState(VPS_URL)).toBe('CLOSED');
  });
});
