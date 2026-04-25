import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  app.setGlobalPrefix('api/v1');

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SoftConnect 2.0 — Admin API')
    .setDescription('Endpoints de administração do API Gateway de mensageria')
    .setVersion('2.0')
    .addBearerAuth()
    .addTag(
      'Admin — Auth (dashboard)',
      'Login e perfil para usuários do painel',
    )
    .addTag('Admin — Adapters', 'Adapters de mensageria disponíveis em runtime')
    .addTag('Admin — Users', 'Gestão de usuários administradores')
    .addTag('Admin — Products', 'Gestão de produtos e API Keys')
    .addTag('Admin — VPS', 'Gestão de servidores VPS')
    .addTag('Admin — Activity Log', 'Log de atividades dos usuários admin')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    deepScanRoutes: true,
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });

  const adminPaths = Object.keys(document.paths)
    .filter((path) => path.startsWith('/api/v1/admin'))
    .reduce<typeof document.paths>((acc, path) => {
      acc[path] = document.paths[path];
      return acc;
    }, {});

  const adminDocument = { ...document, paths: adminPaths };

  SwaggerModule.setup('docs/admin', app, adminDocument);

  // Porta default para o desenvolvimento local
  await app.listen(3000, '0.0.0.0');
  console.log(`Softconnect API rodando em: http://127.0.0.1:3000`);
  console.log(
    `Swagger Admin API disponível em: http://127.0.0.1:3000/docs/admin`,
  );
}
void bootstrap();
