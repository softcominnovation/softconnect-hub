import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './helpers/app.helper';

describe('Admin Auth (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /admin/auth/login', () => {
    it('retorna JWT com secret correto', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/auth/login',
        payload: {
          secret: process.env.ADMIN_SECRET ?? 'minha-senha-admin-dev',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ access_token: string }>();
      expect(body.access_token).toBeDefined();
      expect(typeof body.access_token).toBe('string');
      expect(body.access_token.split('.')).toHaveLength(3);
    });

    it('retorna 401 com secret errado', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/auth/login',
        payload: { secret: 'senha-completamente-errada' },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json<{ message: string }>();
      expect(body.message).toBe('Credenciais inválidas');
    });

    it('retorna 401 sem body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/auth/login',
        payload: {},
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
