import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { createTestApp, getAdminToken } from './helpers/app.helper';

describe('Admin VPS (e2e)', () => {
  let app: NestFastifyApplication;
  let token: string;
  let createdVpsId: string;
  const prisma = new PrismaClient();

  beforeAll(async () => {
    await prisma.instance.deleteMany();
    await prisma.vpsServer.deleteMany();
    app = await createTestApp();
    token = await getAdminToken(app);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /admin/vps', () => {
    it('cria VPS e retorna providerApiKey descriptografada', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/vps',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          label: 'VPS E2E Teste',
          subdomain: `e2e-vps-${Date.now()}.example.com`,
          ip: '10.0.0.99',
          providerUrl: 'http://10.0.0.99:8080',
          providerApiKey: 'raw-provider-key-12345',
          managerApiKey: 'raw-manager-key-67890',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<{
        id: string;
        name: string;
        host: string;
        providerApiKey: string;
        managerApiKey: string;
        isActive: boolean;
      }>();

      expect(body.id).toBeDefined();
      expect(body.providerApiKey).toBe('raw-provider-key-12345');
      expect(body.managerApiKey).toBe('raw-manager-key-67890');
      expect(body.isActive).toBe(true);

      createdVpsId = body.id;
    });

    it('retorna 401 sem JWT', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/vps',
        payload: {
          label: 'Sem Auth',
          subdomain: 'sem-auth.com',
          ip: '1.1.1.1',
          providerUrl: 'http://1.1.1.1',
          providerApiKey: 'key',
        },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /admin/vps', () => {
    it('lista VPS com chaves descriptografadas', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/vps',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Array<Record<string, unknown>>>();
      expect(Array.isArray(body)).toBe(true);

      const created = body.find((v) => v['id'] === createdVpsId);
      expect(created).toBeDefined();
      expect(created!['providerApiKey']).toBe('raw-provider-key-12345');
      expect(created!['managerApiKey']).toBe('raw-manager-key-67890');
    });

    it('retorna 401 sem JWT', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/vps' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PUT /admin/vps/:id', () => {
    it('atualiza chave e resposta mostra valor descriptografado', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/vps/${createdVpsId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          providerApiKey: 'nova-chave-provider-atualizada',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ providerApiKey: string }>();
      expect(body.providerApiKey).toBe('nova-chave-provider-atualizada');
    });

    it('retorna 404 para id inexistente', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/vps/id-que-nao-existe',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Qualquer' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /admin/vps/:id', () => {
    it('desativa VPS com sucesso', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/vps/${createdVpsId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ isActive: boolean }>();
      expect(body.isActive).toBe(false);
    });
  });
});
