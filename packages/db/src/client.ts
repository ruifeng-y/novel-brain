import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema";

export type DatabaseClient = NodePgDatabase<typeof schema>;

export function createDatabasePool(databaseUrl: string, overrides: Partial<PoolConfig> = {}): Pool {
  const queryTimeout = databaseQueryTimeoutMs();
  return new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 10_000,
    max: 10,
    query_timeout: queryTimeout,
    statement_timeout: queryTimeout,
    ...overrides,
  });
}

export function createDatabaseClient(pool: Pool): DatabaseClient {
  return drizzle(pool, { schema });
}

function databaseQueryTimeoutMs(): number {
  const configured = Number(process.env.DATABASE_QUERY_TIMEOUT_MS ?? "2000");
  return Number.isFinite(configured) && configured > 0 ? configured : 2_000;
}
