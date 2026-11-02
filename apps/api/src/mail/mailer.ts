import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

export const MAILER = Symbol('MAILER');

export type VerificationCodeMessage = {
  to: string;
  code: string;
  expiresInMinutes: number;
};

export type PasswordResetMessage = {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
};

export type EmailChangeCodeMessage = {
  to: string;
  code: string;
  expiresInMinutes: number;
};

export interface Mailer {
  sendVerificationCode(message: VerificationCodeMessage): Promise<void>;
  sendPasswordReset(message: PasswordResetMessage): Promise<void>;
  sendEmailChangeCode(message: EmailChangeCodeMessage): Promise<void>;
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

  async sendPasswordReset(message: PasswordResetMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: 'NovelBrain 密码重置',
      text: `请打开以下链接重置密码：${message.resetUrl}\n链接 ${message.expiresInMinutes} 分钟内有效，只能使用一次。如果不是你发起的，请忽略这封邮件。`,
    });
  }

  async sendEmailChangeCode(message: EmailChangeCodeMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: 'NovelBrain 邮箱变更验证码',
      text: `你的邮箱变更验证码是 ${message.code}，${message.expiresInMinutes} 分钟内有效。确认这是你要使用的邮箱后，再回到账号设置完成修改。`,
    });
  }
}
