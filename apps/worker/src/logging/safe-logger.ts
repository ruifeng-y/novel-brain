import {
  isSafeTelemetryMetricName,
  LogRedactionError,
  parseLogCanaryValues,
  sanitizeLogPayloadStrict,
  sanitizeTelemetryLabels,
} from "@novel-brain/core";
import pino, { type Logger } from "pino";

interface SafePinoLoggerOptions {
  level?: string;
  canaryValues?: readonly string[];
}

export class SafePinoLogger {
  private readonly logger: Logger;
  private readonly canaryValues: readonly string[];

  constructor(options: SafePinoLoggerOptions = {}) {
    this.canaryValues = options.canaryValues ?? parseLogCanaryValues(process.env.LOG_CANARY_VALUES);
    this.logger = pino({
      level: options.level ?? process.env.LOG_LEVEL ?? "info",
      base: { service: "worker" },
    });
  }

  info(payload: Record<string, unknown>, message = "Worker event"): void {
    this.write("info", payload, message);
  }

  warn(payload: Record<string, unknown>, message = "Worker warning"): void {
    this.write("warn", payload, message);
  }

  error(payload: Record<string, unknown>, message = "Worker error"): void {
    this.write("error", payload, message);
  }

  debug(payload: Record<string, unknown>, message = "Worker debug"): void {
    this.write("debug", payload, message);
  }

  trace(payload: Record<string, unknown>, message = "Worker trace"): void {
    this.write("trace", payload, message);
  }

  fatal(payload: Record<string, unknown>, message = "Worker fatal"): void {
    this.write("fatal", payload, message);
  }

  metric(name: string, labels: Record<string, unknown>, value = 1): void {
    const containsCanary = (candidate: string): boolean =>
      this.canaryValues.some((canary) => canary.length > 0 && candidate.includes(canary));
    if (!isSafeTelemetryMetricName(name) || !Number.isFinite(value) || containsCanary(name)) {
      return;
    }
    const safeLabels = Object.fromEntries(
      Object.entries(sanitizeTelemetryLabels(labels)).filter(
        ([key, label]) => !containsCanary(key) && !containsCanary(label),
      ),
    );
    this.logger.info({
      event: "telemetry.metric",
      metric: name,
      value,
      labels: safeLabels,
    });
  }

  private write(
    level: "info" | "warn" | "error" | "debug" | "trace" | "fatal",
    payload: Record<string, unknown>,
    message: string,
  ): void {
    this.logger[level](this.safePayload(payload), this.safeMessage(message));
  }

  private safePayload(payload: Record<string, unknown>): Record<string, unknown> {
    try {
      const sanitized = sanitizeLogPayloadStrict(payload, {
        canaryValues: this.canaryValues,
      });
      return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
        ? (sanitized as Record<string, unknown>)
        : { event: "logging.redaction_failed" };
    } catch (error) {
      if (error instanceof LogRedactionError) {
        return { event: "logging.redaction_failed" };
      }
      return { event: "logging.serialization_failed" };
    }
  }

  private safeMessage(message: string): string {
    try {
      const sanitized = sanitizeLogPayloadStrict(message, {
        canaryValues: this.canaryValues,
      });
      return typeof sanitized === "string" ? sanitized : "Worker event";
    } catch (error) {
      if (error instanceof LogRedactionError) {
        return "Log payload redacted";
      }
      return "Log serialization failed";
    }
  }
}
