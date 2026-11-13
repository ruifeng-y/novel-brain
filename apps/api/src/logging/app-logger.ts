import type { LoggerService } from "@nestjs/common";
import {
  LogRedactionError,
  parseLogCanaryValues,
  sanitizeLogPayloadStrict,
} from "@novel-brain/core";
import pino, { type Logger } from "pino";

interface AppLoggerOptions {
  level?: string;
  service?: string;
  canaryValues?: readonly string[];
}

export class AppLogger implements LoggerService {
  private readonly logger: Logger;
  private readonly canaryValues: readonly string[];

  constructor(options: AppLoggerOptions = {}) {
    this.canaryValues = options.canaryValues ?? parseLogCanaryValues(process.env.LOG_CANARY_VALUES);
    this.logger = pino({
      level: options.level ?? process.env.LOG_LEVEL ?? "info",
      base: { service: options.service ?? "api" },
    });
  }

  log(message: unknown, context?: string): void {
    this.logger.info(this.context(context), this.message(message));
  }

  error(message: unknown, stack?: string, context?: string): void {
    const safeStack = stack ? this.stack(stack) : undefined;
    this.logger.error(
      {
        ...this.context(context),
        ...(safeStack ? { stack: safeStack } : {}),
      },
      this.message(message),
    );
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn(this.context(context), this.message(message));
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug(this.context(context), this.message(message));
  }

  verbose(message: unknown, context?: string): void {
    this.logger.trace(this.context(context), this.message(message));
  }

  fatal(message: unknown, context?: string): void {
    this.logger.fatal(this.context(context), this.message(message));
  }

  private context(context?: string): Record<string, string> {
    if (!context) {
      return {};
    }
    try {
      const sanitized = sanitizeLogPayloadStrict(context, {
        canaryValues: this.canaryValues,
      });
      return typeof sanitized === "string" ? { context: sanitized } : { context: "redacted" };
    } catch {
      return { context: "redacted" };
    }
  }

  private message(message: unknown): string {
    try {
      const sanitized = sanitizeLogPayloadStrict(message, {
        canaryValues: this.canaryValues,
      });
      return typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized);
    } catch (error) {
      if (error instanceof LogRedactionError) {
        return JSON.stringify({ event: "logging.redaction_failed" });
      }
      return JSON.stringify({ event: "logging.serialization_failed" });
    }
  }

  private stack(stack: string): string | undefined {
    let sanitized: unknown;
    try {
      sanitized = sanitizeLogPayloadStrict(stack, {
        canaryValues: this.canaryValues,
      });
    } catch (error) {
      if (error instanceof LogRedactionError) {
        return undefined;
      }
      return undefined;
    }
    if (typeof sanitized !== "string") {
      return undefined;
    }
    const frames = sanitized
      .split(/\r?\n/u)
      .map((line) => line.trimEnd())
      .filter((line) => /^\s+at\s/u.test(line));
    return frames.length > 0 ? frames.join("\n") : undefined;
  }
}
