import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { JwtGuard } from '../../../auth/jwt.guard';
import { ProvisioningResolutionService } from '../../provisioning/provisioning-resolution.service';
import { ProvisioningResolutionController } from './provisioning-resolution.controller';

describe('Provisioning administrative HTTP contract', () => {
  let app: NestFastifyApplication;
  const service = { list: jest.fn(), resolve: jest.fn() };
  const prefix =
    '/admin/evolutions/11111111-1111-4111-8111-111111111111/provisioning';
  const url = prefix + '/22222222-2222-4222-8222-222222222222/resolve';
  const headers = { authorization: 'Bearer fixture-admin' };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProvisioningResolutionController],
      providers: [
        { provide: ProvisioningResolutionService, useValue: service },
      ],
    })
      .overrideGuard(JwtGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const request = context.switchToHttp().getRequest<{
            headers: Record<string, string>;
            admin?: { sub: string };
          }>();
          if (request.headers.authorization !== headers.authorization)
            throw new UnauthorizedException();
          request.admin = { sub: 'fixture-admin' };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    service.list.mockResolvedValue({ items: [], nextCursor: null });
    service.resolve.mockResolvedValue({ state: 'released', revision: 4 });
  });
  afterAll(() => app.close());
  it('requires administrative authentication; product key alone does not pass the guard', async () => {
    expect(
      (
        await app.inject({
          method: 'GET',
          url: prefix,
          headers: { apiKey: 'product-key' },
        })
      ).statusCode,
    ).toBe(401);
    expect(service.list).not.toHaveBeenCalled();
  });
  it('validates pagination and defaults', async () => {
    expect(
      (await app.inject({ method: 'GET', url: prefix, headers })).statusCode,
    ).toBe(200);
    expect(service.list).toHaveBeenCalledWith(expect.any(String), {
      state: 'open',
      limit: 20,
    });
    for (const query of [
      'limit=101',
      'limit=0',
      'cursor=bad',
      'state=bad',
      'unknown=true',
    ])
      expect(
        (
          await app.inject({
            method: 'GET',
            url: prefix + '?' + query,
            headers,
          })
        ).statusCode,
      ).toBe(400);
  });
  it('requires explicit acknowledgement for release and rejects unexpected fields', async () => {
    for (const payload of [
      { action: 'release_absent', expectedRevision: 1, reason: 'inspect' },
      { action: 'reconcile', expectedRevision: -1, reason: 'inspect' },
      { action: 'reconcile', expectedRevision: 1, reason: '' },
      {
        action: 'reconcile',
        expectedRevision: 1,
        reason: 'inspect',
        force: true,
      },
    ])
      expect(
        (await app.inject({ method: 'POST', url, headers, payload }))
          .statusCode,
      ).toBe(400);
    expect(service.resolve).not.toHaveBeenCalled();
  });
  it('passes the authenticated actor and returns the resulting state, without a new public create contract', async () => {
    const payload = {
      action: 'release_absent',
      expectedRevision: 3,
      reason: 'checked absent',
      acknowledgeUncertainOutcome: true,
      confirmExecutorsDrained: true,
    };
    const result = await app.inject({ method: 'POST', url, headers, payload });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ state: 'released', revision: 4 });
    expect(service.resolve).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      payload,
      'fixture-admin',
    );
  });
});
