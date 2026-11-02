import { describe, expect, it } from 'vitest';
import { createSessionCookieOptions } from './session-cookie';

describe('session cookie options', () => {
  it('marks production session cookies Secure and HTTP-only', () => {
    expect(createSessionCookieOptions(true)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('keeps local HTTP development usable', () => {
    expect(createSessionCookieOptions(false)).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
    });
  });
});
