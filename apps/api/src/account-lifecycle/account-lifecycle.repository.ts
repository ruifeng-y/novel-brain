import { createHash } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type {
  AccountDeletionCreateRequest,
  AccountDeletionRequest,
  AccountDeletionStoreResult,
  AccountExportInventoryEntry,
  AccountExportReceipt,
} from "@novel-brain/contracts";
import {
  ACCOUNT_BACKUP_RETENTION_DAYS,
  ACCOUNT_DELETION_RECOVERY_DAYS,
  ACCOUNT_EXPORT_EXCLUDED_TABLES,
  ACCOUNT_EXPORT_INVENTORY_VERSION,
  ACCOUNT_EXPORT_RETENTION_DAYS,
  ACCOUNT_EXPORT_SENSITIVE_COLUMNS,
  ACCOUNT_TENANT_COLUMNS,
  accountOwnershipPredicate,
  classifyAccountStore,
  quoteSqlIdentifier,
  type AccountStore,
} from "@novel-brain/core";
import { createDatabasePool } from "@novel-brain/db";
import type { Pool, PoolClient } from "pg";
import { uuidv7 } from "uuidv7";

interface ExportReceiptRow {
  id: string;
  inventory_version: string;
  checksum: string;
  byte_size: number;
  inventory: AccountExportInventoryEntry[];
  generated_at: Date;
  expires_at: Date;
}

interface DeletionRequestRow {
  id: string;
  status: AccountDeletionRequest["status"];
  export_receipt_id: string | null;
  requested_at: Date;
  recoverable_until: Date;
  purge_after: Date;
  backup_expires_at: Date;
  completed_at: Date | null;
  failure: AccountDeletionRequest["failure"];
  store_results: AccountDeletionStoreResult[];
}

@Injectable()
export class AccountLifecycleRepository implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
  }

  async createExportReceipt(userId: string): Promise<AccountExportReceipt> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      const generatedAt = new Date();
      const expiresAt = new Date(
        generatedAt.getTime() + ACCOUNT_EXPORT_RETENTION_DAYS * 86_400_000,
      );
      const receiptId = uuidv7();
      const inventory: AccountExportInventoryEntry[] = [];
      const data: Record<string, unknown[]> = {};

      for (const table of await this.tenantTables(client)) {
        const quotedTable = quoteSqlIdentifier(table.tableName);
        const predicate = accountOwnershipPredicate(table.ownership);
        const hiddenColumns = ACCOUNT_EXPORT_SENSITIVE_COLUMNS[table.tableName] ?? [];
        const result = await client.query<{ row_count: number; rows: unknown[] }>(
          `SELECT count(*)::int AS row_count,
                  COALESCE(jsonb_agg(to_jsonb(t) - $1::text[]), '[]'::jsonb) AS rows
             FROM ${quotedTable} AS t
            WHERE ${predicate}`,
          [hiddenColumns],
        );
        const row = result.rows[0];
        if (!row) {
          throw new Error(`Failed to export account store ${table.tableName}`);
        }
        inventory.push({ store: table.tableName, rowCount: row.row_count });
        data[table.tableName] = row.rows;
      }

      const payload = JSON.stringify({
        schemaVersion: 1,
        inventoryVersion: ACCOUNT_EXPORT_INVENTORY_VERSION,
        receiptId,
        generatedAt: generatedAt.toISOString(),
        inventory,
        data,
      });
      const checksum = createHash("sha256").update(payload).digest("hex");
      const byteSize = Buffer.byteLength(payload, "utf8");

      const inserted = await client.query<ExportReceiptRow>(
        `INSERT INTO export_receipts
           (id, user_id, schema_version, inventory_version, checksum, byte_size,
            inventory, payload, generated_at, expires_at)
         VALUES ($1, $2, 1, $3, $4, $5, $6::jsonb, $7, $8, $9)
         RETURNING id, inventory_version, checksum, byte_size, inventory,
                   generated_at, expires_at`,
        [
          receiptId,
          userId,
          ACCOUNT_EXPORT_INVENTORY_VERSION,
          checksum,
          byteSize,
          JSON.stringify(inventory),
          payload,
          generatedAt,
          expiresAt,
        ],
      );
      const receipt = inserted.rows[0];
      if (!receipt) {
        throw new Error("Failed to persist account export receipt");
      }
      await client.query("COMMIT");
      return toReceipt(receipt);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async downloadExport(
    userId: string,
    receiptId: string,
  ): Promise<
    { payload: string; checksum: string; inventoryVersion: string } | "not_found" | "expired"
  > {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      const result = await client.query<{
        payload: string;
        checksum: string;
        inventory_version: string;
        expires_at: Date;
      }>(
        `SELECT payload, checksum, inventory_version, expires_at
           FROM export_receipts
          WHERE id = $1 AND user_id = $2`,
        [receiptId, userId],
      );
      await client.query("COMMIT");
      const receipt = result.rows[0];
      if (!receipt) {
        return "not_found";
      }
      if (receipt.expires_at.getTime() <= Date.now()) {
        return "expired";
      }
      return {
        payload: receipt.payload,
        checksum: receipt.checksum,
        inventoryVersion: receipt.inventory_version,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async createDeletionRequest(input: {
    userId: string;
    sessionId: string;
    request: AccountDeletionCreateRequest;
    audit: LifecycleAuditContext;
  }): Promise<AccountDeletionRequest | "export_required" | "export_expired"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [input.userId]);
      const [existing] = (
        await client.query<DeletionRequestRow>(
          `SELECT id, status, export_receipt_id, requested_at, recoverable_until,
                  purge_after, backup_expires_at, completed_at, failure, store_results
             FROM deletion_requests
            WHERE user_id = $1
              AND status IN ('recovery_pending', 'purging', 'failed')
            ORDER BY created_at DESC
            LIMIT 1
            FOR UPDATE`,
          [input.userId],
        )
      ).rows;
      if (existing) {
        await client.query("COMMIT");
        return toDeletionRequest(existing);
      }

      const [receipt] = (
        await client.query<{ expires_at: Date }>(
          `SELECT expires_at
             FROM export_receipts
            WHERE id = $1 AND user_id = $2`,
          [input.request.exportReceiptId, input.userId],
        )
      ).rows;
      if (!receipt) {
        await client.query("ROLLBACK");
        return "export_required";
      }
      if (receipt.expires_at.getTime() <= Date.now()) {
        await client.query("ROLLBACK");
        return "export_expired";
      }

      const requestedAt = new Date();
      const recoverableUntil = addDays(requestedAt, ACCOUNT_DELETION_RECOVERY_DAYS);
      const backupExpiresAt = addDays(recoverableUntil, ACCOUNT_BACKUP_RETENTION_DAYS);
      const deletionRequestId = uuidv7();
      const [inserted] = (
        await client.query<DeletionRequestRow>(
          `INSERT INTO deletion_requests
             (id, user_id, export_receipt_id, status, requested_at, recoverable_until,
              purge_after, backup_expires_at)
           VALUES ($1, $2, $3, 'recovery_pending', $4, $5, $5, $6)
           RETURNING id, status, export_receipt_id, requested_at, recoverable_until,
                     purge_after, backup_expires_at, completed_at, failure, store_results`,
          [
            deletionRequestId,
            input.userId,
            input.request.exportReceiptId,
            requestedAt,
            recoverableUntil,
            backupExpiresAt,
          ],
        )
      ).rows;
      if (!inserted) {
        throw new Error("Failed to create account deletion request");
      }
      await client.query(
        `UPDATE users
            SET status = 'deletion_pending',
                version = version + 1,
                updated_at = now()
          WHERE id = $1`,
        [input.userId],
      );
      await client.query(
        `UPDATE sessions
            SET revoked_at = now()
          WHERE user_id = $1
            AND id <> $2
            AND revoked_at IS NULL`,
        [input.userId, input.sessionId],
      );
      await client.query(
        `INSERT INTO audit_logs
           (id, actor_id, action, target_type, target_id, decision,
            correlation_id, ip, user_agent)
         VALUES ($1, $2, 'account.deletion_requested', 'deletion_request', $3,
                 'allowed', $4, $5, $6)`,
        [
          uuidv7(),
          input.userId,
          insertionTargetId(inserted.id),
          input.audit.requestId,
          input.audit.ip,
          input.audit.userAgent,
        ],
      );
      await client.query("COMMIT");
      return toDeletionRequest(inserted);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getDeletionRequest(userId: string): Promise<AccountDeletionRequest | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      const [row] = (
        await client.query<DeletionRequestRow>(
          `SELECT id, status, export_receipt_id, requested_at, recoverable_until,
                  purge_after, backup_expires_at, completed_at, failure, store_results
             FROM deletion_requests
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 1`,
          [userId],
        )
      ).rows;
      await client.query("COMMIT");
      return row ? toDeletionRequest(row) : null;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recoverDeletionRequest(input: {
    userId: string;
    audit: LifecycleAuditContext;
  }): Promise<AccountDeletionRequest | "not_found" | "expired" | "invalid_state"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [input.userId]);
      const [current] = (
        await client.query<DeletionRequestRow>(
          `SELECT id, status, export_receipt_id, requested_at, recoverable_until,
                  purge_after, backup_expires_at, completed_at, failure, store_results
             FROM deletion_requests
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 1
            FOR UPDATE`,
          [input.userId],
        )
      ).rows;
      if (!current) {
        await client.query("ROLLBACK");
        return "not_found";
      }
      if (current.status === "recovered") {
        await client.query("COMMIT");
        return toDeletionRequest(current);
      }
      if (current.status !== "recovery_pending" && current.status !== "failed") {
        await client.query("ROLLBACK");
        return "invalid_state";
      }
      if (current.recoverable_until.getTime() <= Date.now()) {
        await client.query("ROLLBACK");
        return "expired";
      }
      const [recovered] = (
        await client.query<DeletionRequestRow>(
          `UPDATE deletion_requests
              SET status = 'recovered',
                  failure = NULL,
                  updated_at = now()
            WHERE id = $1
            RETURNING id, status, export_receipt_id, requested_at, recoverable_until,
                      purge_after, backup_expires_at, completed_at, failure, store_results`,
          [current.id],
        )
      ).rows;
      await client.query(
        `UPDATE users
            SET status = 'active',
                version = version + 1,
                updated_at = now()
          WHERE id = $1`,
        [input.userId],
      );
      await client.query(
        `INSERT INTO audit_logs
           (id, actor_id, action, target_type, target_id, decision,
            correlation_id, ip, user_agent)
         VALUES ($1, $2, 'account.deletion_recovered', 'deletion_request', $3,
                 'allowed', $4, $5, $6)`,
        [
          uuidv7(),
          input.userId,
          insertionTargetId(current.id),
          input.audit.requestId,
          input.audit.ip,
          input.audit.userAgent,
        ],
      );
      if (!recovered) {
        throw new Error("Failed to recover account deletion request");
      }
      await client.query("COMMIT");
      return toDeletionRequest(recovered);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async tenantTables(client: PoolClient): Promise<AccountStore[]> {
    const result = await client.query<{ table_name: string; tenant_columns: string[] }>(
      `SELECT table_name,
              jsonb_agg(column_name ORDER BY column_name) AS tenant_columns
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = ANY($1::text[])
        GROUP BY table_name
        ORDER BY table_name`,
      [ACCOUNT_TENANT_COLUMNS],
    );
    const tables = result.rows
      .filter((row) => !ACCOUNT_EXPORT_EXCLUDED_TABLES.has(row.table_name))
      .flatMap((row) => {
        const store = classifyAccountStore(row.table_name, row.tenant_columns);
        return store ? [store] : [];
      });
    if (!tables.some((table) => table.tableName === "audit_logs")) {
      tables.push({ tableName: "audit_logs", ownership: "actor_id" });
    }
    if (!tables.some((table) => table.tableName === "users")) {
      tables.unshift({ tableName: "users", ownership: "self" });
    }
    return tables;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

export interface LifecycleAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

function toReceipt(row: ExportReceiptRow): AccountExportReceipt {
  return {
    id: row.id,
    schemaVersion: 1,
    inventoryVersion: "account-export-v1",
    checksum: row.checksum,
    byteSize: row.byte_size,
    inventory: row.inventory,
    generatedAt: row.generated_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

function toDeletionRequest(row: DeletionRequestRow): AccountDeletionRequest {
  return {
    id: row.id,
    status: row.status,
    exportReceiptId: row.export_receipt_id,
    requestedAt: row.requested_at.toISOString(),
    recoverableUntil: row.recoverable_until.toISOString(),
    purgeAfter: row.purge_after.toISOString(),
    backupExpiresAt: row.backup_expires_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    failure: row.failure ?? null,
    stores: row.store_results ?? [],
  };
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

function insertionTargetId(value: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error("Deletion request id is not a UUID");
  }
  return value;
}
