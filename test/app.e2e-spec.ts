import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect((res) => {
        const body = res.body as {
          name: string;
          version: string;
          status: string;
        };
        expect(body.name).toBe('Softconnect - WhatsHub Gateway');
        expect(body.version).toBe('2.0.0');
        expect(body.status).toBe('online');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
