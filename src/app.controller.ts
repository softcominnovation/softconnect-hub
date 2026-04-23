import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getRoot() {
    return {
      name: 'Softconnect - WhatsHub Gateway',
      version: '2.0.0',
      status: 'online',
      provider: 'Multi-Adapter Node (Evolution, Meta, etc)',
    };
  }

  @Get('health')
  getHealth() {
    // Retorno simples provisório
    // Na fase 3, será expandido para verificar a saúde real das conexões VPS.
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };
  }
}
