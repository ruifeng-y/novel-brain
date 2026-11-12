import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { Pool } from "pg";

const TENANT_COLUMNS = ["user_id", "work_id", "branch_id"];

export async function auditTenantRls(pool) {
  const tableRows = (
    await pool.query(
      `SELECT table_name,
              jsonb_agg(column_name ORDER BY column_name) AS tenant_columns
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name = ANY($1::text[])
       GROUP BY table_name
       ORDER BY table_name`,
      [TENANT_COLUMNS],
    )
  ).rows;
  const policyRows = (
    await pool.query(
      `SELECT tablename, policyname, cmd, qual, with_check
       FROM pg_policies
       WHERE schemaname = 'public'
       ORDER BY tablename, policyname`,
    )
  ).rows;
  const policiesByTable = new Map();
  for (const policy of policyRows) {
    const policies = policiesByTable.get(policy.tablename) ?? [];
    policies.push(policy);
    policiesByTable.set(policy.tablename, policies);
  }

  const tables = [];
  for (const row of tableRows) {
    const relation = (
      await pool.query(
        `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class
         WHERE oid = $1::regclass`,
        [`public.${row.table_name}`],
      )
    ).rows[0];
    const columns = row.tenant_columns;
    const ownershipKey = columns.includes("user_id")
      ? "user_id"
      : columns.includes("work_id")
        ? "work_id"
        : "branch_id";
    const policies = policiesByTable.get(row.table_name) ?? [];
    const policyCoversOwnership = policies.some((policy) =>
      `${policy.qual ?? ""} ${policy.with_check ?? ""}`.includes(ownershipKey),
    );
    const covered =
      Boolean(relation?.relrowsecurity) &&
      Boolean(relation?.relforcerowsecurity) &&
      policies.length > 0 &&
      policyCoversOwnership;
    tables.push({
      table: row.table_name,
      tenantColumns: columns,
      ownershipKey,
      rlsEnabled: Boolean(relation?.relrowsecurity),
      rlsForced: Boolean(relation?.relforcerowsecurity),
      policies: policies.map((policy) => ({
        name: policy.policyname,
        command: policy.cmd,
        using: policy.qual,
        withCheck: policy.with_check,
      })),
      covered,
    });
  }

  return {
    scope: "public tables with user_id, work_id or branch_id",
    tables,
    uncovered: tables.filter((table) => !table.covered),
  };
}

async function main() {
  const databaseUrl =
    process.env.TENANT_RLS_DATABASE_URL ??
    process.env.TEST_DATABASE_URL ??
    process.env.E2E_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("TENANT_RLS_DATABASE_URL, TEST_DATABASE_URL or E2E_DATABASE_URL is required");
  }
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const inventory = await auditTenantRls(pool);
    const outputIndex = process.argv.indexOf("--output");
    if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
      await writeFile(process.argv[outputIndex + 1], `${JSON.stringify(inventory, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
    if (inventory.uncovered.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
