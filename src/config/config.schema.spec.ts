import { configSchema } from './config.schema';

const environment = {
  DATABASE_URL: 'postgresql://fixture.invalid/test',
  REDIS_URL: 'redis://fixture.invalid',
  ENCRYPTION_KEY: 'a'.repeat(64),
  JWT_SECRET: 'fixture-jwt-secret',
  ADMIN_SECRET: 'fixture-admin-secret',
};

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
