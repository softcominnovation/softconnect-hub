import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('GET /', () => {
    it('retorna nome e status do gateway', () => {
      const result = appController.getRoot();
      expect(result).toMatchObject({ status: 'online' });
    });
  });

  describe('GET /health', () => {
    it('retorna status healthy', () => {
      const result = appController.getHealth();
      expect(result).toMatchObject({ status: 'healthy' });
    });
  });
});
