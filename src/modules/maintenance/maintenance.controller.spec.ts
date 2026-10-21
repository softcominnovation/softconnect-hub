import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';
import { signJwt } from '../../common/crypto.util';

describe('Maintenance Admin HTTP contract', () => {
  let app: NestFastifyApplication;
  const service = {
    get: jest.fn().mockResolvedValue({ policy: { enabled: false } }),
    update: jest.fn().mockResolvedValue({ revision: 1 }),
    page: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  };
  const secret = 'synthetic-maintenance-test-secret';
  const headers = {
    authorization: `Bearer ${signJwt({ sub: 'test-admin' }, secret, 3600)}`,
  };
  const url = '/api/v1/admin/evolutions/provider/maintenance';
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MaintenanceController],
      providers: [
        { provide: MaintenanceService, useValue: service },
        {
          provide: ConfigService,
          useValue: new ConfigService({ JWT_SECRET: secret }),
        },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(() => app.close());
  it('requires the existing admin JWT', async () => {
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
  });
  it('reads without executing remote operations', async () => {
    const response = await app.inject({ method: 'GET', url, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ policy: { enabled: false } });
  });
  it('strictly rejects unknown fields and unsafe action values', async () => {
    expect(
      (
        await app.inject({
          method: 'PUT',
          url,
          headers,
          payload: { enabled: true, action: 'delete_all' },
        })
      ).statusCode,
    ).toBe(400);
    expect(service.update).not.toHaveBeenCalled();
  });
  it('preserves the complete policy contract and authenticated actor', async () => {
    const payload = {
      expectedRevision: 0,
      expectedProviderRevision: 0,
      expectedScopeFingerprint: 'a'.repeat(64),
      enabled: true,
      mode: 'observe',
      action: 'disconnect',
      connectingMaxAgeMinutes: null,
      confirmation: { action: 'disconnect', acknowledgeSharedScope: true },
    };
    const response = await app.inject({ method: 'PUT', url, headers, payload });
    expect(response.statusCode).toBe(200);
    expect(service.update).toHaveBeenCalledWith(
      'provider',
      payload,
      'test-admin',
    );
  });
  it('bounds pagination and keeps the response envelope', async () => {
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `${url}/actions?limit=101`,
          headers,
        })
      ).statusCode,
    ).toBe(400);
    const response = await app.inject({
      method: 'GET',
      url: `${url}/observations`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], nextCursor: null });
    expect(service.page).toHaveBeenCalledWith('provider', 'observations', {
      limit: 25,
    });
  });
});
