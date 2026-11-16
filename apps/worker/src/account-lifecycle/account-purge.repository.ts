import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { AccountDeletionStoreResult } from "@novel-brain/contracts";
import {
  ACCOUNT_DELETION_SYSTEM_ROLE,
  accountOwnershipPredicate,
  classifyAccountStore,
  quoteSqlIdentifier,
  type AccountStore,
} from "@novel-brain/core";
import { createDatabasePool } from "@novel-brain/db";
import type { Pool, PoolClient } from "pg";

interface DeletionTarget {
  id: string;
  userId: string;
  purgeAfter: Date;
  status: string;
}

export type AccountPurgeResult =
  | { kind: "completed"; stores: AccountDeletionStoreResult[] }
  | {
      kind: "failed";
      failure: { code: string; message: string; retryable: boolean };
      stores: AccountDeletionStoreResult[];
      cause: unknown;
    }
  | { kind: "not_due" | "already_complete" | "not_found" };

@Injectable()
export class WorkerAccountPurgeRepository implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
  }

  async listDueRequestIds(limit = 50): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await setSystemRole(client);
      const result = await client.query<{ id: string }>(
        `SELECT id
           FROM deletion_requests
          WHERE (
              status IN ('recovery_pending', 'failed')
              AND purge_after <= now()
            )
            OR (
              status = 'purging'
              AND updated_at <= now() - interval '15 minutes'
            )
          ORDER BY purge_after
          LIMIT $1`,
        [limit],
      );
      await client.query("COMMIT");
      return result.rows.map((row) => row.id);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async purge(deletionRequestId: string): Promise<AccountPurgeResult> {
    const target = await this.claim(deletionRequestId);
    if (typeof target === "string") {
      return { kind: target };
    }

    const client = await this.pool.connect();
    let currentStore: AccountStore | undefined;
    let stores: AccountDeletionStoreResult[] = [];
    try {
      await client.query("BEGIN");
      await setSystemRole(client);
      await client.query("SELECT set_config('app.user_id', $1, true)", [target.userId]);
      const accountStores = await this.accountStores(client);
      stores = await this.countStores(client, accountStores);
      const remaining = new Map(
        accountStores
          .filter((store) => store.tableName !== "users")
          .map((store) => [store.tableName, store]),
      );

      for (let pass = 0; pass < accountStores.length && remaining.size > 0; pass += 1) {
        let progressed = false;
        for (const store of [...remaining.values()]) {
          currentStore = store;
          try {
            await deleteStore(client, store);
            remaining.delete(store.tableName);
            progressed = true;
          } catch (error) {
            if (isForeignKeyDeferred(error)) {
              continue;
            }
            throw error;
          }
        }
        if (!progressed) {
          break;
        }
      }

      if (remaining.size > 0) {
        const blockedStore = [...remaining.keys()][0] ?? "unknown_store";
        throw new AccountStoreBlockedError(blockedStore);
      }

      currentStore = { tableName: "users", ownership: "self" };
      await deleteStore(client, currentStore);
      await client.query(
        `UPDATE deletion_requests
            SET status = 'completed',
                completed_at = now(),
                failure = NULL,
                store_results = $2::jsonb,
                updated_at = now()
          WHERE id = $1`,
        [target.id, JSON.stringify(stores)],
      );
      await client.query("COMMIT");
      return { kind: "completed", stores };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const failedStore =
        error instanceof AccountStoreBlockedError
          ? error.store
          : (currentStore?.tableName ?? "unknown_store");
      const errorCode =
        error instanceof AccountStoreBlockedError
          ? "STORE_FOREIGN_KEY_PENDING"
          : databaseErrorCode(error) === "57014"
            ? "STORE_DELETE_TIMEOUT"
            : "STORE_DELETE_FAILED";
      stores = stores.map((store) =>
        store.store === failedStore
          ? { ...store, status: "failed", retryable: true, errorCode }
          : store,
      );
      const failure = {
        code: "ACCOUNT_PURGE_RETRYABLE",
        message: `账号永久删除未完成：${failedStore}`,
        retryable: true,
      };
      await this.markFailed(target.id, failure, stores);
      return { kind: "failed", failure, stores, cause: error };
    } finally {
      client.release();
    }
  }

  private async claim(
    deletionRequestId: string,
  ): Promise<DeletionTarget | "not_found" | "not_due" | "already_complete"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await setSystemRole(client);
      const [target] = (
        await client.query<DeletionTarget>(
          `SELECT id, user_id AS "userId", purge_after AS "purgeAfter", status
             FROM deletion_requests
            WHERE id = $1
            FOR UPDATE`,
          [deletionRequestId],
        )
      ).rows;
      if (!target) {
        await client.query("ROLLBACK");
        return "not_found";
      }
      if (target.status === "completed" || target.status === "recovered" || !target.userId) {
        await client.query("COMMIT");
        return "already_complete";
      }
      if (target.purgeAfter.getTime() > Date.now()) {
        await client.query("COMMIT");
        return "not_due";
      }
      await client.query(
        `UPDATE deletion_requests
            SET status = 'purging',
                failure = NULL,
                updated_at = now()
          WHERE id = $1`,
        [target.id],
      );
      await client.query("COMMIT");
      return target;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async accountStores(client: PoolClient): Promise<AccountStore[]> {
    const result = await client.query<{ table_name: string; columns: string[] }>(
      `SELECT table_name, jsonb_agg(column_name ORDER BY column_name) AS columns
         FROM information_schema.columns
        WHERE table_schema = 'public'
        GROUP BY table_name
        ORDER BY table_name`,
    );
    return result.rows.flatMap((row) => {
      if (row.table_name === "deletion_requests") {
        return [];
      }
      const store = classifyAccountStore(row.table_name, row.columns);
      return store ? [store] : [];
    });
  }

  private async countStores(
    client: PoolClient,
    stores: AccountStore[],
  ): Promise<AccountDeletionStoreResult[]> {
    const results: AccountDeletionStoreResult[] = [];
    for (const store of stores) {
      const result = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM ${quoteSqlIdentifier(store.tableName)} AS t
          WHERE ${accountOwnershipPredicate(store.ownership)}`,
      );
      results.push({
        store: store.tableName,
        rowCount: result.rows[0]?.count ?? 0,
        status: "deleted",
        retryable: false,
        errorCode: null,
      });
    }
    return results;
  }

  private async markFailed(
    deletionRequestId: string,
    failure: { code: string; message: string; retryable: boolean },
    stores: AccountDeletionStoreResult[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await setSystemRole(client);
      await client.query(
        `UPDATE deletion_requests
            SET status = 'failed',
                failure = $2::jsonb,
                store_results = $3::jsonb,
                updated_at = now()
          WHERE id = $1
            AND status <> 'recovered'`,
        [deletionRequestId, JSON.stringify(failure), JSON.stringify(stores)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

class AccountStoreBlockedError extends Error {
  constructor(readonly store: string) {
    super(`Account store ${store} still has foreign-key dependants`);
  }
}

async function deleteStore(client: PoolClient, store: AccountStore): Promise<void> {
  await client.query(
    `DELETE FROM ${quoteSqlIdentifier(store.tableName)} AS t
      WHERE ${accountOwnershipPredicate(store.ownership)}`,
  );
}

async function setSystemRole(client: PoolClient): Promise<void> {
  await client.query("SELECT set_config('app.system_role', $1, true)", [
    ACCOUNT_DELETION_SYSTEM_ROLE,
  ]);
}

function isForeignKeyDeferred(error: unknown): boolean {
  return databaseErrorCode(error) === "23503";
}

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}
