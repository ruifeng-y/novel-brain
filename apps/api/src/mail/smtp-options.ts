export type SmtpTransportConfig = {
  host: string;
  port: number;
  user?: string;
  password?: string;
  secure: boolean;
  requireTls: boolean;
  rejectUnauthorized: boolean;
  tlsMinVersion: 'TLSv1.2' | 'TLSv1.3';
};

export function buildSmtpTransportOptions(config: SmtpTransportConfig) {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    auth: config.user && config.password ? { user: config.user, pass: config.password } : undefined,
    tls: {
      minVersion: config.tlsMinVersion,
      rejectUnauthorized: config.rejectUnauthorized,
    },
  };
}
