import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { QrRequestContext } from '../../common/qr-request-context';
import { AppConfig } from '../../config/config.schema';
import { EvolutionHttpService, OptionalCallBudget } from './evolution.http';

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
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function budget(
    execution?: QrRequestContext,
    deadlineAt?: number,
  ): OptionalCallBudget {
    const created = service.createOptionalBudget(execution, deadlineAt);
    if (!created) throw new Error('fixture budget unavailable');
    return created;
  }

  function post(target: OptionalCallBudget) {
    return service.tryOptionalRequest(
      target,
      'post',
      URL,
      'fixture-key',
      '/proxy/set/fixture',
      { enabled: true },
    );
  }

  function find(target: OptionalCallBudget) {
    return service.tryOptionalRequest(
      target,
      'get',
      URL,
      'fixture-key',
      '/proxy/find/fixture',
    );
  }

  function call(execution?: QrRequestContext, deadlineAt?: number) {
    return post(budget(execution, deadlineAt));
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

  it('has no budget without a finite deadline', () => {
    expect(service.createOptionalBudget()).toBeUndefined();
    expect(service.createOptionalBudget(undefined, Infinity)).toBeUndefined();
  });

  it.each([
    [true, 80000],
    [false, 14000],
  ])(
    'uses the configured per-call limit instead of 5 seconds (QR=%s)',
    async (qr, expected) => {
      const execution = qr ? new QrRequestContext(90000, 80000) : undefined;
      const remove = execution
        ? jest.spyOn(execution.signal, 'removeEventListener')
        : undefined;
      stall();
      const pending = call(execution, performance.now() + 15000);
      const signal = request.mock.calls[0][0].signal;
      expect(request.mock.calls[0][0].timeout).toBe(expected);
      await jest.advanceTimersByTimeAsync(5000);
      expect(signal?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(expected - 5001);
      expect(signal?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ failure: 'timeout' });
      expect(signal?.aborted).toBe(true);
      expect(execution?.signal.aborted ?? false).toBe(false);
      expect(execution?.reason).toBeUndefined();
      expect(request).toHaveBeenCalledTimes(1);
      expect(service.getCircuitState(URL)).toBe('CLOSED');
      if (remove)
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    },
  );

  it('returns the raw response on success and removes its listener', async () => {
    const execution = new QrRequestContext(90000, 80000);
    const remove = jest.spyOn(execution.signal, 'removeEventListener');
    const raw = {
      proxy: { instanceName: 'fixture', proxy: { enabled: true } },
    };
    request.mockResolvedValue({ data: raw });
    await expect(call(execution)).resolves.toEqual({ data: raw });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(execution).toMatchObject({
      calls: 1,
      lastOperation: 'proxy',
      callTimeoutMs: 80000,
    });
  });

  it('sends the body only on POST', async () => {
    request.mockResolvedValue({ data: null });
    const target = budget(undefined, performance.now() + 15000);
    await post(target);
    await find(target);
    expect(request.mock.calls.map(([config]) => config.method)).toEqual([
      'post',
      'get',
    ]);
    expect(request.mock.calls[0][0].data).toEqual({ enabled: true });
    expect(request.mock.calls[1][0].data).toBeUndefined();
  });

  it.each([400, 401, 404, 408, 429, 500, 504])(
    'tolerates upstream HTTP %s without retry or poisoning the QR context',
    async (status) => {
      const execution = new QrRequestContext(90000, 80000);
      request.mockRejectedValue({
        isAxiosError: true,
        response: { status, data: { secret: 'fixture' } },
      });
      await expect(call(execution)).resolves.toEqual({
        failure: 'upstream_http',
        status,
      });
      expect(execution.failureSource).toBeUndefined();
      expect(execution.signal.aborted).toBe(false);
      expect(request).toHaveBeenCalledTimes(1);
      expect(service.getCircuitState(URL)).toBe('CLOSED');
    },
  );

  it.each([
    [true, 80000],
    [false, 14000],
  ])(
    'accepts a successful response just before the call limit (QR=%s)',
    async (qr, limit) => {
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
      await jest.advanceTimersByTimeAsync(limit - 1);
      complete({ data: raw });
      await expect(pending).resolves.toEqual({ data: raw });
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
      const pending = call(undefined, performance.now() + 15000);
      await expect(pending).resolves.toEqual({
        failure: code === 'ECONNRESET' ? 'transport_error' : 'timeout',
      });
      expect(request).toHaveBeenCalledTimes(1);
      expect(service.getCircuitState(URL)).toBe('CLOSED');
    },
  );

  it.each([true, false])(
    'uses the remaining budget with a single margin (QR=%s)',
    async (qr) => {
      const execution = qr ? new QrRequestContext(90000, 80000) : undefined;
      const deadlineAt = performance.now() + (qr ? 90000 : 15000);
      jest.advanceTimersByTime(qr ? 87500 : 12500);
      stall();
      const pending = call(execution, deadlineAt);
      expect(request.mock.calls[0][0].timeout).toBe(1500);
      await jest.advanceTimersByTimeAsync(1500);
      await expect(pending).resolves.toEqual({ failure: 'timeout' });
      expect(execution?.signal.aborted ?? false).toBe(false);
    },
  );

  it('shares one budget across sequential calls without restarting it', async () => {
    const target = budget(undefined, performance.now() + 15000);
    let complete!: (value: { data: unknown }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const first = post(target);
    await jest.advanceTimersByTimeAsync(10000);
    complete({ data: null });
    await first;
    stall();
    const second = find(target);
    expect(request.mock.calls[1][0].timeout).toBe(4000);
    await jest.advanceTimersByTimeAsync(4000);
    await expect(second).resolves.toEqual({ failure: 'timeout' });
    await expect(find(target)).resolves.toEqual({
      failure: 'budget_exhausted',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])(
    'skips the optional call when only the finish margin remains (QR=%s)',
    async (qr) => {
      const execution = qr ? new QrRequestContext(90000, 80000) : undefined;
      const deadlineAt = performance.now() + (qr ? 90000 : 15000);
      jest.advanceTimersByTime(qr ? 89000 : 14000);
      await expect(call(execution, deadlineAt)).resolves.toEqual({
        failure: 'budget_exhausted',
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
    const target = budget(execution);
    jest.advanceTimersByTime(90000);
    await expect(post(target)).rejects.toMatchObject({
      reason: 'request_timeout',
    });
    let error: unknown;
    try {
      service.createOptionalBudget(execution);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ reason: 'request_timeout' });
    expect(request).not.toHaveBeenCalled();
  });

  it('does not report a late success after the optional timeout', async () => {
    let complete!: (value: { data: unknown }) => void;
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const execution = new QrRequestContext(90000, 80000);
    const pending = call(execution);
    await jest.advanceTimersByTimeAsync(80000);
    complete({ data: { enabled: true } });
    await expect(pending).resolves.toEqual({ failure: 'timeout' });
    expect(execution.signal.aborted).toBe(false);
  });

  it.each([
    [false, 13999, true],
    [false, 14000, false],
    [false, 14001, false],
    [true, 13999, true],
    [true, 14000, false],
    [true, 14001, false],
  ] as const)(
    'checks elapsed time even before the timer runs (QR=%s, elapsed=%s)',
    async (qr, elapsed, accepted) => {
      let now = 0;
      jest.spyOn(performance, 'now').mockImplementation(() => now);
      const execution = qr ? new QrRequestContext(15000, 15000) : undefined;
      const target = budget(execution, 15000);
      const raw = { enabled: true };
      request.mockImplementation(() => {
        now = elapsed;
        return Promise.resolve({ data: raw });
      });
      await expect(find(target)).resolves.toEqual(
        accepted ? { data: raw } : { failure: 'timeout' },
      );
      expect(execution?.signal.aborted ?? false).toBe(false);
      expect(request.mock.calls[0][0].signal?.aborted).toBe(false);
    },
  );

  it('checks the per-call deadline independently of the total deadline', async () => {
    let now = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => now);
    const execution = new QrRequestContext(90000, 80000);
    const target = budget(execution);
    request.mockImplementation(() => {
      now = 80000;
      return Promise.resolve({ data: { enabled: true } });
    });
    await expect(post(target)).resolves.toEqual({ failure: 'timeout' });
    expect(execution.signal.aborted).toBe(false);
    expect(execution.remainingMs).toBe(10000);
  });

  it('keeps the original deadline after a 25-second set call', async () => {
    const execution = new QrRequestContext(90000, 80000);
    jest.advanceTimersByTime(20000);
    const target = budget(execution);
    let complete!: (value: { data: unknown }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = post(target);
    expect(request.mock.calls[0][0].timeout).toBe(69000);
    await jest.advanceTimersByTimeAsync(25000);
    complete({ data: null });
    await expect(pending).resolves.toEqual({ data: null });
    request.mockResolvedValue({ data: { enabled: true } });
    await expect(find(target)).resolves.toEqual({ data: { enabled: true } });
    expect(request.mock.calls[1][0].timeout).toBe(44000);
  });

  it('respects an open circuit and leaves its state untouched even after a successful optional probe', async () => {
    request.mockRejectedValue(new Error('network fixture'));
    await expect(
      service.request('get', URL, 'fixture-key', '/mandatory'),
    ).rejects.toThrow();
    request.mockClear();
    const deadlineAt = () => performance.now() + 15000;
    await expect(call(undefined, deadlineAt())).resolves.toEqual({
      failure: 'circuit_open',
    });
    expect(request).not.toHaveBeenCalled();
    jest.advanceTimersByTime(30000);
    request.mockResolvedValue({ data: { enabled: true } });
    await expect(call(undefined, deadlineAt())).resolves.toEqual({
      data: { enabled: true },
    });
    expect(service.getCircuitState(URL)).toBe('OPEN');
  });

  describe('waitOptional', () => {
    it('rejects a pause that finishes after its deadline due to event loop delay', async () => {
      let now = 0;
      jest.spyOn(performance, 'now').mockImplementation(() => now);
      const pending = service.waitOptional(budget(undefined, 15000), 100);
      now = 14000;
      await jest.advanceTimersByTimeAsync(100);
      await expect(pending).resolves.toBe(false);
    });

    it('waits inside the budget and refuses a pause that does not fit', async () => {
      const target = budget(undefined, performance.now() + 1350);
      const first = service.waitOptional(target, 100);
      await jest.advanceTimersByTimeAsync(100);
      await expect(first).resolves.toBe(true);
      await expect(service.waitOptional(target, 250)).resolves.toBe(false);
    });

    it('stops a pause on parent cancellation', async () => {
      const execution = new QrRequestContext(90000, 80000);
      const pending = service
        .waitOptional(budget(execution), 250)
        .catch((error: unknown) => error);
      execution.abort('client_disconnected');
      expect(await pending).toMatchObject({ reason: 'client_disconnected' });
    });
  });
});
