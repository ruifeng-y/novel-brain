import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createModelConfigSchema,
  modelConfigIdSchema,
  updateModelConfigSchema,
} from '@novel/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ModelConfigService } from './model-config.service';
import { modelConfigError } from './model-configs.errors';

@ApiTags('model-configs')
@Controller('model-configs')
@UseGuards(SessionAuthGuard)
export class ModelConfigsController {
  constructor(private readonly modelConfigs: ModelConfigService) {}

  @Get()
  @ApiOperation({ summary: 'List the signed-in author model configurations' })
  list(@Req() request: AuthenticatedRequest) {
    return this.modelConfigs.list(this.requireUserId(request));
  }

  @Post()
  @ApiOperation({ summary: 'Create a model configuration' })
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = createModelConfigSchema.safeParse(body);
    if (!parsed.success) {
      throw modelConfigError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Complete the model configuration details',
        parsed.error.flatten(),
      );
    }

    return this.modelConfigs.create(this.requireUserId(request), parsed.data);
  }

  @Get(':configId')
  @ApiOperation({ summary: 'Read a model configuration' })
  get(@Param('configId') configId: string, @Req() request: AuthenticatedRequest) {
    return this.modelConfigs.get(
      this.requireUserId(request),
      this.parseConfigId(configId),
    );
  }

  @Patch(':configId')
  @ApiOperation({ summary: 'Update a model configuration' })
  update(
    @Param('configId') configId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = updateModelConfigSchema.safeParse(body);
    if (!parsed.success) {
      throw modelConfigError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Complete the model configuration details',
        parsed.error.flatten(),
      );
    }

    return this.modelConfigs.update(
      this.requireUserId(request),
      this.parseConfigId(configId),
      parsed.data,
    );
  }

  @Delete(':configId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a model configuration' })
  async remove(
    @Param('configId') configId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.modelConfigs.remove(
      this.requireUserId(request),
      this.parseConfigId(configId),
    );
  }

  @Post(':configId/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test a saved model connection' })
  test(@Param('configId') configId: string, @Req() request: AuthenticatedRequest) {
    return this.modelConfigs.testConnection(
      this.requireUserId(request),
      this.parseConfigId(configId),
    );
  }

  private parseConfigId(value: string): string {
    const parsed = modelConfigIdSchema.safeParse(value);
    if (!parsed.success) {
      throw modelConfigError(
        HttpStatus.NOT_FOUND,
        'MODEL_CONFIG_NOT_FOUND',
        'Model configuration not found',
      );
    }
    return parsed.data;
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw modelConfigError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Sign in to continue',
      );
    }
    return request.auth.user.id;
  }
}
