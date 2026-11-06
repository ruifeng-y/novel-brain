import { sql } from "drizzle-orm";

import type { DatabaseClient } from "./client";

export type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export async function withTenantTransaction<T>(
  db: DatabaseClient,
  userId: string,
  operation: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return operation(transaction);
  });
}
