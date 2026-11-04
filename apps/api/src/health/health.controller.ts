import { Controller, Get, Res } from "@nestjs/common";
import { livenessResponseSchema, readinessResponseSchema } from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { HealthService } from "./health.service";

const livenessResponseJsonSchema = z.toJSONSchema(livenessResponseSchema, {
  target: "openapi-3.0",
  io: "output",
}) as SchemaObject;
const readinessResponseJsonSchema = z.toJSONSchema(readinessResponseSchema, {
  target: "openapi-3.0",
  io: "output",
}) as SchemaObject;

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOkResponse({
    description: "API process is alive",
    schema: livenessResponseJsonSchema as SchemaObject,
  })
  getLiveness() {
    return livenessResponseSchema.parse({
      data: this.healthService.getLiveness(),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Get("ready")
  @ApiOkResponse({
    description: "Required dependencies are available",
    schema: readinessResponseJsonSchema as SchemaObject,
  })
  @ApiServiceUnavailableResponse({
    description: "At least one required dependency is unavailable",
    schema: readinessResponseJsonSchema as SchemaObject,
  })
  async getReadiness(@Res({ passthrough: true }) response: Response) {
    const data = await this.healthService.getReadiness();
    if (data.status !== "ready") {
      response.status(503);
    }

    return readinessResponseSchema.parse({
      data,
      requestId: createRequestId(),
      meta: {},
    });
  }
}
