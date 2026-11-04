import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller";
import { AuthRateLimiterService } from "./auth-rate-limiter.service";
import { AuthRepository } from "./auth.repository";
import { AuthService } from "./auth.service";
import { CsrfGuard } from "./csrf.guard";
import { MAIL_GATEWAY, SmtpMailGateway } from "./mail.gateway";
import { SessionAuthGuard } from "./session.guard";

@Module({
  controllers: [AuthController],
  providers: [
    AuthRepository,
    AuthRateLimiterService,
    AuthService,
    CsrfGuard,
    SessionAuthGuard,
    {
      provide: MAIL_GATEWAY,
      useClass: SmtpMailGateway,
    },
  ],
  exports: [AuthService, CsrfGuard, SessionAuthGuard],
})
export class AuthModule {}
