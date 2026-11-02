import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { buildSmtpTransportOptions } from './smtp-options';

export const MAILER = Symbol('MAILER');

export type VerificationCodeMessage = {
  to: string;
  code: string;
  expiresInMinutes: number;
};

export interface Mailer {
  sendVerificationCode(message: VerificationCodeMessage): Promise<void>;
}

@Injectable()
export class SmtpMailer implements Mailer {
  private readonly transporter: ReturnType<typeof nodemailer.createTransport>;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.from = config.get<string>('SMTP_FROM') ?? 'noreply@novelbrain.local';
    this.transporter = nodemailer.createTransport(
      buildSmtpTransportOptions({
        host: config.get<string>('SMTP_HOST') ?? 'localhost',
        port: config.get<number>('SMTP_PORT') ?? 1025,
        user: config.get<string>('SMTP_USER'),
        password: config.get<string>('SMTP_PASSWORD'),
        secure: config.get<boolean>('SMTP_SECURE') === true,
        requireTls: config.get<boolean>('SMTP_REQUIRE_TLS') === true,
        rejectUnauthorized: config.get<boolean>('SMTP_REJECT_UNAUTHORIZED') !== false,
        tlsMinVersion: config.get<'TLSv1.2' | 'TLSv1.3'>('SMTP_TLS_MIN_VERSION') ?? 'TLSv1.2',
      }),
    );
  }

  async sendVerificationCode(message: VerificationCodeMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: 'NovelBrain 注册验证码',
      text: `你的注册验证码是 ${message.code}，${message.expiresInMinutes} 分钟内有效。不要将验证码告诉他人。`,
    });
  }
}
