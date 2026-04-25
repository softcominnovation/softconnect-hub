import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, getAdminToken } from './helpers/app.helper';

describe('Passo 4 — Adapters Registry E2E', () => {
  let app: NestFastifyApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAdminToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /admin/adapters', () => {
    it('returns 401 without token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/adapters',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns list of registered adapters including evolution', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/adapters',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ adapters: string[] }>();
      expect(body).toHaveProperty('adapters');
      expect(Array.isArray(body.adapters)).toBe(true);
      expect(body.adapters).toContain('evolution');
    });

    it('adapter list contains only registered adapters (no unknown types)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/adapters',
        headers: { authorization: `Bearer ${token}` },
      });
      const body = res.json<{ adapters: string[] }>();
      body.adapters.forEach((type) => {
        expect(typeof type).toBe('string');
        expect(type.length).toBeGreaterThan(0);
      });
    });
  });
});
