import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  pool: Pool;
  db: Database;
}

export function createDatabase(connectionString: string): DatabaseConnection {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
