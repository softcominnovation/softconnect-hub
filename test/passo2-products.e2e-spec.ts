import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, getAdminToken } from './helpers/app.helper';

describe('Admin Products (e2e)', () => {
  let app: NestFastifyApplication;
  let token: string;
  let createdProductId: string;
  let createdApiKey: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAdminToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /admin/products', () => {
    it('cria produto e retorna apiKey raw (única exibição)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/products',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: 'E2E Produto Teste',
          slug: `e2e-produto-${Date.now()}`,
          adapterType: 'evolution',
          origins: ['n8n', 'frontend'],
          hubRelay: false,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<{
        id: string;
        apiKey: string;
        apiKeyHash?: string;
        isActive: boolean;
        adapterType: string;
      }>();

      expect(body.id).toBeDefined();
      expect(body.apiKey).toBeDefined();
      expect(body.apiKey).toHaveLength(64);
      expect(body.apiKeyHash).toBeUndefined();
      expect(body.isActive).toBe(true);
      expect(body.adapterType).toBe('evolution');

      createdProductId = body.id;
      createdApiKey = body.apiKey;
    });

    it('retorna 401 sem JWT', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/products',
        payload: { name: 'Sem Auth', slug: 'sem-auth' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('retorna 401 com JWT inválido', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/products',
        headers: { authorization: 'Bearer token.invalido.aqui' },
        payload: { name: 'Inválido', slug: 'invalido' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /admin/products', () => {
    it('lista produtos sem expor apiKeyHash', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/products',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Array<Record<string, unknown>>>();
      expect(Array.isArray(body)).toBe(true);

      for (const product of body) {
        expect(product.apiKeyHash).toBeUndefined();
        expect(product.apiKey).toBeUndefined();
      }
    });

    it('retorna 401 sem JWT', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/products' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PUT /admin/products/:id', () => {
    it('atualiza produto com sucesso', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/products/${createdProductId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          adapterType: 'meta-cloud',
          origins: ['n8n'],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ adapterType: string; origins: string[] }>();
      expect(body.adapterType).toBe('meta-cloud');
      expect(body.origins).toEqual(['n8n']);
    });

    it('retorna 404 para id inexistente', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/products/id-que-nao-existe',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Qualquer' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('ApiKeyGuard — produto criado neste teste', () => {
    it('apikey do produto criado é válida no guard', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/products',
        headers: { apikey: createdApiKey },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('DELETE /admin/products/:id', () => {
    it('desativa produto com sucesso', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/products/${createdProductId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ isActive: boolean }>();
      expect(body.isActive).toBe(false);
    });
  });
});
