import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  breakthroughCheckSchema,
  endItemOwnershipSchema,
  goldenFingerInputSchema,
  goldenFingerUpdateSchema,
  itemOwnershipInputSchema,
  itemTechniqueProfileInputSchema,
  powerSystemProfileInputSchema,
  timelineEraInputSchema,
  timelineEraUpdateSchema,
  timelineNodeInputSchema,
  timelineNodeUpdateSchema,
  workIdSchema,
} from '@novel/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { worldbuildingError } from './worldbuilding.errors';
import { WorldbuildingService } from './worldbuilding.service';

type ParseResult<T> =
  { success: true; data: T } | { success: false; error: { flatten: () => unknown } };

@ApiTags('worldbuilding')
@Controller('works/:workId/branches/:branchId')
@UseGuards(SessionAuthGuard)
export class WorldbuildingController {
  constructor(private readonly worldbuildingService: WorldbuildingService) {}

  @Get('power-systems/:entityId')
  @ApiOperation({ summary: 'Read the detailed rules for a power-system setting' })
  getPowerSystemProfile(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('entityId') entityId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.worldbuildingService.getPowerSystemProfile(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parsePathId(entityId, 'SETTING_NOT_FOUND', 'Setting not found'),
    );
  }

  @Put('power-systems/:entityId')
  @ApiOperation({ summary: 'Save the detailed rules for a power-system setting' })
  savePowerSystemProfile(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('entityId') entityId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.worldbuildingService.savePowerSystemProfile(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parsePathId(entityId, 'SETTING_NOT_FOUND', 'Setting not found'),
      this.parseBody(
        powerSystemProfileInputSchema,
        body,
        'Check the power levels, paths, and breakthrough rules',
      ),
    );
  }

  @Post('power-systems/:entityId/breakthrough-check')
  @ApiOperation({ summary: 'Check whether a character can break through a power level' })
  checkBreakthrough(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('entityId') entityId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.worldbuildingService.checkBreakthrough(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parsePathId(entityId, 'SETTING_NOT_FOUND', 'Setting not found'),
      this.parseBody(
        breakthroughCheckSchema,
        body,
        'Check the current level, conditions, and resources',
      ),
    );
  }

  @Get('golden-fingers')
  @ApiOperation({ summary: 'List golden fingers for a work branch or setting owner' })
  listGoldenFingers(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Query('ownerEntityId') ownerEntityId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.worldbuildingService.listGoldenFingers(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      ownerEntityId === undefined
        ? undefined
        : this.parsePathId(ownerEntityId, 'SETTING_NOT_FOUND', 'Setting not found'),
    );
  }

  @Post('golden-fingers')
  @ApiOperation({ summary: 'Create a golden finger for a character or power system' })
  createGoldenFinger(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.worldbuildingService.createGoldenFinger(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseBody(
        goldenFingerInputSchema,
        body,
        'Complete the golden finger rules, costs, limits, and growth stages',
      ),
    );
  }

  @Patch('golden-fingers/:goldenFingerId')
  @ApiOperation({ summary: 'Update a golden finger' })
  updateGoldenFinger(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('goldenFingerId') goldenFingerId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.worldbuildingService.updateGoldenFinger(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parsePathId(goldenFingerId, 'GOLDEN_FINGER_NOT_FOUND', 'Golden finger not found'),
      this.parseBody(
        goldenFingerUpdateSchema,
        body,
        'Complete the golden finger rules, costs, limits, and growth stages',
      ),
    );
  }

  @Get('items-techniques/:entityId')
  @ApiOperation({ summary: 'Read an item or technique profile and its ownership history' })
  getItemTechniqueProfile(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('entityId') entityId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.worldbuildingService.getItemTechniqueProfile(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parsePathId(entityId, 'SETTING_NOT_FOUND', 'Setting not found'),
    );
  }

  @Put('items-techniques/:entityId')
  @ApiOperation({ summary: 'Save an item or technique profile' })
  saveItemTechniqueProfile(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('entityId') entityId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.worldbuildingService.saveItemTechniqueProfile(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parsePathId(entityId, 'SETTING_NOT_FOUND', 'Setting not found'),
      this.parseBody(
        itemTechniqueProfileInputSchema,
        body,
        'Complete the grade, effects, costs, and restrictions',
      ),
    );
  }

  @Post('items-techniques/:entityId/ownerships')
  @ApiOperation({ summary: 'Assign the current owner of an item or technique' })
  createItemOwnership(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('entityId') entityId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.worldbuildingService.createItemOwnership(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parsePathId(entityId, 'SETTING_NOT_FOUND', 'Setting not found'),
      this.parseBody(itemOwnershipInputSchema, body, 'Choose the owner and when it became theirs'),
    );
  }

  @Patch('items-techniques/:entityId/ownerships/:ownershipId/end')
  @ApiOperation({ summary: 'End an item or technique ownership record' })
  endItemOwnership(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('entityId') entityId: string,
    @Param('ownershipId') ownershipId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.worldbuildingService.endItemOwnership(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parsePathId(entityId, 'SETTING_NOT_FOUND', 'Setting not found'),
      this.parsePathId(ownershipId, 'ITEM_OWNERSHIP_NOT_FOUND', 'Item ownership not found'),
      this.parseBody(endItemOwnershipSchema, body, 'Enter when this ownership ended'),
    );
  }

  @Get('timelines/:entityId')
  @ApiOperation({ summary: 'Read a timeline with its eras and event nodes' })
  getTimeline(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('entityId') entityId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.worldbuildingService.getTimeline(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parsePathId(entityId, 'SETTING_NOT_FOUND', 'Setting not found'),
    );
  }

  @Post('timelines/:entityId/eras')
  @ApiOperation({ summary: 'Create a timeline era' })
  createTimelineEra(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('entityId') entityId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.worldbuildingService.createTimelineEra(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parsePathId(entityId, 'SETTING_NOT_FOUND', 'Setting not found'),
      this.parseBody(timelineEraInputSchema, body, 'Complete the era dates and summary'),
    );
  }

  @Patch('timelines/:entityId/eras/:eraId')
  @ApiOperation({ summary: 'Update a timeline era' })
  updateTimelineEra(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('entityId') entityId: string,
    @Param('eraId') eraId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.worldbuildingService.updateTimelineEra(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parsePathId(entityId, 'SETTING_NOT_FOUND', 'Setting not found'),
      this.parsePathId(eraId, 'TIMELINE_ERA_NOT_FOUND', 'Timeline era not found'),
      this.parseBody(timelineEraUpdateSchema, body, 'Check the era dates and summary'),
    );
  }

  @Post('timelines/:entityId/nodes')
  @ApiOperation({ summary: 'Create a timeline event node' })
  createTimelineNode(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('entityId') entityId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.worldbuildingService.createTimelineNode(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parsePathId(entityId, 'SETTING_NOT_FOUND', 'Setting not found'),
      this.parseBody(timelineNodeInputSchema, body, 'Complete the event time details'),
    );
  }

  @Patch('timelines/:entityId/nodes/:nodeId')
  @ApiOperation({ summary: 'Update a timeline event node' })
  updateTimelineNode(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('entityId') entityId: string,
    @Param('nodeId') nodeId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.worldbuildingService.updateTimelineNode(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parsePathId(entityId, 'SETTING_NOT_FOUND', 'Setting not found'),
      this.parsePathId(nodeId, 'TIMELINE_NODE_NOT_FOUND', 'Timeline event not found'),
      this.parseBody(timelineNodeUpdateSchema, body, 'Check the event time details'),
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
      throw worldbuildingError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        message,
        parsed.error.flatten(),
      );
    }
    return parsed.data;
  }

  private parsePathId(value: string, code: string, message: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw worldbuildingError(HttpStatus.NOT_FOUND, code, message);
    }
    return parsed.data;
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw worldbuildingError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');
    }
    return request.auth.user.id;
  }
}
