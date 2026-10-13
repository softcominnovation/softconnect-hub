import { QrRequestContext, QrTimeoutException } from './qr-request-context';

describe('QrRequestContext', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('deducts local work and retains one deadline across calls', () => {
    const context = new QrRequestContext(60000, 50000);
    jest.advanceTimersByTime(12000);
    expect(context.callTimeout(50000)).toBe(47000);
    expect(context.callTimeout(15000)).toBe(15000);
    jest.advanceTimersByTime(40000);
    expect(context.callTimeout(15000)).toBe(7000);
  });

  it('does not send when only the finalization margin remains', () => {
    const context = new QrRequestContext(60000, 50000);
    jest.advanceTimersByTime(59000);
    expect(() => context.callTimeout(50000)).toThrow(QrTimeoutException);
    expect(context.signal.aborted).toBe(true);
    expect(context.reason).toBe('request_timeout');
  });

  it('keeps the first reason and isolates concurrent requests', () => {
    const first = new QrRequestContext(60000, 50000);
    const second = new QrRequestContext(60000, 50000);
    first.abort('client_disconnected');
    first.abort('provider_timeout');
    expect(first.reason).toBe('client_disconnected');
    expect(() => first.assertActive()).toThrow(QrTimeoutException);
    expect(second.signal.aborted).toBe(false);
    expect(() => second.assertActive()).not.toThrow();
  });
});
