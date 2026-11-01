import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HealthController } from '../src/health/health.controller';
import { HealthService } from '../src/health/health.service';

async function createApp(healthService: object): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: HealthService, useValue: healthService }],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
  return app;
}

describe('health API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({
      checkLiveness: () => ({
        status: 'ok',
        service: 'api',
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
      checkReadiness: vi.fn().mockResolvedValue({
        status: 'ok',
        service: 'api',
        checks: { database: 'up', redis: 'up', objectStorage: 'up' },
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns liveness', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('ok');
        expect(body.service).toBe('api');
      });
  });

  it('returns readiness', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200)
      .expect(({ body }) => {
        expect(body.checks).toEqual({
          database: 'up',
          redis: 'up',
          objectStorage: 'up',
        });
      });
  });
});

describe('health API when a dependency is down', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({
      checkLiveness: () => ({
        status: 'ok',
        service: 'api',
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
      checkReadiness: vi
        .fn()
        .mockRejectedValue(
          new ServiceUnavailableException({
            code: 'SERVICE_UNAVAILABLE',
            message: 'One or more dependencies are unavailable',
            details: { checks: { database: 'up', redis: 'down', objectStorage: 'up' } },
            requestId: 'test-request-id',
            timestamp: '2026-01-01T00:00:00.000Z',
          }),
        ),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 503 when readiness fails', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(503)
      .expect(({ body }) => {
        expect(body.code).toBe('SERVICE_UNAVAILABLE');
        expect(body.requestId).toBeTruthy();
      });
  });
});
