import type { LoggerService } from "@nestjs/common";
import {
  LogRedactionError,
  parseLogCanaryValues,
  sanitizeLogPayloadStrict,
  sanitizeStructuredPayload,
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
    this.write("info", message, context);
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.write("error", message, context, stack);
  }

  warn(message: unknown, context?: string): void {
    this.write("warn", message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write("debug", message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write("trace", message, context);
  }

  fatal(message: unknown, context?: string): void {
    this.write("fatal", message, context);
  }

  private write(
    level: "info" | "warn" | "error" | "debug" | "trace" | "fatal",
    message: unknown,
    context?: string,
    stack?: string,
  ): void {
    const safeContext = this.context(context);
    const safeMessage = this.message(message);
    const safeStack = stack ? this.stack(stack) : { value: undefined, failed: false };
    if (safeContext.failed || safeMessage.failed || safeStack.failed) {
      this.logger[level]({ event: "logging.redaction_failed" });
      return;
    }
    this.logger[level](
      {
        ...safeContext.value,
        ...(safeStack.value ? { stack: safeStack.value } : {}),
      },
      safeMessage.value,
    );
  }

  private context(context?: string): { value: Record<string, string>; failed: boolean } {
    if (!context) {
      return { value: {}, failed: false };
    }
    try {
      const sanitized = sanitizeLogPayloadStrict(context, {
        canaryValues: this.canaryValues,
      });
      return {
        value: typeof sanitized === "string" ? { context: sanitized } : { context: "redacted" },
        failed: false,
      };
    } catch {
      return { value: {}, failed: true };
    }
  }

  private message(message: unknown): { value: string; failed: boolean } {
    try {
      const sanitized = sanitizeLogPayloadStrict(message, {
        canaryValues: this.canaryValues,
      });
      return {
        value: typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized),
        failed: false,
      };
    } catch (error) {
      if (error instanceof LogRedactionError) {
        return { value: "", failed: true };
      }
      return { value: "", failed: true };
    }
  }

  private stack(stack: string): { value: string | undefined; failed: boolean } {
    const frames = stack
      .split(/\r?\n/u)
      .map((line) => line.trimEnd())
      .filter((line) => /^\s+at\s/u.test(line));
    if (frames.length === 0) {
      return { value: undefined, failed: false };
    }
    let sanitized: unknown;
    try {
      sanitized = sanitizeStructuredPayload(frames, {
        canaryValues: this.canaryValues,
      });
    } catch (error) {
      if (error instanceof LogRedactionError) {
        return { value: undefined, failed: true };
      }
      return { value: undefined, failed: true };
    }
    if (!Array.isArray(sanitized) || sanitized.some((line) => typeof line !== "string")) {
      return { value: undefined, failed: true };
    }
    return { value: sanitized.join("\n"), failed: false };
  }
}
