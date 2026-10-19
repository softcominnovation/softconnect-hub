import { ConfigService } from '@nestjs/config';
import * as dns from 'node:dns/promises';
import {
  isAllowedMediaAddress,
  MediaSourcePolicy,
} from './media-source-policy';
import { mediaAllowedOrigins } from './media-limits';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
const lookupMock = dns.lookup as unknown as jest.Mock<
  Promise<Array<{ address: string; family: number }>>
>;

describe('Media source access policy', () => {
  afterEach(() => lookupMock.mockReset());

  it.each([
    '127.0.0.1',
    '0.0.0.0',
    '169.254.169.254',
    '100.100.100.200',
    '168.63.129.16',
    '192.0.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fd00:ec2::254',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '2002:7f00:1::',
    '64:ff9b::7f00:1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    'invalid',
  ])('always blocks %s, even with a private-origin exception', (address) => {
    expect(isAllowedMediaAddress(address, true)).toBe(false);
  });

  it.each(['10.0.0.1', '172.16.0.1', '192.168.1.1', 'fd00::1', '::ffff:a00:1'])(
    'requires an explicit origin for private address %s',
    (address) => {
      expect(isAllowedMediaAddress(address, false)).toBe(false);
      expect(isAllowedMediaAddress(address, true)).toBe(true);
    },
  );

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:808:808'])(
    'accepts a global address %s',
    (address) => expect(isAllowedMediaAddress(address, false)).toBe(true),
  );

  it('pins the result and rejects mixed public/private DNS answers', async () => {
    const resolve = lookupMock.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    const policy = new MediaSourcePolicy(new ConfigService());
    await expect(
      policy.resolve('https://files.fixture/a', new AbortController().signal),
    ).rejects.toMatchObject({ status: 400 });
    resolve.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    await expect(
      policy.resolve('https://files.fixture/a', new AbortController().signal),
    ).resolves.toMatchObject({ address: '8.8.8.8', family: 4 });
  });

  it('requires an exact origin including scheme and port, without releasing loopback', async () => {
    lookupMock.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
    const policy = new MediaSourcePolicy(
      new ConfigService({
        MEDIA_SOURCE_ALLOWED_HOSTS: 'https://files.fixture:8443',
      }),
    );
    const signal = new AbortController().signal;
    await expect(
      policy.resolve('https://files.fixture:8443/a', signal),
    ).resolves.toMatchObject({ address: '10.1.2.3' });
    await expect(
      policy.resolve('https://files.fixture/a', signal),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      policy.resolve('http://files.fixture:8443/a', signal),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      policy.resolve('https://user:secret@files.fixture:8443/a', signal),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      policy.resolve('file:///etc/passwd', signal),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      policy.resolve('http://2130706433/a', signal),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('interrupts a DNS wait without starting a connection', async () => {
    lookupMock.mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const promise = new MediaSourcePolicy(new ConfigService()).resolve(
      'https://files.fixture/a',
      controller.signal,
    );
    controller.abort();
    await expect(promise).rejects.toThrow('interrupted');
  });

  it.each([
    '*',
    '*.fixture',
    'https://host/path',
    'https://u:p@host',
    'https://host?token=x',
    'https://host#x',
    'ftp://host',
    'https://host,',
  ])('rejects a broad or malformed exception %s', (value) => {
    expect(() => mediaAllowedOrigins(value)).toThrow();
  });
});
