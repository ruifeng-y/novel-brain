import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type DatabaseClient = NodePgDatabase<typeof schema>;

export function createDatabasePool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 10_000,
    max: 10,
    query_timeout: 2_000,
    statement_timeout: 2_000,
  });
}

export function createDatabaseClient(pool: Pool): DatabaseClient {
  return drizzle(pool, { schema });
}
