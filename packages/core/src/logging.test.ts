import { describe, expect, it } from 'vitest';
import { RedactingLogger, redactLogFields, redactLogText } from './logging';

describe('production logging redaction', () => {
  it('redacts credentials and signed download paths from text', () => {
    const redacted = redactLogText(
      'Authorization: Bearer sk-live-secret-value password=hunter2 https://example.test/api/v1/downloads/abcdefghijklmnopqrstuvwxyz0123456789',
    );

    expect(redacted).not.toContain('sk-live-secret-value');
    expect(redacted).not.toContain('hunter2');
    expect(redacted).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(redacted).toContain('/downloads/[REDACTED]');
  });

  it('redacts sensitive values recursively without hiding safe metadata', () => {
    const redacted = redactLogFields({
      operation: 'chapter-generation',
      password: 'hunter2',
      nested: {
        apiKey: 'sk-secret',
        authorization: 'Bearer token-value',
        cookie: 'nb_session=session-token',
        model: 'deepseek-chat',
      },
    });

    expect(redacted).toEqual({
      operation: 'chapter-generation',
      password: '[REDACTED]',
      nested: {
        apiKey: '[REDACTED]',
        authorization: '[REDACTED]',
        cookie: '[REDACTED]',
        model: 'deepseek-chat',
      },
    });
  });

  it('writes structured JSON logs with redacted values', () => {
    const lines: string[] = [];
    const logger = new RedactingLogger('api', {
      format: 'json',
      now: () => new Date('2026-11-03T00:00:00.000Z'),
      write: (line) => lines.push(line),
    });

    logger.error(
      { message: 'request failed', token: 'download-token-value', password: 'hunter2' },
      'stack with sk-secret-value',
      'ExportsController',
    );

    expect(JSON.parse(lines[0])).toMatchObject({
      timestamp: '2026-11-03T00:00:00.000Z',
      level: 'error',
      service: 'api',
      context: 'ExportsController',
    });
    expect(lines[0]).not.toContain('download-token-value');
    expect(lines[0]).not.toContain('hunter2');
    expect(lines[0]).not.toContain('sk-secret-value');
  });
});
