import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Patch,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  characterProfileSaveSchema,
  characterStateSaveSchema,
  workIdSchema,
} from '@novel/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { charactersError } from './characters.errors';
import { CharactersService } from './characters.service';

@ApiTags('characters')
@Controller('works/:workId/branches/:branchId/characters')
@UseGuards(SessionAuthGuard)
export class CharactersController {
  constructor(private readonly characters: CharactersService) {}

  @Get(':characterId')
  @ApiOperation({ summary: 'Read a character profile and current state' })
  getCharacter(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('characterId') characterId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.characters.getCharacter(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseCharacterId(characterId),
    );
  }

  @Patch(':characterId/profile')
  @ApiOperation({ summary: 'Save a character profile' })
  saveProfile(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('characterId') characterId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = characterProfileSaveSchema.safeParse(body);
    if (!parsed.success) {
      throw charactersError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Complete the character profile',
        parsed.error.flatten(),
      );
    }

    return this.characters.saveProfile(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseCharacterId(characterId),
      parsed.data,
    );
  }

  @Put(':characterId/state')
  @ApiOperation({ summary: 'Save a character current state and record its history' })
  saveState(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('characterId') characterId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = characterStateSaveSchema.safeParse(body);
    if (!parsed.success) {
      throw charactersError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the character state',
        parsed.error.flatten(),
      );
    }

    return this.characters.saveState(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseCharacterId(characterId),
      parsed.data,
    );
  }

  private parseId(value: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw charactersError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }
    return parsed.data;
  }

  private parseCharacterId(value: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw charactersError(HttpStatus.NOT_FOUND, 'CHARACTER_NOT_FOUND', 'Character not found');
    }
    return parsed.data;
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw charactersError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');
    }
    return request.auth.user.id;
  }
}
