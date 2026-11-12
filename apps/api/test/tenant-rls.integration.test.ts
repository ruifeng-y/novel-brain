import { createDatabasePool, runMigrations } from "@novel-brain/db";
import { uuidv7 } from "uuidv7";
import { describe, expect, it } from "vitest";

import { auditTenantRls } from "../../../scripts/audit-tenant-rls.mjs";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_test";

describe("tenant RLS audit", () => {
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
});

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
