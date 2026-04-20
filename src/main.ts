import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter()
  );
  
  // Porta default para o desenvolvimento local
  await app.listen(3000, '0.0.0.0');
  console.log(`Softconnect API rodando em: http://127.0.0.1:3000`);
}
bootstrap();
