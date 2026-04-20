import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('/ (GET) should return status object', () => {
      const result = appController.getRoot();
      expect(result.name).toBe('Softconnect - WhatsHub Gateway');
      expect(result.version).toBe('2.0.0');
      expect(result.status).toBe('online');
    });
  });
});
