import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { AppConfig } from '../../config/config.schema';
import {
  QrRequestContext,
  QrTimeoutException,
  QrOperation,
} from '../../common/qr-request-context';
import { EvolutionHttpService } from './evolution.http';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
const URL = 'http://provider.invalid';

describe('Evolution HTTP — QR policy', () => {
  let request: jest.Mock<Promise<{ data: unknown }>, [AxiosRequestConfig]>;
  let service: EvolutionHttpService;
  const values: Record<string, number> = {
    PROXY_TIMEOUT_MS: 15000,
    PROXY_MAX_RETRIES: 1,
    CIRCUIT_BREAKER_THRESHOLD: 1,
    CIRCUIT_BREAKER_RESET_MS: 30000,
  };
  const config = { get: (key: string) => values[key] } as ConfigService<
    AppConfig,
    true
  >;

  beforeEach(() => {
    jest.useFakeTimers();
    request = jest.fn<Promise<{ data: unknown }>, [AxiosRequestConfig]>();
    mockedAxios.create = jest.fn().mockReturnValue({ request });
    mockedAxios.isAxiosError.mockImplementation(
      (error: unknown): error is AxiosError =>
        !!error && typeof error === 'object' && 'isAxiosError' in error,
    );
    service = new EvolutionHttpService(config);
  });
  afterEach(() => jest.useRealTimers());

  function call(
    execution?: QrRequestContext,
    operation: QrOperation = 'connect',
  ) {
    return service.request(
      'get',
      URL,
      'fixture-key',
      '/instance/connect/test',
      undefined,
      undefined,
      execution ? { execution, operation } : undefined,
    );
  }

  it('passes a request-specific finite timeout/signal, without modifying the shared defaults', async () => {
    request.mockResolvedValue({ data: { base64: 'fixture' } });
    const execution = new QrRequestContext(60000, 50000);
    await expect(call(execution)).resolves.toEqual({ base64: 'fixture' });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 50000, signal: execution.signal }),
    );
    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 15000 }),
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['lookup', 'webhook', 'proxy', 'delete'] as const)(
    'lets %s finish after 20 seconds and deducts the elapsed budget',
    async (operation) => {
      request.mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ data: [] }), 20000),
          ),
      );
      const execution = new QrRequestContext(90000, 80000);
      const pending = call(execution, operation);
      await jest.advanceTimersByTimeAsync(20000);
      await expect(pending).resolves.toEqual([]);
      expect(request).toHaveBeenLastCalledWith(
        expect.objectContaining({ timeout: 80000, signal: execution.signal }),
      );
      expect(execution.lastOperation).toBe(operation);
      expect(execution.callTimeoutMs).toBe(80000);
      expect(execution.signal.aborted).toBe(false);

      request.mockResolvedValue({ data: [] });
      await call(execution, operation);
      expect(request).toHaveBeenLastCalledWith(
        expect.objectContaining({ timeout: 69000 }),
      );
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('cancels a stalled auxiliary at the remaining total budget without retry', async () => {
    const execution = new QrRequestContext(90000, 80000);
    jest.advanceTimersByTime(82000);
    request.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          execution.signal.addEventListener(
            'abort',
            () => reject(new AxiosError('cancelled', 'ERR_CANCELED')),
            { once: true },
          );
        }),
    );
    const pending = call(execution, 'proxy').catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(7000);
    expect(await pending).toMatchObject({ reason: 'request_timeout' });
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeout: 7000 }),
    );
    expect(execution.lastOperation).toBe('proxy');
    expect(execution.callTimeoutMs).toBe(7000);
    await expect(call(execution, 'delete')).rejects.toBeInstanceOf(
      QrTimeoutException,
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(service.getCircuitState(URL)).toBe('CLOSED');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not retry a transport timeout and counts only one circuit failure', async () => {
    request.mockRejectedValue({ isAxiosError: true, code: 'ECONNABORTED' });
    const execution = new QrRequestContext(60000, 50000);
    await expect(call(execution)).rejects.toMatchObject({
      reason: 'provider_timeout',
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(execution.signal.aborted).toBe(true);
    expect(service.getCircuitState(URL)).toBe('OPEN');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('retains retries for a request without QR context', async () => {
    request
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: 'ok' });
    await expect(call()).resolves.toBe('ok');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).not.toHaveProperty('signal');
    expect(request.mock.calls[0][0]).not.toHaveProperty('timeout');
  });

  it.each(['client_disconnected', 'request_timeout'] as const)(
    'does not penalize cancellation: %s',
    async (reason) => {
      const execution = new QrRequestContext(60000, 50000);
      request.mockImplementation(() => {
        execution.abort(reason);
        return Promise.reject(new AxiosError('cancelled', 'ERR_CANCELED'));
      });
      await expect(call(execution)).rejects.toMatchObject({ reason });
      expect(service.getCircuitState(URL)).toBe('CLOSED');
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it('does not send when the budget was consumed before upstream', async () => {
    const execution = new QrRequestContext(60000, 50000);
    jest.advanceTimersByTime(59001);
    await expect(call(execution)).rejects.toBeInstanceOf(QrTimeoutException);
    expect(request).not.toHaveBeenCalled();
    expect(service.getCircuitState(URL)).toBe('CLOSED');
  });

  it('ignores late success after cancellation instead of resetting a circuit', async () => {
    const execution = new QrRequestContext(60000, 50000);
    let complete!: (value: { data: string }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = call(execution);
    execution.abort('client_disconnected');
    request.mockRejectedValue(new Error('network'));
    await expect(call()).rejects.toThrow('network');
    expect(service.getCircuitState(URL)).toBe('OPEN');
    complete({ data: 'late' });
    await expect(pending).rejects.toBeInstanceOf(QrTimeoutException);
    expect(service.getCircuitState(URL)).toBe('OPEN');
  });

  it.each([400, 408, 504])(
    'preserves upstream HTTP %s rather than relabeling it as local timeout',
    async (status) => {
      const body = { message: 'upstream fixture' };
      const error = { isAxiosError: true, response: { status, data: body } };
      request.mockRejectedValue(error);
      try {
        await call(new QrRequestContext(60000, 50000));
        throw new Error('Expected upstream exception');
      } catch (caught) {
        expect(caught).toBeInstanceOf(HttpException);
        expect((caught as HttpException).getStatus()).toBe(status);
        expect((caught as HttpException).getResponse()).toBe(body);
      }
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
});
