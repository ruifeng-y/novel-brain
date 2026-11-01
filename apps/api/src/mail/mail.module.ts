import { Module } from '@nestjs/common';
import { MAILER, SmtpMailer } from './mailer';

@Module({
  providers: [{ provide: MAILER, useClass: SmtpMailer }],
  exports: [MAILER],
})
export class MailModule {}
