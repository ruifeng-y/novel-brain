import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

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
    const user = config.get<string>('SMTP_USER');
    const password = config.get<string>('SMTP_PASSWORD');

    this.from = config.get<string>('SMTP_FROM') ?? 'noreply@novelbrain.local';
    this.transporter = nodemailer.createTransport({
      host: config.get<string>('SMTP_HOST') ?? 'localhost',
      port: config.get<number>('SMTP_PORT') ?? 1025,
      secure: false,
      auth: user && password ? { user, pass: password } : undefined,
    });
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
