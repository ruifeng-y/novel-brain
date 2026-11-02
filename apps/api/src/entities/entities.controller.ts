import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  customFieldDefinitionInputSchema,
  entityCreateSchema,
  entitySearchSchema,
  entityUpdateSchema,
  relationCreateSchema,
  workIdSchema,
} from '@novel/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { entitiesError } from './entities.errors';
import { EntitiesService } from './entities.service';

type ParseResult<T> =
  { success: true; data: T } | { success: false; error: { flatten: () => unknown } };

@ApiTags('entities')
@Controller('works/:workId/branches/:branchId')
@UseGuards(SessionAuthGuard)
export class EntitiesController {
  constructor(private readonly entitiesService: EntitiesService) {}

  @Get('entities')
  @ApiOperation({ summary: 'Search the settings for a work branch' })
  listEntities(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Query() query: Record<string, string | undefined>,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = entitySearchSchema.safeParse(query);
    if (!parsed.success) {
      throw entitiesError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the settings search details',
        parsed.error.flatten(),
      );
    }
    return this.entitiesService.listEntities(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      parsed.data,
    );
  }

  @Post('entities')
  @ApiOperation({ summary: 'Create a setting entity' })
  createEntity(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.entitiesService.createEntity(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseBody(entityCreateSchema, body, 'Complete the setting details'),
    );
  }

  @Get('entities/:entityId')
  @ApiOperation({ summary: 'Read one setting entity' })
  getEntity(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('entityId') entityId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.entitiesService.getEntity(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseEntityId(entityId),
    );
  }

  @Patch('entities/:entityId')
  @ApiOperation({ summary: 'Update one setting entity' })
  updateEntity(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('entityId') entityId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.entitiesService.updateEntity(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseEntityId(entityId),
      this.parseBody(entityUpdateSchema, body, 'Complete the setting details'),
    );
  }

  @Delete('entities/:entityId')
  @ApiOperation({ summary: 'Archive one setting entity' })
  deleteEntity(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('entityId') entityId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.entitiesService.deleteEntity(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseEntityId(entityId),
    );
  }

  @Get('custom-fields')
  @ApiOperation({ summary: 'List custom settings fields for a work branch' })
  listCustomFields(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.entitiesService.listCustomFields(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
    );
  }

  @Post('custom-fields')
  @ApiOperation({ summary: 'Create a custom settings field for a work branch' })
  createCustomField(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.entitiesService.createCustomField(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseBody(customFieldDefinitionInputSchema, body, 'Complete the custom field details'),
    );
  }

  @Get('relations')
  @ApiOperation({ summary: 'List typed settings relations for a work branch' })
  listRelations(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Query('entityId') entityId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.entitiesService.listRelations(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      entityId === undefined ? undefined : this.parseEntityId(entityId),
    );
  }

  @Post('relations')
  @ApiOperation({ summary: 'Create a typed settings relation' })
  createRelation(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.entitiesService.createRelation(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseBody(relationCreateSchema, body, 'Complete the relation details'),
    );
  }

  private parseBody<T>(
    schema: {
      safeParse: (body: unknown) => ParseResult<T>;
    },
    body: unknown,
    message: string,
  ): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw entitiesError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        message,
        parsed.error.flatten(),
      );
    }
    return parsed.data;
  }

  private parseId(value: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw entitiesError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }
    return parsed.data;
  }

  private parseEntityId(value: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw entitiesError(HttpStatus.NOT_FOUND, 'ENTITY_NOT_FOUND', 'Setting not found');
    }
    return parsed.data;
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw entitiesError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');
    }
    return request.auth.user.id;
  }
}
