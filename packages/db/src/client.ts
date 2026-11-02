import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool, type PoolClient } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  pool: Pool;
  db: Database;
}

export function createDatabase(connectionString: string): DatabaseConnection {
  const pool = new Pool({ connectionString });
  const db = createDatabaseClient(pool);
  return { pool, db };
}

export function createDatabaseClient(client: Pool | PoolClient): Database {
  return drizzle(client, { schema });
}

export function createScopedDatabase(client: PoolClient): Database {
  serializeClientQueries(client);
  const db = createDatabaseClient(client) as Database;
  let depth = 0;

  Object.defineProperty(db, 'transaction', {
    configurable: true,
    value: async <T>(callback: (tx: Database) => Promise<T>): Promise<T> => {
      const savepoint = `request_sp_${++depth}`;
      await db.execute(sql.raw(`savepoint ${savepoint}`));
      try {
        const result = await callback(db);
        await db.execute(sql.raw(`release savepoint ${savepoint}`));
        return result;
      } catch (error) {
        await db.execute(sql.raw(`rollback to savepoint ${savepoint}`));
        throw error;
      } finally {
        depth -= 1;
      }
    },
  });

  return db;
}

const SERIALIZED_QUERY = Symbol.for('novel.database.serializedQuery');

function serializeClientQueries(client: PoolClient): void {
  const marked = client as PoolClient & { [SERIALIZED_QUERY]?: true };
  if (marked[SERIALIZED_QUERY]) {
    return;
  }

  const originalQuery = client.query.bind(client);
  let queue: Promise<unknown> = Promise.resolve();
  marked[SERIALIZED_QUERY] = true;
  (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
    const execute = () => (originalQuery as (...values: unknown[]) => unknown)(...args);
    const callback = args.at(-1);
    if (typeof callback === 'function') {
      queue = queue.then(execute, execute);
      return undefined;
    }
    const result = queue.then(execute, execute);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
