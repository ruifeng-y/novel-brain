import { describe, expect, it } from 'vitest';
import { buildSmtpTransportOptions } from './smtp-options';

describe('SMTP transport options', () => {
  it('requires authenticated TLS for a production relay', () => {
    const options = buildSmtpTransportOptions({
      host: 'smtp.example.com',
      port: 587,
      user: 'mailer',
      password: 'secret',
      secure: false,
      requireTls: true,
      rejectUnauthorized: true,
      tlsMinVersion: 'TLSv1.2',
    });

    expect(options).toMatchObject({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'mailer', pass: 'secret' },
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    });
  });

  it('supports implicit TLS and optional local Mailpit authentication', () => {
    expect(
      buildSmtpTransportOptions({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        requireTls: false,
        rejectUnauthorized: true,
        tlsMinVersion: 'TLSv1.3',
      }),
    ).toMatchObject({
      secure: true,
      auth: undefined,
      tls: { minVersion: 'TLSv1.3' },
    });
  });
});
