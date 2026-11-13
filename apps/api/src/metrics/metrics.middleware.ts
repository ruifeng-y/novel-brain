import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrometheusMetricsService } from "./prometheus-metrics.service";

const SKIPPED_PATHS = new Set(["/api/v1/metrics"]);
const METHODS = new Set(["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: PrometheusMetricsService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    if (SKIPPED_PATHS.has(request.path)) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();
    let recorded = false;
    const record = (): void => {
      if (recorded) {
        return;
      }
      recorded = true;
      const routeValue = (request.route as { path?: unknown } | undefined)?.path;
      const route = normalizeRoute(typeof routeValue === "string" ? routeValue : "/unmatched");
      this.metrics.observeHttpRequest(
        METHODS.has(request.method) ? request.method : "OTHER",
        route,
        response.statusCode,
        Number(process.hrtime.bigint() - startedAt) / 1_000_000_000,
      );
    };
    response.on("finish", record);
    response.on("close", record);
    next();
  }
}

export function normalizeRoute(route: string): string {
  const normalized = route
    .split("?")[0]
    ?.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, ":id")
    .replace(/[^A-Za-z0-9_/:.-]/gu, "");
  return normalized?.startsWith("/") && normalized.length <= 200 ? normalized : "/unmatched";
}
