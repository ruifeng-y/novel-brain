import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { RedactingLogger } from '@novel/core';
import { WorkerModule } from './worker.module';

const logger = new RedactingLogger('worker', {
  format:
    process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production' ? 'json' : 'text',
});

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger,
  });

  const shutdown = async (): Promise<void> => {
    await app.close();
    process.exit(0);
  };

  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  logger.log('NovelBrain worker started');
}

bootstrap().catch((error: unknown) => {
  logger.error(error);
  process.exit(1);
});
