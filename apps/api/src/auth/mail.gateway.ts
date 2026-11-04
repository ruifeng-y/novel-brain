import { Injectable } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";

export const MAIL_GATEWAY = Symbol("MAIL_GATEWAY");

export interface MailGateway {
  sendVerificationCode(email: string, code: string, expiresAt: Date): Promise<void>;
}

@Injectable()
export class SmtpMailGateway implements MailGateway {
  private transporter: Transporter | undefined;

  async sendVerificationCode(email: string, code: string, expiresAt: Date): Promise<void> {
    const transport = this.getTransporter();
    await transport.sendMail({
      from: process.env.MAIL_FROM ?? "墨舟 <no-reply@novelbrain.local>",
      to: email,
      subject: "墨舟注册验证码",
      text: `你的注册验证码是 ${code}，有效期至 ${expiresAt.toISOString()}。`,
      html: `<p>你的注册验证码是 <strong>${code}</strong>。</p><p>验证码 10 分钟内有效。</p>`,
    });
  }

  private getTransporter(): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT ?? 1025);
    if (!host) {
      throw new Error("SMTP_HOST is required");
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: false,
    });
    return this.transporter;
  }
}
