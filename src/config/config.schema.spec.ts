import { configSchema } from './config.schema';

const environment = {
  DATABASE_URL: 'postgresql://fixture.invalid/test',
  REDIS_URL: 'redis://fixture.invalid',
  ENCRYPTION_KEY: 'a'.repeat(64),
  JWT_SECRET: 'fixture-jwt-secret',
  ADMIN_SECRET: 'fixture-admin-secret',
};

describe('Media timeout configuration', () => {
  it('adds independent finite defaults without changing legacy or QR limits', () => {
    expect(configSchema.parse(environment)).toMatchObject({
      MEDIA_REQUEST_TIMEOUT_MS: 900000,
      MEDIA_PROVIDER_TIMEOUT_MS: 600000,
      MEDIA_DOWNLOAD_TIMEOUT_MS: 240000,
      PROXY_TIMEOUT_MS: 15000,
      QR_REQUEST_TIMEOUT_MS: 60000,
      QR_PROVIDER_TIMEOUT_MS: 50000,
    });
  });

  describe.each([
    'MEDIA_REQUEST_TIMEOUT_MS',
    'MEDIA_PROVIDER_TIMEOUT_MS',
    'MEDIA_DOWNLOAD_TIMEOUT_MS',
  ])('%s', (key) => {
    it.each([0, -1, Infinity, NaN, 1.5, 2147483648, '', 'invalid'])(
      'rejects an unsafe or unbounded value: %s',
      (value) => {
        expect(
          configSchema.safeParse({ ...environment, [key]: value }).success,
        ).toBe(false);
      },
    );
  });

  it('parses Compose strings and requires the full finish margin', () => {
    const values = {
      ...environment,
      MEDIA_REQUEST_TIMEOUT_MS: '330000',
      MEDIA_DOWNLOAD_TIMEOUT_MS: '60000',
      MEDIA_PROVIDER_TIMEOUT_MS: '240000',
    };
    expect(configSchema.parse(values)).toMatchObject({
      MEDIA_REQUEST_TIMEOUT_MS: 330000,
      MEDIA_DOWNLOAD_TIMEOUT_MS: 60000,
      MEDIA_PROVIDER_TIMEOUT_MS: 240000,
    });
    expect(
      configSchema.safeParse({ ...values, MEDIA_REQUEST_TIMEOUT_MS: 329999 })
        .success,
    ).toBe(false);
  });
});

describe('QR timeout configuration', () => {
  it('adds finite QR defaults without changing the legacy policy', () => {
    expect(configSchema.parse(environment)).toMatchObject({
      QR_REQUEST_TIMEOUT_MS: 60000,
      QR_PROVIDER_TIMEOUT_MS: 50000,
      PROXY_TIMEOUT_MS: 15000,
      PROXY_MAX_RETRIES: 1,
    });
  });

  it.each([0, -1, Infinity, NaN, 1.5])(
    'rejects provider timeout %s',
    (value) => {
      expect(
        configSchema.safeParse({
          ...environment,
          QR_PROVIDER_TIMEOUT_MS: value,
        }).success,
      ).toBe(false);
    },
  );

  it.each([0, -1, 1000, Infinity, NaN, 1.5, 2147483648])(
    'rejects request timeout %s',
    (value) => {
      expect(
        configSchema.safeParse({ ...environment, QR_REQUEST_TIMEOUT_MS: value })
          .success,
      ).toBe(false);
    },
  );

  it('requires the finish margin and accepts coordinated rollback values', () => {
    expect(
      configSchema.safeParse({
        ...environment,
        QR_REQUEST_TIMEOUT_MS: 15000,
        QR_PROVIDER_TIMEOUT_MS: 15000,
      }).success,
    ).toBe(false);
    expect(
      configSchema.parse({
        ...environment,
        QR_REQUEST_TIMEOUT_MS: '15000',
        QR_PROVIDER_TIMEOUT_MS: '14000',
      }),
    ).toMatchObject({
      QR_REQUEST_TIMEOUT_MS: 15000,
      QR_PROVIDER_TIMEOUT_MS: 14000,
    });
  });
});
