import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { RedactingLogger } from '@novel/core';
import { AppModule } from './app.module';

const logger = new RedactingLogger('api', {
  format:
    process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production' ? 'json' : 'text',
});

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });
  const config = app.get(ConfigService);
  app.set('trust proxy', config.get<number>('TRUST_PROXY_HOPS') ?? 1);
  app.setGlobalPrefix('api/v1');

  const swaggerConfig = new DocumentBuilder()
    .setTitle('NovelBrain API')
    .setDescription('M0 platform API')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = config.get<number>('API_PORT') ?? 3001;
  await app.listen(port, '0.0.0.0');
  logger.log(`NovelBrain API listening on ${port}`);
}

bootstrap().catch((error: unknown) => {
  logger.error(error);
  process.exit(1);
});
