import path from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabaseClient, createDatabasePool } from "./client";

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = createDatabasePool(databaseUrl);
  const database = createDatabaseClient(pool);

  try {
    await migrate(database, {
      migrationsFolder: path.join(__dirname, "../migrations"),
    });
  } finally {
    await pool.end();
  }
}
