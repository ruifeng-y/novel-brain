const SENSITIVE_KEY =
  /(authorization|cookie|password|passwd|secret|token|signature|api[_-]?key|credential)/i;
const DOWNLOAD_PATH = /(\/downloads\/)[A-Za-z0-9._~-]{20,}/g;
const BEARER_TOKEN = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const MODEL_KEY = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const KEY_VALUE =
  /((?:password|passwd|secret|token|signature|api[_-]?key|authorization|cookie)\s*[=:]\s*)[^\s,;&"'}]+/gi;
const QUERY_SECRET = /([?&](?:token|signature|api_key|access_token)=)[^&#\s]+/gi;

type LogFormat = 'json' | 'text';

export type LoggerOptions = {
  format?: LogFormat;
  now?: () => Date;
  write?: (line: string) => void;
};

export function redactLogText(input: string): string {
  return input
    .replace(DOWNLOAD_PATH, '$1[REDACTED]')
    .replace(BEARER_TOKEN, '$1[REDACTED]')
    .replace(MODEL_KEY, '[REDACTED]')
    .replace(KEY_VALUE, '$1[REDACTED]')
    .replace(QUERY_SECRET, '$1[REDACTED]');
}

export function redactLogFields(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return redactLogText(value);
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (depth >= 8) {
    return '[TRUNCATED]';
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactLogText(value.message),
      stack: value.stack ? redactLogText(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactLogFields(item, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactLogFields(nested, depth + 1);
  }
  return output;
}

export class RedactingLogger {
  private readonly format: LogFormat;
  private readonly now: () => Date;
  private readonly writeLine: (line: string) => void;

  constructor(
    private readonly service: string,
    options: LoggerOptions = {},
  ) {
    this.format = options.format ?? 'text';
    this.now = options.now ?? (() => new Date());
    this.writeLine = options.write ?? ((line) => process.stdout.write(`${line}\n`));
  }

  log(message: unknown, ...optional: unknown[]): void {
    this.write('log', message, optional);
  }

  warn(message: unknown, ...optional: unknown[]): void {
    this.write('warn', message, optional);
  }

  error(message: unknown, ...optional: unknown[]): void {
    this.write('error', message, optional);
  }

  debug(message: unknown, ...optional: unknown[]): void {
    this.write('debug', message, optional);
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    this.write('verbose', message, optional);
  }

  fatal(message: unknown, ...optional: unknown[]): void {
    this.write('fatal', message, optional);
  }

  setLogLevels(): void {
    return;
  }

  private write(level: string, message: unknown, optional: unknown[]): void {
    const values = [...optional];
    const context = typeof values.at(-1) === 'string' ? String(values.pop()) : undefined;
    const extra = values.map((value) => redactLogFields(value));
    const safeMessage = redactLogFields(message);

    if (this.format === 'json') {
      this.writeLine(
        JSON.stringify({
          timestamp: this.now().toISOString(),
          level,
          service: this.service,
          context,
          message: safeMessage,
          ...(extra.length > 0 ? { details: extra } : {}),
        }),
      );
      return;
    }

    const rendered = typeof safeMessage === 'string' ? safeMessage : JSON.stringify(safeMessage);
    const suffix = extra.length > 0 ? ` ${JSON.stringify(extra)}` : '';
    const prefix = context ? ` [${context}]` : '';
    this.writeLine(
      `${this.now().toISOString()} ${level.toUpperCase()} ${this.service}${prefix} ${rendered}${suffix}`,
    );
  }
}
