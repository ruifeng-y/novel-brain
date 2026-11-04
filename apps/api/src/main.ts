import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { ApiExceptionFilter } from "./common/api-exception.filter";
import { AppLogger } from "./logging/app-logger";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new AppLogger();

  app.useLogger(logger);
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new ApiExceptionFilter());
  const express = app.getHttpAdapter().getInstance();
  express.disable("x-powered-by");
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port, "0.0.0.0");
  logger.log({ event: "api.started", port }, "Bootstrap");
}

void bootstrap();
