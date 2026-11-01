import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'warn', 'error'],
  });

  const shutdown = async (): Promise<void> => {
    await app.close();
    process.exit(0);
  };

  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  console.log('NovelBrain worker started');
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
