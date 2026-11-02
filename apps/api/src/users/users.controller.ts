import { Controller, Get, Header, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { usersError } from './users.errors';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
@UseGuards(SessionAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me/export')
  @Header('Content-Disposition', 'attachment; filename="novelbrain-account-export.json"')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Export the signed-in author account data without model keys' })
  export(@Req() request: AuthenticatedRequest) {
    if (!request.auth) {
      throw usersError(401, 'UNAUTHENTICATED', '请先登录');
    }
    return this.users.exportAccount(request.auth.user.id);
  }
}
