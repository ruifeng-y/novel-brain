import "reflect-metadata";

import { writeFileSync } from "node:fs";
import path from "node:path";

import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module";

async function main(): Promise<void> {
  process.env.DATABASE_URL ??= "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain";
  process.env.REDIS_URL ??= "redis://localhost:6379";

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1");

  try {
    const config = new DocumentBuilder().setTitle("NovelBrain M0 API").setVersion("0.1.0").build();
    const document = SwaggerModule.createDocument(app, config);
    const outputPath = path.join(__dirname, "../openapi.json");
    writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ event: "api.openapi.generated", outputPath }));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown OpenAPI generation error";
  console.error(JSON.stringify({ event: "api.openapi.failed", message }));
  process.exitCode = 1;
});
