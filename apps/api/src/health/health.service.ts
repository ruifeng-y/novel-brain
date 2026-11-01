import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { HealthCheck } from '@novel/contracts';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  checkLiveness(): HealthCheck {
    return {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    };
  }

  async checkReadiness(): Promise<HealthCheck> {
    const checks: Record<string, 'up' | 'down'> = {
      database: 'down',
      redis: 'down',
      objectStorage: 'down',
    };

    const results = await Promise.allSettled([
      this.database.pool.query('select 1'),
      this.redis.ping(),
      this.checkObjectStorage(),
    ]);

    if (results[0].status === 'fulfilled') {
      checks.database = 'up';
    } else {
      this.logger.warn(`Database readiness failed: ${String(results[0].reason)}`);
    }

    if (results[1].status === 'fulfilled') {
      checks.redis = 'up';
    } else {
      this.logger.warn(`Redis readiness failed: ${String(results[1].reason)}`);
    }

    if (results[2].status === 'fulfilled') {
      checks.objectStorage = 'up';
    } else {
      this.logger.warn(`Object storage readiness failed: ${String(results[2].reason)}`);
    }

    const timestamp = new Date().toISOString();
    if (Object.values(checks).some((value) => value === 'down')) {
      throw new ServiceUnavailableException({
        code: 'SERVICE_UNAVAILABLE',
        message: 'One or more dependencies are unavailable',
        details: { checks },
        requestId: randomUUID(),
        timestamp,
      });
    }

    return {
      status: 'ok',
      service: 'api',
      checks,
      timestamp,
    };
  }

  private async checkObjectStorage(): Promise<void> {
    const endpoint = this.config.get<string>('MINIO_ENDPOINT') ?? 'http://localhost:9000';
    const response = await fetch(`${endpoint}/minio/health/live`, {
      signal: AbortSignal.timeout(2_000),
    });

    if (!response.ok) {
      throw new Error(`MinIO health check failed with status ${response.status}`);
    }
  }
}
