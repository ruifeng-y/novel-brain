import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  authDeviceSessionsQuerySchema,
  authDeviceSessionsResponseSchema,
  authPasswordSchema,
  authSessionResponseSchema,
  csrfResponseSchema,
  loginRequestSchema,
  logoutResponseSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  resetPasswordResponseSchema,
  revokeSessionResponseSchema,
  sendRegistrationCodeRequestSchema,
  sendRegistrationCodeResponseSchema,
  sendPasswordResetRequestSchema,
  sendPasswordResetResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import { ApiBody, ApiOkResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";

import { ApiError } from "../common/api-error";
import { ApiQuerySchema } from "../common/zod-openapi";
import type { AuthenticatedRequest } from "./auth.types";
import { randomToken } from "./auth-crypto";
import { getClientIp } from "./client-ip";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthService } from "./auth.service";
import {
  SESSION_COOKIE,
  clearAuthCookies,
  parseCookies,
  setCsrfCookie,
  setSessionCookie,
} from "./cookies";
import { CsrfGuard } from "./csrf.guard";
import { SessionAuthGuard } from "./session.guard";

function responseEnvelope<T>(data: T) {
  return { data, requestId: createRequestId(), meta: {} };
}

function schemaOf(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "output" }) as SchemaObject;
}

const sendCodeBodySchema = schemaOf(sendRegistrationCodeRequestSchema);
const registerBodySchema = schemaOf(registerRequestSchema);
const loginBodySchema = schemaOf(loginRequestSchema);
const passwordForgotBodySchema = schemaOf(sendPasswordResetRequestSchema);
const passwordResetBodySchema = schemaOf(resetPasswordRequestSchema);
const csrfResponseJsonSchema = schemaOf(csrfResponseSchema);
const sendCodeResponseJsonSchema = schemaOf(sendRegistrationCodeResponseSchema);
const sendPasswordResetResponseJsonSchema = schemaOf(sendPasswordResetResponseSchema);
const resetPasswordResponseJsonSchema = schemaOf(resetPasswordResponseSchema);
const authSessionResponseJsonSchema = schemaOf(authSessionResponseSchema);
const logoutResponseJsonSchema = schemaOf(logoutResponseSchema);
const sessionsResponseJsonSchema = schemaOf(authDeviceSessionsResponseSchema);
const revokeSessionResponseJsonSchema = schemaOf(revokeSessionResponseSchema);

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get("csrf")
  @ApiOkResponse({ description: "CSRF token", schema: csrfResponseJsonSchema })
  getCsrf(@Res({ passthrough: true }) response: Response) {
    const token = randomToken();
    setCsrfCookie(response, token);
    return csrfResponseSchema.parse(responseEnvelope({ token }));
  }

  @Post("register/send-code")
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiBody({ schema: sendCodeBodySchema })
  @ApiOkResponse({ description: "Verification code sent", schema: sendCodeResponseJsonSchema })
  async sendRegistrationCode(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const input = sendRegistrationCodeRequestSchema.parse(body);
    const result = await this.authService.sendRegistrationCode(input, getClientIp(request));
    return sendRegistrationCodeResponseSchema.parse(
      responseEnvelope({ sent: true, expiresAt: result.expiresAt.toISOString() }),
    );
  }

  @Post("register")
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiBody({ schema: registerBodySchema })
  @ApiOkResponse({ description: "Registered session", schema: authSessionResponseJsonSchema })
  async register(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const password = (body as { password?: unknown } | null)?.password;
    if (typeof password !== "string" || !authPasswordSchema.safeParse(password).success) {
      throw new ApiError(400, "AUTH_PASSWORD_WEAK", "密码至少 12 位，并且必须同时包含字母和数字");
    }

    const issued = await this.authService.register(
      registerRequestSchema.parse(body),
      getClientIp(request),
      request.headers["user-agent"] ?? "",
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    setSessionCookie(response, issued.token, issued.maxAgeSeconds);
    return authSessionResponseSchema.parse(responseEnvelope(issued.data));
  }

  @Post("login")
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiBody({ schema: loginBodySchema })
  @ApiOkResponse({ description: "Authenticated session", schema: authSessionResponseJsonSchema })
  async login(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const issued = await this.authService.login(
      loginRequestSchema.parse(body),
      getClientIp(request),
      request.headers["user-agent"] ?? "",
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    setSessionCookie(response, issued.token, issued.maxAgeSeconds);
    return authSessionResponseSchema.parse(responseEnvelope(issued.data));
  }

  @Post("password/forgot")
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiBody({ schema: passwordForgotBodySchema })
  @ApiOkResponse({
    description: "Password reset email accepted",
    schema: sendPasswordResetResponseJsonSchema,
  })
  async forgotPassword(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const result = await this.authService.sendPasswordReset(
      sendPasswordResetRequestSchema.parse(body),
      getClientIp(request),
    );
    return sendPasswordResetResponseSchema.parse(
      responseEnvelope({ sent: true, expiresAt: result.expiresAt.toISOString() }),
    );
  }

  @Post("password/reset")
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiBody({ schema: passwordResetBodySchema })
  @ApiOkResponse({ description: "Password reset", schema: resetPasswordResponseJsonSchema })
  async resetPassword(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    await this.authService.resetPassword(
      resetPasswordRequestSchema.parse(body),
      getClientIp(request),
    );
    return resetPasswordResponseSchema.parse(responseEnvelope({ reset: true }));
  }

  @Get("me")
  @UseGuards(SessionAuthGuard)
  @ApiOkResponse({
    description: "Current authenticated session",
    schema: authSessionResponseJsonSchema,
  })
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
  @ApiOkResponse({ description: "Session revoked", schema: logoutResponseJsonSchema })
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

  @Post("logout-all")
  @HttpCode(200)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiOkResponse({ description: "All sessions revoked", schema: logoutResponseJsonSchema })
  async logoutAll(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    await this.authService.logoutAll(request.auth.user.id);
    clearAuthCookies(response);
    return logoutResponseSchema.parse(responseEnvelope({ loggedOut: true }));
  }

  @Get("sessions")
  @UseGuards(SessionAuthGuard)
  @ApiQuerySchema(authDeviceSessionsQuerySchema)
  @ApiOkResponse({ description: "Active sessions", schema: sessionsResponseJsonSchema })
  async sessions(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    const requestId = createRequestId();
    const page = await this.authService.listSessions(
      request.auth.user.id,
      request.auth.session.id,
      authDeviceSessionsQuerySchema.parse(query ?? {}),
    );
    return authDeviceSessionsResponseSchema.parse({
      data: page.data,
      requestId,
      meta: { nextCursor: page.nextCursor },
    });
  }

  @Delete("sessions/:sessionId")
  @HttpCode(200)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiOkResponse({ description: "Session revoked", schema: revokeSessionResponseJsonSchema })
  async revokeSession(@Req() request: AuthenticatedRequest, @Param("sessionId") sessionId: string) {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    await this.authService.revokeUserSession(request.auth.user.id, uuidV7Schema.parse(sessionId));
    return revokeSessionResponseSchema.parse(responseEnvelope({ revoked: true }));
  }
}
