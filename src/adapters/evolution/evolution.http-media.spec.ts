import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { AppConfig } from '../../config/config.schema';
import { MediaRequestContext } from '../../common/media-request-context';
import { EvolutionHttpService } from './evolution.http';
import { SEND_SAFETY_TIMEOUT_MESSAGE } from '../../common/send-safety-timeout';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
const providerUrl = 'http://media-provider.invalid';
const payload = { media: 'fixture-media', mediatype: 'video' };

describe('Evolution HTTP — media waiting policy', () => {
  let request: jest.Mock<
    Promise<{ data: unknown; status: number }>,
    [AxiosRequestConfig]
  >;
  let service: EvolutionHttpService;

  beforeEach(() => {
    jest.useFakeTimers();
    request = jest.fn<
      Promise<{ data: unknown; status: number }>,
      [AxiosRequestConfig]
    >();
    mockedAxios.create.mockReturnValue({ request } as unknown as ReturnType<
      typeof axios.create
    >);
    mockedAxios.isAxiosError.mockImplementation(
      (error: unknown): error is AxiosError =>
        !!error && typeof error === 'object' && 'isAxiosError' in error,
    );
    service = new EvolutionHttpService({
      get: (key: string) =>
        ({
          PROXY_TIMEOUT_MS: 15000,
          PROXY_MAX_RETRIES: 1,
          CIRCUIT_BREAKER_THRESHOLD: 1,
          CIRCUIT_BREAKER_RESET_MS: 30000,
        })[key],
    } as ConfigService<AppConfig, true>);
  });

  afterEach(() => jest.useRealTimers());

  const context = () => new MediaRequestContext(900000, 600000, 240000);
  const call = (execution: MediaRequestContext) =>
    service.requestMedia(
      providerUrl,
      'fixture-key',
      '/message/sendMedia/fixture',
      payload,
      execution,
    );

  it.each([60000, 120000, 599999])(
    'waits %i ms for the real response inside the safety deadline',
    async (delay) => {
      request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () => resolve({ data: { status: 'PENDING' }, status: 201 }),
              delay,
            );
          }),
      );
      const execution = context();
      const result = call(execution);
      await jest.advanceTimersByTimeAsync(delay);
      await expect(result).resolves.toEqual({ status: 'PENDING' });
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 0,
          signal: execution.signal,
          data: payload,
        }),
      );
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 15000 }),
      );
      expect(execution.upstreamStatusCode).toBe(201);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('aborts a response-less request at ten minutes without retry', async () => {
    const execution = context();
    request.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          execution.signal.addEventListener(
            'abort',
            () => reject(new Error('canceled')),
            { once: true },
          );
        }),
    );
    const result = call(execution).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(599999);
    expect(execution.signal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(execution.signal.aborted).toBe(true);
    expect(await result).toMatchObject({
      status: 504,
      message: SEND_SAFETY_TIMEOUT_MESSAGE,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(service.getCircuitState(providerUrl)).toBe('CLOSED');
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([200, 408])(
    'prioritizes an obtained HTTP %i response over a racing safety timer',
    async (status) => {
      const execution = context();
      const body = {
        statusCode: status,
        message: 'real provider response',
        extra: true,
      };
      request.mockImplementation(() => {
        execution.abort('safety_timeout');
        if (status >= 400)
          return Promise.reject(
            Object.assign(new Error('provider response'), {
              isAxiosError: true,
              response: { status, data: body },
            }),
          );
        return Promise.resolve({ status, data: body });
      });
      if (status === 200) await expect(call(execution)).resolves.toEqual(body);
      else {
        const error = (await call(execution).catch(
          (error: unknown) => error,
        )) as HttpException;
        expect(error.getStatus()).toBe(status);
        expect(error.getResponse()).toEqual(body);
      }
      expect(execution.reason).toBeUndefined();
      expect(execution.upstreamStatusCode).toBe(status);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('does not turn a socket timeout into a provider HTTP timeout after preparation', async () => {
    const execution = context();
    jest.advanceTimersByTime(300000);
    request.mockRejectedValue({ isAxiosError: true, code: 'ETIMEDOUT' });
    await expect(call(execution)).rejects.toMatchObject({
      status: 502,
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 0 }),
    );
    expect(service.getCircuitState(providerUrl)).toBe('OPEN');
  });

  it('returns the received upstream error without replacing its body', async () => {
    const body = { message: ['fixture rejected'], error: 'fixture-error' };
    request.mockRejectedValue({
      isAxiosError: true,
      response: { status: 422, data: body },
    });
    const execution = context();
    const error = (await call(execution).catch(
      (error: unknown) => error,
    )) as HttpException;
    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toEqual(body);
    expect(execution.failureSource).toBe('upstream_http');
    expect(execution.upstreamStatusCode).toBe(422);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not start after the client leaves before dispatch', async () => {
    const execution = context();
    execution.disconnect();
    await expect(call(execution)).rejects.toMatchObject({
      reason: 'client_disconnected',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('continues observing the original provider response after client disconnect', async () => {
    const execution = context();
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ data: { key: { id: 'fixture-id' } }, status: 201 }),
            120000,
          );
        }),
    );
    const result = call(execution);
    await jest.advanceTimersByTimeAsync(10000);
    execution.disconnect();
    expect(execution.signal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(110000);
    await expect(result).resolves.toEqual({ key: { id: 'fixture-id' } });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('explains transport failures without claiming an upstream HTTP response', async () => {
    const error = new Error('fixture connection reset');
    request.mockRejectedValue(error);
    const execution = context();
    await expect(call(execution)).rejects.toMatchObject({ status: 502 });
    expect(execution.failureSource).toBe('transport_error');
    expect(request).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('dispatches sends through an open legacy circuit and reports the actual connection failure', async () => {
    request.mockRejectedValue(new Error('fixture connection reset'));
    await call(context()).catch(() => undefined);
    const execution = context();
    await expect(call(execution)).rejects.toMatchObject({ status: 502 });
    expect(execution.failureSource).toBe('transport_error');
    expect(execution.calls).toBe(1);
  });
});
