import type { LoggerService } from "@nestjs/common";
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
    this.logger.error(
      {
        ...this.context(context),
        ...(stack ? { stack } : {}),
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
    return typeof message === "string" ? message : JSON.stringify(message);
  }
}
