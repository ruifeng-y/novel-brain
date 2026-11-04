import path from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabaseClient, createDatabasePool } from "./client";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = createDatabasePool(databaseUrl);
  const database = createDatabaseClient(pool);

  try {
    await migrate(database, {
      migrationsFolder: path.join(__dirname, "../migrations"),
    });
    console.log(JSON.stringify({ event: "database.migrations.completed" }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown migration error";
  console.error(JSON.stringify({ event: "database.migrations.failed", message }));
  process.exitCode = 1;
});
