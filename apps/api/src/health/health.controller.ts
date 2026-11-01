import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  getLiveness() {
    return this.healthService.checkLiveness();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  getReadiness() {
    return this.healthService.checkReadiness();
  }
}
