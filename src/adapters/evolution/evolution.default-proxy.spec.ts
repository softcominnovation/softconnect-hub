import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { QrRequestContext } from '../../common/qr-request-context';
import { AppConfig } from '../../config/config.schema';
import { EvolutionHttpService } from './evolution.http';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
const URL = 'http://fixture.invalid';

describe('Evolution HTTP — optional default proxy', () => {
  let request: jest.Mock<Promise<{ data: unknown }>, [AxiosRequestConfig]>;
  let service: EvolutionHttpService;
  const values: Record<string, number> = {
    PROXY_TIMEOUT_MS: 15000,
    PROXY_MAX_RETRIES: 1,
    CIRCUIT_BREAKER_THRESHOLD: 1,
    CIRCUIT_BREAKER_RESET_MS: 30000,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    request = jest.fn<Promise<{ data: unknown }>, [AxiosRequestConfig]>();
    mockedAxios.create = jest.fn().mockReturnValue({ request });
    mockedAxios.isAxiosError.mockImplementation(
      (error: unknown): error is AxiosError =>
        !!error && typeof error === 'object' && 'isAxiosError' in error,
    );
    service = new EvolutionHttpService({
      get: (key: string) => values[key],
    } as ConfigService<AppConfig, true>);
  });

  afterEach(() => {
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  function call(execution?: QrRequestContext, deadlineAt?: number) {
    return service.trySetDefaultProxy(
      URL,
      'fixture-key',
      'fixture',
      { enabled: true },
      execution,
      deadlineAt,
    );
  }

  function stall() {
    request.mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener?.(
            'abort',
            () => reject(new AxiosError('cancelled', 'ERR_CANCELED')),
            { once: true },
          );
        }),
    );
  }

  it.each([true, false])(
    'cancels only the optional call after exactly 5 seconds (QR=%s)',
    async (qr) => {
      const execution = qr ? new QrRequestContext(90000, 80000) : undefined;
      const remove = execution
        ? jest.spyOn(execution.signal, 'removeEventListener')
        : undefined;
      stall();
      const pending = call(execution, performance.now() + 15000);
      const signal = request.mock.calls[0][0].signal;
      expect(request.mock.calls[0][0].timeout).toBe(5000);
      await jest.advanceTimersByTimeAsync(4999);
      expect(signal?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ proxyFailure: 'timeout' });
      expect(signal?.aborted).toBe(true);
      expect(execution?.signal.aborted ?? false).toBe(false);
      expect(execution?.reason).toBeUndefined();
      expect(request).toHaveBeenCalledTimes(1);
      expect(service.getCircuitState(URL)).toBe('CLOSED');
      if (remove)
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    },
  );

  it('preserves the raw proxy response on success and removes its listener', async () => {
    const execution = new QrRequestContext(90000, 80000);
    const remove = jest.spyOn(execution.signal, 'removeEventListener');
    const raw = {
      proxy: { instanceName: 'fixture', proxy: { enabled: true } },
    };
    request.mockResolvedValue({ data: raw });
    await expect(call(execution)).resolves.toEqual({ proxy: raw });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(execution).toMatchObject({
      calls: 1,
      lastOperation: 'proxy',
      callTimeoutMs: 5000,
    });
  });

  it.each([400, 401, 408, 429, 500, 504])(
    'tolerates upstream HTTP %s without retry or poisoning the QR context',
    async (status) => {
      const execution = new QrRequestContext(90000, 80000);
      request.mockRejectedValue({
        isAxiosError: true,
        response: { status, data: { secret: 'fixture' } },
      });
      await expect(call(execution)).resolves.toEqual({
        proxyFailure: 'upstream_http',
      });
      expect(execution.failureSource).toBeUndefined();
      expect(execution.signal.aborted).toBe(false);
      expect(request).toHaveBeenCalledTimes(1);
      expect(service.getCircuitState(URL)).toBe('CLOSED');
    },
  );

  it.each([true, false])(
    'accepts a successful proxy response just before the deadline (QR=%s)',
    async (qr) => {
      const execution = qr ? new QrRequestContext(90000, 80000) : undefined;
      const raw = { enabled: true, host: 'fixture.invalid', port: '8080' };
      let complete!: (value: { data: unknown }) => void;
      request.mockImplementation(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      const pending = call(execution, performance.now() + 15000);
      const signal = request.mock.calls[0][0].signal;
      await jest.advanceTimersByTimeAsync(4999);
      complete({ data: raw });
      await expect(pending).resolves.toEqual({ proxy: raw });
      await jest.advanceTimersByTimeAsync(10000);
      expect(signal?.aborted).toBe(false);
      expect(execution?.signal.aborted ?? false).toBe(false);
      expect(request).toHaveBeenCalledTimes(1);
      expect(service.getCircuitState(URL)).toBe('CLOSED');
    },
  );

  it.each(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'])(
    'tolerates transport failure %s',
    async (code) => {
      request.mockRejectedValue({ isAxiosError: true, code });
      await expect(call()).resolves.toEqual({
        proxyFailure: code === 'ECONNRESET' ? 'transport_error' : 'timeout',
      });
      expect(request).toHaveBeenCalledTimes(1);
      expect(service.getCircuitState(URL)).toBe('CLOSED');
    },
  );

  it.each([true, false])(
    'uses the remaining budget with a margin (QR=%s)',
    async (qr) => {
      const execution = qr ? new QrRequestContext(90000, 80000) : undefined;
      const deadlineAt = performance.now() + (qr ? 90000 : 15000);
      jest.advanceTimersByTime(qr ? 87500 : 12500);
      stall();
      const pending = call(execution, deadlineAt);
      expect(request.mock.calls[0][0].timeout).toBe(1500);
      await jest.advanceTimersByTimeAsync(1500);
      await expect(pending).resolves.toEqual({ proxyFailure: 'timeout' });
      expect(execution?.signal.aborted ?? false).toBe(false);
    },
  );

  it.each([true, false])(
    'skips the optional call when only the finish margin remains (QR=%s)',
    async (qr) => {
      const execution = qr ? new QrRequestContext(90000, 80000) : undefined;
      const deadlineAt = performance.now() + (qr ? 90000 : 15000);
      jest.advanceTimersByTime(qr ? 89000 : 14000);
      await expect(call(execution, deadlineAt)).resolves.toEqual({
        proxyFailure: 'budget_exhausted',
      });
      expect(request).not.toHaveBeenCalled();
      expect(execution?.signal.aborted ?? false).toBe(false);
    },
  );

  it.each(['request_timeout', 'client_disconnected'] as const)(
    'propagates parent cancellation %s and closes the local call',
    async (reason) => {
      const execution = new QrRequestContext(90000, 80000);
      stall();
      const pending = call(execution).catch((error: unknown) => error);
      execution.abort(reason);
      expect(await pending).toMatchObject({ reason });
      expect(request.mock.calls[0][0].signal?.aborted).toBe(true);
      expect(service.getCircuitState(URL)).toBe('CLOSED');
    },
  );

  it('never sends after a parent cancellation or total expiration', async () => {
    const execution = new QrRequestContext(90000, 80000);
    jest.advanceTimersByTime(90000);
    await expect(call(execution)).rejects.toMatchObject({
      reason: 'request_timeout',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('does not report a late proxy success after the optional timeout', async () => {
    let complete!: (value: { data: unknown }) => void;
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const execution = new QrRequestContext(90000, 80000);
    const pending = call(execution);
    await jest.advanceTimersByTimeAsync(5000);
    complete({ data: { enabled: true } });
    await expect(pending).resolves.toEqual({ proxyFailure: 'timeout' });
    expect(execution.signal.aborted).toBe(false);
  });

  it('respects an open circuit and leaves its state untouched even after a successful optional probe', async () => {
    request.mockRejectedValue(new Error('network fixture'));
    await expect(
      service.request('get', URL, 'fixture-key', '/mandatory'),
    ).rejects.toThrow();
    request.mockClear();
    await expect(call()).resolves.toEqual({ proxyFailure: 'circuit_open' });
    expect(request).not.toHaveBeenCalled();
    jest.advanceTimersByTime(30000);
    request.mockResolvedValue({ data: { enabled: true } });
    await expect(call()).resolves.toEqual({ proxy: { enabled: true } });
    expect(service.getCircuitState(URL)).toBe('OPEN');
  });
});
