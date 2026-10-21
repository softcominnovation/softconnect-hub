import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  process.env.RUNTIME_MODE = 'worker-maintenance';
  const { MaintenanceWorkerModule } =
    await import('./maintenance-worker.module.js');
  const app = await NestFactory.createApplicationContext(
    MaintenanceWorkerModule,
    { logger: ['error', 'warn', 'log'] },
  );
  app.enableShutdownHooks();
  new Logger('WorkerMaintenance').log(
    'Worker de manutenção iniciado; somente providers habilitados serão consultados.',
  );
}
void bootstrap();
