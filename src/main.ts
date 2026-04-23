import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

<<<<<<< HEAD
const app = Fastify({
  logger: true
});

app.get('/', async () => {
  return { message: 'SoftConnect API running 🚀' };
});

app.get('/health', async () => {
  return { status: 'ok' };
});

const start = async () => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
    console.log('ci: Update to v0.1.0 PROD');
    console.log('Server running on port 3000');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
=======
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
>>>>>>> develop
