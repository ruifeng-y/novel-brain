import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async consume(scope: string, subject: string, limit: number, ttlSeconds: number): Promise<boolean> {
    const key = `rate:${scope}:${createHash('sha256').update(subject).digest('hex')}`;
    const count = Number(
      await this.redis.client.eval(
        `local count = redis.call('INCR', KEYS[1])
         if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
         return count`,
        1,
        key,
        String(ttlSeconds),
      ),
    );
    return count <= limit;
  }
}
