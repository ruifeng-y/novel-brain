import { randomBytes } from "node:crypto";

import { ACCOUNT_PURGE_JOB } from "@novel-brain/contracts";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AccountPurgeProcessor } from "../src/account-lifecycle/account-purge.processor";
import { WorkerAccountPurgeRepository } from "../src/account-lifecycle/account-purge.repository";

const databaseUrl = dedicatedDatabaseUrl(
  process.env.TEST_DATABASE_URL ??
    "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_test",
);

describe("account purge worker integration", () => {
  let pool: ReturnType<typeof createDatabasePool>;
  let processor: AccountPurgeProcessor;
  let purgeRepository: WorkerAccountPurgeRepository;

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.DATABASE_QUERY_TIMEOUT_MS = "10000";
    await runMigrations(databaseUrl);
    pool = createDatabasePool(databaseUrl);
    process.env.DATABASE_QUERY_TIMEOUT_MS = "250";
    purgeRepository = new WorkerAccountPurgeRepository();
    processor = new AccountPurgeProcessor(purgeRepository);
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE deletion_requests, users CASCADE");
  });

  afterAll(async () => {
    await purgeRepository?.onModuleDestroy();
    await pool?.end();
    await dropDatabase(databaseUrl);
  });

  it("permanently deletes every account store and retains a completed report", async () => {
    const fixture = await seedDeletionFixture(pool);

    await processor.process({
      jobType: ACCOUNT_PURGE_JOB,
      deletionRequestId: fixture.deletionRequestId,
      idempotencyKey: `account-purge-${fixture.deletionRequestId}`,
      workId: null,
      branchId: null,
      checkpoint: {
        schemaVersion: 1,
        revision: 0,
        step: "prepare",
      },
    });

    const state = await inspectDeletion(pool, fixture.deletionRequestId);
    expect(state.userId).toBeNull();
    expect(state.exportReceiptId).toBeNull();
    expect(state.status).toBe("completed");
    expect(state.failure).toBeNull();
    expect(state.stores).toEqual(
      expect.arrayContaining([
        { store: "users", rowCount: 1, status: "deleted", retryable: false, errorCode: null },
        { store: "works", rowCount: 1, status: "deleted", retryable: false, errorCode: null },
        { store: "chapters", rowCount: 1, status: "deleted", retryable: false, errorCode: null },
        {
          store: "model_configs",
          rowCount: 1,
          status: "deleted",
          retryable: false,
          errorCode: null,
        },
      ]),
    );
    expect(
      new Date(state.backupExpiresAt).getTime() - new Date(state.purgeAfter).getTime(),
    ).toBeLessThanOrEqual(30 * 86_400_000);
    const remaining = await pool.query<{ count: number }>(
      `SELECT (
         (SELECT count(*) FROM users) +
         (SELECT count(*) FROM works) +
         (SELECT count(*) FROM work_branches) +
         (SELECT count(*) FROM chapters) +
         (SELECT count(*) FROM model_configs) +
         (SELECT count(*) FROM export_receipts)
       )::int AS count`,
    );
    expect(remaining.rows[0]?.count).toBe(0);
  });

  it("reports a retryable store failure and succeeds when the lock is released", async () => {
    const fixture = await seedDeletionFixture(pool);
    const lock = await pool.connect();
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT set_config('app.user_id', $1, true)", [fixture.userId]);
      await lock.query("SELECT id FROM works WHERE id = $1 FOR UPDATE", [fixture.workId]);

      await expect(
        processor.process({
          jobType: ACCOUNT_PURGE_JOB,
          deletionRequestId: fixture.deletionRequestId,
          idempotencyKey: `account-purge-${fixture.deletionRequestId}`,
          workId: null,
          branchId: null,
          checkpoint: {
            schemaVersion: 1,
            revision: 0,
            step: "prepare",
          },
        }),
      ).rejects.toThrow("ACCOUNT_PURGE_RETRYABLE");

      const failed = await inspectDeletion(pool, fixture.deletionRequestId);
      expect(failed.status).toBe("failed");
      expect(failed.failure).toMatchObject({
        code: "ACCOUNT_PURGE_RETRYABLE",
        retryable: true,
      });
      expect(failed.stores).toEqual(
        expect.arrayContaining([
          {
            store: "works",
            rowCount: 1,
            status: "failed",
            retryable: true,
            errorCode: "STORE_DELETE_TIMEOUT",
          },
          {
            store: "users",
            rowCount: 1,
            status: "pending",
            retryable: false,
            errorCode: null,
          },
          {
            store: "chapters",
            rowCount: 1,
            status: "pending",
            retryable: false,
            errorCode: null,
          },
        ]),
      );
      const retained = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM users WHERE id = $1",
        [fixture.userId],
      );
      expect(retained.rows[0]?.count).toBe(1);
    } finally {
      await lock.query("ROLLBACK").catch(() => undefined);
      lock.release();
    }

    await processor.process({
      jobType: ACCOUNT_PURGE_JOB,
      deletionRequestId: fixture.deletionRequestId,
      idempotencyKey: `account-purge-${fixture.deletionRequestId}`,
      workId: null,
      branchId: null,
      checkpoint: {
        schemaVersion: 1,
        revision: 0,
        step: "prepare",
      },
    });
    const completed = await inspectDeletion(pool, fixture.deletionRequestId);
    expect(completed.status).toBe("completed");
    expect(completed.failure).toBeNull();
  });

  it("deletes expired account export payloads while retaining unexpired receipts", async () => {
    const fixture = await seedDeletionFixture(pool);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [fixture.userId]);
      await client.query(
        `INSERT INTO export_receipts
           (id, user_id, inventory_version, checksum, byte_size, inventory, payload, expires_at)
         VALUES ($1, $2, 'account-export-v1', $3, 2, '[]'::jsonb, 'expired', now() - interval '1 day')`,
        [uuidv7(), fixture.userId, "b".repeat(64)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    await expect(processor.cleanupExpiredExportReceipts()).resolves.toBe(1);
    const remaining = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM export_receipts",
    );
    expect(remaining.rows[0]?.count).toBe(1);
  });
});

async function seedDeletionFixture(pool: ReturnType<typeof createDatabasePool>) {
  const userId = uuidv7();
  const workId = uuidv7();
  const branchId = uuidv7();
  const chapterId = uuidv7();
  const exportReceiptId = uuidv7();
  const deletionRequestId = uuidv7();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    await client.query(
      `INSERT INTO users (id, email, password_hash, display_name)
       VALUES ($1, 'purge@example.com', 'hash', '待删除作者')`,
      [userId],
    );
    await client.query(
      `INSERT INTO works (id, user_id, title, pen_name, genre, source_mode)
       VALUES ($1, $2, '待删除作品', '青舟', 'xianxia', 'blank')`,
      [workId, userId],
    );
    await client.query(
      `INSERT INTO work_branches (id, work_id, user_id, name)
       VALUES ($1, $2, $3, '主线')`,
      [branchId, workId, userId],
    );
    await client.query(
      `INSERT INTO chapters (id, work_id, branch_id, user_id, number, title)
       VALUES ($1, $2, $3, $4, 1, '第一章')`,
      [chapterId, workId, branchId, userId],
    );
    await client.query(
      `INSERT INTO model_configs
         (id, user_id, provider, label, base_url, model, purposes, encrypted_key, key_masked)
       VALUES ($1, $2, 'deepseek', '主模型', 'https://api.deepseek.com',
               'deepseek-chat', '["writing"]'::jsonb, 'encrypted', '****1234')`,
      [uuidv7(), userId],
    );
    await client.query(
      `INSERT INTO export_receipts
         (id, user_id, inventory_version, checksum, byte_size, inventory, payload, expires_at)
       VALUES ($1, $2, 'account-export-v1', $3, 2, '[]'::jsonb, '{}', now() + interval '1 day')`,
      [exportReceiptId, userId, "a".repeat(64)],
    );
    await client.query(
      `INSERT INTO deletion_requests
         (id, user_id, export_receipt_id, status, requested_at, recoverable_until,
          purge_after, backup_expires_at)
       VALUES ($1, $2, $3, 'recovery_pending', now() - interval '31 days',
               now() - interval '1 day', now() - interval '1 minute',
               now() + interval '29 days')`,
      [deletionRequestId, userId, exportReceiptId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { userId, workId, deletionRequestId };
}

async function inspectDeletion(
  pool: ReturnType<typeof createDatabasePool>,
  deletionRequestId: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.system_role', 'account_deletion', true)");
    const result = await client.query<{
      user_id: string | null;
      export_receipt_id: string | null;
      status: string;
      purge_after: Date;
      backup_expires_at: Date;
      failure: Record<string, unknown> | null;
      store_results: Array<{
        store: string;
        rowCount: number;
        status: string;
        retryable: boolean;
        errorCode: string | null;
      }>;
    }>(
      `SELECT user_id, export_receipt_id, status, purge_after, backup_expires_at,
              failure, store_results
         FROM deletion_requests
        WHERE id = $1`,
      [deletionRequestId],
    );
    await client.query("COMMIT");
    const row = result.rows[0];
    if (!row) {
      throw new Error("Deletion request is missing");
    }
    return {
      userId: row.user_id,
      exportReceiptId: row.export_receipt_id,
      status: row.status,
      purgeAfter: row.purge_after.toISOString(),
      backupExpiresAt: row.backup_expires_at.toISOString(),
      failure: row.failure,
      stores: row.store_results,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function dedicatedDatabaseUrl(baseUrl: string): string {
  const target = new URL(baseUrl);
  target.pathname = `/novelbrain_test_account_purge_${randomBytes(4).toString("hex")}`;
  return target.toString();
}

async function ensureDatabaseExists(url: string): Promise<void> {
  const target = new URL(url);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  if (!databaseName || databaseName === "postgres") {
    throw new Error("TEST_DATABASE_URL must name a dedicated test database");
  }
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const adminPool = createDatabasePool(adminUrl.toString());
  try {
    await adminPool.query(`CREATE DATABASE "${databaseName.replaceAll('"', '""')}"`);
  } catch (error) {
    if (!(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "42P04"
    )) {
      throw error;
    }
  } finally {
    await adminPool.end();
  }
}

async function dropDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  target.pathname = "/postgres";
  const adminPool = createDatabasePool(target.toString(), {
    query_timeout: 0,
    statement_timeout: 0,
  });
  try {
    await adminPool.query(
      `DROP DATABASE IF EXISTS "${databaseName.replaceAll('"', '""')}" WITH (FORCE)`,
    );
  } finally {
    await adminPool.end();
  }
}
