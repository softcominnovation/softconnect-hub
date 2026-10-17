import {
  MediaRequestContext,
  MediaTimeoutException,
} from './media-request-context';

describe('MediaRequestContext', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reserves return time and deducts preparation from the same deadline', () => {
    const context = new MediaRequestContext(900000, 600000, 240000);
    expect(context.callTimeout(context.downloadTimeoutMs)).toBe(240000);
    jest.advanceTimersByTime(300000);
    expect(context.startProviderCall()).toBe(570000);
    expect(context.calls).toBe(1);
  });

  it('refuses dispatch without a remaining return margin', () => {
    const context = new MediaRequestContext(900000, 600000, 240000);
    jest.advanceTimersByTime(870000);
    expect(() => context.startProviderCall()).toThrow(MediaTimeoutException);
    expect(context.reason).toBe('request_timeout');
    expect(context.providerStarted).toBe(false);
    expect(context.calls).toBe(0);
  });

  it('does not depend on a timer callback to detect an exhausted deadline', () => {
    const context = new MediaRequestContext(900000, 600000, 240000);
    jest.advanceTimersByTime(900001);
    expect(() => context.assertActive()).toThrow('Request timeout');
    expect(context.signal.aborted).toBe(true);
  });

  it('stops work when the consumer leaves before dispatch', () => {
    const context = new MediaRequestContext(900000, 600000, 240000);
    context.disconnect();
    expect(() => context.startProviderCall()).toThrow(MediaTimeoutException);
    expect(context.reason).toBe('client_disconnected');
  });

  it('keeps the original budget after the consumer leaves during dispatch', () => {
    const context = new MediaRequestContext(900000, 600000, 240000);
    context.startProviderCall();
    jest.advanceTimersByTime(120000);
    context.disconnect();
    expect(context.clientDisconnected).toBe(true);
    expect(context.signal.aborted).toBe(false);
    expect(context.remainingMs).toBe(780000);
  });

  it('preserves the first stop reason and the existing timeout envelope', () => {
    const context = new MediaRequestContext(900000, 600000, 240000);
    context.abort('provider_timeout');
    context.abort('request_timeout');
    expect(context.reason).toBe('provider_timeout');
    expect(new MediaTimeoutException(context.reason!).getStatus()).toBe(408);
    expect(
      new MediaTimeoutException(context.reason!).getResponse(),
    ).toMatchObject({
      statusCode: 408,
      message: 'Request timeout',
    });
  });
});
