import { randomBytes } from "node:crypto";

import { createDatabasePool, runMigrations } from "@novel-brain/db";
import { uuidv7 } from "uuidv7";
import { afterAll, describe, expect, it } from "vitest";

import { auditTenantRls } from "../../../scripts/audit-tenant-rls.mjs";

const databaseUrl = dedicatedDatabaseUrl(
  process.env.TEST_DATABASE_URL ??
    "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_test",
);

describe("tenant RLS audit", () => {
  afterAll(async () => {
    await dropDatabase(databaseUrl);
  });

  it("reports every tenant table as RLS-enabled, forced and policy-covered", async () => {
    await ensureDatabaseExists(databaseUrl);
    await runMigrations(databaseUrl);
    const pool = createDatabasePool(databaseUrl);
    try {
      const inventory = await auditTenantRls(pool);
      expect(inventory.uncovered).toEqual([]);
      expect(inventory.tables.length).toBeGreaterThan(50);
    } finally {
      await pool.end();
    }
  });

  it("fails closed when user context is missing", async () => {
    const pool = createDatabasePool(databaseUrl);
    try {
      const result = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM works",
      );
      expect(result.rows[0]?.count).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it("does not leak transaction-local user context through the pool", async () => {
    const pool = createDatabasePool(databaseUrl);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [uuidv7()]);
      const inside = await client.query<{ user_id: string }>(
        "SELECT current_setting('app.user_id', true) AS user_id",
      );
      expect(inside.rows[0]?.user_id).not.toBe("");
      await client.query("COMMIT");
      const outside = await client.query<{ user_id: string | null }>(
        "SELECT NULLIF(current_setting('app.user_id', true), '') AS user_id",
      );
      expect(outside.rows[0]?.user_id).toBeNull();
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("isolates work blueprints between authors", async () => {
    await ensureDatabaseExists(databaseUrl);
    await runMigrations(databaseUrl);
    const pool = createDatabasePool(databaseUrl);
    const ownerId = uuidv7();
    const outsiderId = uuidv7();
    const workId = uuidv7();
    const branchId = uuidv7();
    const jobId = uuidv7();
    const blueprintId = uuidv7();
    try {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, display_name)
         VALUES ($1, $3, 'hash', '作者'), ($2, $4, 'hash', '其他作者')`,
        [ownerId, outsiderId, `${ownerId}@example.com`, `${outsiderId}@example.com`],
      );

      const owner = await pool.connect();
      try {
        await owner.query("BEGIN");
        await owner.query("SELECT set_config('app.user_id', $1, true)", [ownerId]);
        await owner.query(
          `INSERT INTO works
             (id, user_id, title, pen_name, genre, source_mode, settings)
           VALUES ($1, $2, '蓝图隔离', '作者', 'xianxia', 'idea', '{}'::jsonb)`,
          [workId, ownerId],
        );
        await owner.query(
          `INSERT INTO work_branches (id, work_id, user_id, name)
           VALUES ($1, $2, $3, 'main')`,
          [branchId, workId, ownerId],
        );
        await owner.query(
          `INSERT INTO jobs
             (id, work_id, branch_id, user_id, type, idempotency_key, budget, checkpoint, cost)
           VALUES ($1, $2, $3, $4, 'generate_blueprint', $5,
                   '{"maxTokens":20000,"maxCostCny":0.1}'::jsonb,
                   '{"step":"prepare"}'::jsonb,
                   '{"inputTokens":0,"outputTokens":0,"totalTokens":0,"costCny":0}'::jsonb)`,
          [jobId, workId, branchId, ownerId, `blueprint-${jobId}`],
        );
        await owner.query(
          `INSERT INTO work_blueprints
             (id, work_id, branch_id, user_id, job_id, input_hash, estimate)
           VALUES ($1, $2, $3, $4, $5, $6,
                   '{"ruleVersion":"blueprint-estimate-v1","planned":{"volumes":1,"chapters":12,"scenes":24},"estimatedTokens":40000,"estimatedCostCny":0.08,"defaultBudget":{"maxTokens":48000,"maxCostCny":0.5},"assumptions":["测试"]}'::jsonb)`,
          [blueprintId, workId, branchId, ownerId, jobId, "a".repeat(64)],
        );
        await owner.query("COMMIT");
      } catch (error) {
        await owner.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        owner.release();
      }

      const rls = await pool.query<{ enabled: boolean; forced: boolean }>(
        `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
           FROM pg_class
          WHERE oid = 'work_blueprints'::regclass`,
      );
      expect(rls.rows[0]).toEqual({ enabled: true, forced: true });
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'novelbrain_blueprints_rls_test') THEN
            CREATE ROLE novelbrain_blueprints_rls_test NOLOGIN NOSUPERUSER NOBYPASSRLS;
          END IF;
        END
        $$;
      `);
      await pool.query(
        "GRANT USAGE ON SCHEMA public TO novelbrain_blueprints_rls_test; GRANT SELECT, UPDATE ON work_blueprints TO novelbrain_blueprints_rls_test",
      );
      expect(await countVisibleBlueprints(pool, ownerId, blueprintId)).toBe(1);
      expect(await countVisibleBlueprints(pool, outsiderId, blueprintId)).toBe(0);
      expect(await updateVisibleBlueprint(pool, outsiderId, blueprintId)).toBe(0);
      expect(await updateVisibleBlueprint(pool, ownerId, blueprintId)).toBe(1);
    } finally {
      await pool.end();
    }
  });
});

async function countVisibleBlueprints(
  pool: ReturnType<typeof createDatabasePool>,
  userId: string,
  blueprintId: string,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE novelbrain_blueprints_rls_test");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const context = await client.query<{ user_id: string }>(
      "SELECT current_setting('app.user_id', true) AS user_id",
    );
    expect(context.rows[0]?.user_id).toBe(userId);
    const result = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM work_blueprints WHERE id = $1",
      [blueprintId],
    );
    await client.query("COMMIT");
    return result.rows[0]?.count ?? 0;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function updateVisibleBlueprint(
  pool: ReturnType<typeof createDatabasePool>,
  userId: string,
  blueprintId: string,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE novelbrain_blueprints_rls_test");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await client.query(
      "UPDATE work_blueprints SET updated_at = now() WHERE id = $1",
      [blueprintId],
    );
    await client.query("COMMIT");
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
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

function dedicatedDatabaseUrl(baseUrl: string): string {
  const target = new URL(baseUrl);
  target.pathname = `/novelbrain_test_tenant_rls_${randomBytes(4).toString("hex")}`;
  return target.toString();
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
