import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpStatus,
  Param,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  characterPresenceCreateSchema,
  mapMarkerCreateSchema,
  mapConnectionCreateSchema,
  mapNodeCreateSchema,
  workIdSchema,
} from '@novel/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { mapsError } from './maps.errors';
import { MapsService } from './maps.service';

type ParseResult<T> =
  { success: true; data: T } | { success: false; error: { flatten: () => unknown } };

type UploadedImage = {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
};

@ApiTags('maps')
@Controller('works/:workId/branches/:branchId/maps')
@UseGuards(SessionAuthGuard)
export class MapsController {
  constructor(private readonly mapsService: MapsService) {}

  @Get()
  @ApiOperation({ summary: 'Read the place tree and travel connections' })
  overview(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.mapsService.overview(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
    );
  }

  @Get('nodes')
  @ApiOperation({ summary: 'List place nodes' })
  listNodes(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.mapsService.listNodes(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
    );
  }

  @Post('nodes')
  @ApiOperation({ summary: 'Create a place node' })
  createNode(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.mapsService.createNode(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseBody(mapNodeCreateSchema, body, 'Complete the place details'),
    );
  }

  @Get('connections')
  @ApiOperation({ summary: 'List travel connections' })
  listConnections(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.mapsService.listConnections(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
    );
  }

  @Post('connections')
  @ApiOperation({ summary: 'Connect two places with a travel time' })
  createConnection(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.mapsService.createConnection(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseBody(mapConnectionCreateSchema, body, 'Complete the connection details'),
    );
  }

  @Post('images')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Upload and attach a map image to a place' })
  uploadImage(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body('nodeId') nodeId: string | undefined,
    @UploadedFile() file: UploadedImage | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.mapsService.uploadImage(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseNodeId(nodeId),
      file,
    );
  }

  @Get('images/:imageId/content')
  @Header('Cache-Control', 'private, max-age=300')
  @ApiOperation({ summary: 'Read an authenticated map image' })
  async imageContent(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('imageId') imageId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const image = await this.mapsService.getImageContent(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseId(imageId),
    );
    return new StreamableFile(image.buffer, { type: image.mimeType });
  }

  @Post('images/:imageId/markers')
  @ApiOperation({ summary: 'Place a marker on a map image' })
  createMarker(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('imageId') imageId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.mapsService.createMarker(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseId(imageId),
      this.parseBody(mapMarkerCreateSchema, body, 'Choose a point on the map image'),
    );
  }

  @Get('presences')
  @ApiOperation({ summary: 'List where characters are at story times' })
  listPresences(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.mapsService.listPresences(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
    );
  }

  @Post('presences')
  @ApiOperation({ summary: 'Record a character at a place for a story time' })
  createPresence(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.mapsService.createPresence(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseBody(characterPresenceCreateSchema, body, 'Complete the location record'),
    );
  }

  @Delete('presences/:presenceId')
  @ApiOperation({ summary: 'Remove a character location record' })
  deletePresence(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('presenceId') presenceId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.mapsService.deletePresence(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseId(presenceId),
    );
  }

  @Get('conflicts')
  @ApiOperation({ summary: 'Find characters recorded in two places at once' })
  listConflicts(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.mapsService.listConflicts(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
    );
  }

  private parseBody<T>(
    schema: { safeParse: (body: unknown) => ParseResult<T> },
    body: unknown,
    message: string,
  ): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw mapsError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', message, parsed.error.flatten());
    }
    return parsed.data;
  }

  private parseId(value: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw mapsError(HttpStatus.NOT_FOUND, 'MAP_NOT_FOUND', 'Map not found');
    }
    return parsed.data;
  }

  private parseNodeId(value: string | undefined): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw mapsError(HttpStatus.BAD_REQUEST, 'MAP_NODE_NOT_FOUND', 'Choose a place');
    }
    return parsed.data;
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw mapsError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');
    }
    return request.auth.user.id;
  }
}
