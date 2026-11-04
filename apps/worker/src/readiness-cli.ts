import "reflect-metadata";

import {
  WORKER_QUEUE_NAME,
  workerReadinessDataSchema,
  type DependencyCheck,
} from "@novel-brain/contracts";
import { elapsedMilliseconds } from "@novel-brain/core";
import { createDatabasePool } from "@novel-brain/db";
import { Queue } from "bullmq";
import Redis from "ioredis";

import { evaluateWorkerReadiness } from "./readiness";

async function checkDatabase(databaseUrl: string): Promise<DependencyCheck> {
  const pool = createDatabasePool(databaseUrl);
  const startedAt = process.hrtime.bigint();

  try {
    await pool.query("SELECT 1");
    return {
      name: "database",
      status: "up",
      latencyMs: elapsedMilliseconds(startedAt),
    };
  } catch {
    return {
      name: "database",
      status: "down",
      latencyMs: elapsedMilliseconds(startedAt),
    };
  } finally {
    await pool.end();
  }
}

async function checkQueue(
  redisUrl: string,
): Promise<{ check: DependencyCheck; workerCount: number }> {
  const startedAt = process.hrtime.bigint();
  const connection = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 2_000,
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => (attempt > 1 ? null : 200),
  });
  connection.on("error", () => undefined);
  const queue = new Queue(WORKER_QUEUE_NAME, { connection });

  try {
    await connection.ping();
    await queue.waitUntilReady();
    const workers = await queue.getWorkers();

    return {
      check: {
        name: "queue",
        status: "up",
        latencyMs: elapsedMilliseconds(startedAt),
      },
      workerCount: workers.length,
    };
  } catch {
    return {
      check: {
        name: "queue",
        status: "down",
        latencyMs: elapsedMilliseconds(startedAt),
      },
      workerCount: 0,
    };
  } finally {
    await queue.close();
    if (connection.status === "ready") {
      await connection.quit();
    } else {
      connection.disconnect();
    }
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!databaseUrl || !redisUrl) {
    throw new Error("DATABASE_URL and REDIS_URL are required");
  }

  const [database, queue] = await Promise.all([checkDatabase(databaseUrl), checkQueue(redisUrl)]);
  const report = workerReadinessDataSchema.parse(
    evaluateWorkerReadiness({
      database,
      queue: queue.check,
      workerCount: queue.workerCount,
    }),
  );

  console.log(JSON.stringify(report));
  if (report.status !== "ready") {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown readiness error";
  console.error(JSON.stringify({ event: "worker.readiness.failed", message }));
  process.exitCode = 1;
});
