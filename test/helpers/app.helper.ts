import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

export async function createTestApp(): Promise<NestFastifyApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return app;
}

export async function getAdminToken(
  app: NestFastifyApplication,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/auth/login',
    payload: { secret: process.env.ADMIN_SECRET ?? 'minha-senha-admin-dev' },
  });

  const body = res.json<{ access_token: string }>();
  return body.access_token;
}
