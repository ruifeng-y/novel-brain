import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import {
  authSessionResponseSchema,
  csrfResponseSchema,
  loginRequestSchema,
  logoutResponseSchema,
  registerRequestSchema,
  sendRegistrationCodeRequestSchema,
  sendRegistrationCodeResponseSchema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";

import type { AuthenticatedRequest } from "./auth.types";
import { randomToken } from "./auth-crypto";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthService } from "./auth.service";
import { clearAuthCookies, setCsrfCookie, setSessionCookie } from "./cookies";
import { CsrfGuard } from "./csrf.guard";
import { SessionAuthGuard } from "./session.guard";

function responseEnvelope<T>(data: T) {
  return { data, requestId: createRequestId(), meta: {} };
}

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get("csrf")
  getCsrf(@Res({ passthrough: true }) response: Response) {
    const token = randomToken();
    setCsrfCookie(response, token);
    return csrfResponseSchema.parse(responseEnvelope({ token }));
  }

  @Post("register/send-code")
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async sendRegistrationCode(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const input = sendRegistrationCodeRequestSchema.parse(body);
    const result = await this.authService.sendRegistrationCode(input, request.ip ?? "unknown");
    return sendRegistrationCodeResponseSchema.parse(
      responseEnvelope({ sent: true, expiresAt: result.expiresAt.toISOString() }),
    );
  }

  @Post("register")
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async register(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const issued = await this.authService.register(
      registerRequestSchema.parse(body),
      request.ip ?? "unknown",
      request.headers["user-agent"] ?? "",
    );
    setSessionCookie(response, issued.token, issued.maxAgeSeconds);
    return authSessionResponseSchema.parse(responseEnvelope(issued.data));
  }

  @Post("login")
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async login(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const issued = await this.authService.login(
      loginRequestSchema.parse(body),
      request.ip ?? "unknown",
      request.headers["user-agent"] ?? "",
    );
    setSessionCookie(response, issued.token, issued.maxAgeSeconds);
    return authSessionResponseSchema.parse(responseEnvelope(issued.data));
  }

  @Get("me")
  @UseGuards(SessionAuthGuard)
  getMe(@Req() request: AuthenticatedRequest) {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    return authSessionResponseSchema.parse(
      responseEnvelope(this.authService.toSessionData(request.auth.user, request.auth.session)),
    );
  }

  @Post("logout")
  @HttpCode(200)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    await this.authService.logout(request.auth.session.id);
    clearAuthCookies(response);
    return logoutResponseSchema.parse(responseEnvelope({ loggedOut: true }));
  }
}
