import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { SESSION_COOKIE_NAME } from './auth.constants';
import { authError } from './auth.errors';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token: unknown = request.cookies?.[SESSION_COOKIE_NAME];

    if (typeof token !== 'string' || token.length === 0) {
      throw authError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');
    }

    const identity = await this.authService.getSessionIdentity(token);
    if (!identity) {
      throw authError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');
    }

    request.auth = identity;
    return true;
  }
}
