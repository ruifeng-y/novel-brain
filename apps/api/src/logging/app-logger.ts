import type { LoggerService } from "@nestjs/common";
import { sanitizeLogPayload } from "@novel-brain/core";
import pino, { type Logger } from "pino";

export class AppLogger implements LoggerService {
  private readonly logger: Logger;

  constructor() {
    this.logger = pino({
      level: process.env.LOG_LEVEL ?? "info",
      base: { service: "api" },
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
    return context ? { context } : {};
  }

  private message(message: unknown): string {
    const sanitized = sanitizeLogPayload(message);
    return typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized);
  }

  private stack(stack: string): string | undefined {
    const sanitized = sanitizeLogPayload(stack);
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
