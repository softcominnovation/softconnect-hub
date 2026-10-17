import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { AppConfig } from '../../config/config.schema';
import { MediaRequestContext } from '../../common/media-request-context';
import { EvolutionHttpService } from './evolution.http';

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

  it.each([60000, 120000])(
    'waits %i ms for the real response with a per-call budget',
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
          timeout: 600000,
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

  it('enforces an absolute deadline even if the transport never reports inactivity', async () => {
    const execution = context();
    request.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          execution.signal.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          );
        }),
    );
    const result = call(execution).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(600000);
    expect(await result).toMatchObject({ reason: 'provider_timeout' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(service.getCircuitState(providerUrl)).toBe('OPEN');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('uses the remaining total after previous preparation and does not penalize that deadline', async () => {
    const execution = context();
    jest.advanceTimersByTime(300000);
    request.mockRejectedValue({ isAxiosError: true, code: 'ETIMEDOUT' });
    await expect(call(execution)).rejects.toMatchObject({
      reason: 'request_timeout',
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 570000 }),
    );
    expect(service.getCircuitState(providerUrl)).toBe('CLOSED');
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

  it('preserves transport errors and cleans its timer', async () => {
    const error = new Error('fixture connection reset');
    request.mockRejectedValue(error);
    const execution = context();
    await expect(call(execution)).rejects.toBe(error);
    expect(execution.failureSource).toBe('transport_error');
    expect(request).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not dispatch through an open circuit', async () => {
    request.mockRejectedValue(new Error('fixture connection reset'));
    await call(context()).catch(() => undefined);
    const execution = context();
    await expect(call(execution)).rejects.toMatchObject({ status: 503 });
    expect(execution.failureSource).toBe('circuit_open');
    expect(execution.calls).toBe(0);
  });
});
