import { describe, expect, it } from 'vitest';
import { redactModelSecrets } from './redaction';

describe('model secret redaction', () => {
  it('removes bearer tokens, API keys, and common JSON fields', () => {
    const input = [
      'Authorization: Bearer sk-abcdefghijklmnop',
      '{"apiKey":"sk-json-secret-value","message":"failed"}',
      'api_key=sk-query-secret-value&model=deepseek-chat',
    ].join('\n');

    const redacted = redactModelSecrets(input);

    expect(redacted).not.toContain('sk-abcdefghijklmnop');
    expect(redacted).not.toContain('sk-json-secret-value');
    expect(redacted).not.toContain('sk-query-secret-value');
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).toContain('deepseek-chat');
  });
});
