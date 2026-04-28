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
    .setTitle('SoftConnect 2.0 API')
    .setDescription('API Gateway de mensageria — Admin Plane e Data Plane')
    .setVersion('2.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'apikey', in: 'header' }, 'apikey')
    .addTag(
      'Admin — Auth (dashboard)',
      'Login e perfil para usuários do painel',
    )
    .addTag('Admin — Adapters', 'Adapters de mensageria disponíveis em runtime')
    .addTag('Admin — Users', 'Gestão de usuários administradores')
    .addTag('Admin — Products', 'Gestão de produtos e API Keys')
    .addTag('Admin — VPS', 'Gestão de servidores VPS')
    .addTag('Admin — Activity Log', 'Log de atividades dos usuários admin')
    .addTag('Data Plane — Instances', 'Gerenciamento de instâncias WhatsApp')
    .addTag(
      'Data Plane — Messages',
      'Envio de mensagens unitárias via WhatsApp',
    )
    .addTag('Data Plane — Messages (Batch)', 'Envio de mensagens em lote')
    .addTag('Data Plane — Chat', 'Consulta de conversas e contatos')
    .addTag('Data Plane — Webhooks', 'Configuração de webhooks')
    .addTag('Data Plane — Settings', 'Configurações de instância no provider')
    .addTag('Data Plane — Proxy', 'Configuração de proxy por instância')
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

  const adminDocument = {
    ...document,
    paths: adminPaths,
    tags: document.tags?.filter((t) => t.name.startsWith('Admin')),
  };
  SwaggerModule.setup('docs/admin', app, adminDocument);

  const dataplanePaths = Object.keys(document.paths)
    .filter(
      (path) =>
        path.startsWith('/api/v1/instance') ||
        path.startsWith('/api/v1/message') ||
        path.startsWith('/api/v1/chat') ||
        path.startsWith('/api/v1/webhook') ||
        path.startsWith('/api/v1/settings') ||
        path.startsWith('/api/v1/proxy'),
    )
    .reduce<typeof document.paths>((acc, path) => {
      acc[path] = document.paths[path];
      return acc;
    }, {});

  const dataplaneDocument = {
    ...document,
    paths: dataplanePaths,
    tags: document.tags?.filter((t) => t.name.startsWith('Data Plane')),
  };
  SwaggerModule.setup('docs/data', app, dataplaneDocument);

  await app.listen(3000, '0.0.0.0');
  console.log(`Softconnect API rodando em: http://127.0.0.1:3000/api/v1`);
  console.log(
    `Swagger Admin API disponível em: http://127.0.0.1:3000/docs/admin`,
  );
  console.log(
    `Swagger Data Plane disponível em: http://127.0.0.1:3000/docs/data`,
  );
}
void bootstrap();
