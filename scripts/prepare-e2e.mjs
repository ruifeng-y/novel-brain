import { createRequire } from "node:module";
import { Pool } from "pg";

const require = createRequire(import.meta.url);
const { runMigrations } = require("../packages/db/dist/migrations.js");

const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_e2e";

await ensureDatabase(databaseUrl);
await runMigrations(databaseUrl);
console.log(JSON.stringify({ event: "e2e.database.ready" }));

async function ensureDatabase(url) {
  const target = new URL(url);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  if (!databaseName || databaseName === "postgres") {
    throw new Error("E2E_DATABASE_URL must name a dedicated E2E database");
  }
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const pool = new Pool({ connectionString: adminUrl.toString() });
  try {
    await pool.query(`CREATE DATABASE "${databaseName.replaceAll('"', '""')}"`);
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
    await pool.end();
  }
}
