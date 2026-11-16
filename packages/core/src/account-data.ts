export const ACCOUNT_EXPORT_INVENTORY_VERSION = "account-export-v1" as const;
export const ACCOUNT_EXPORT_RETENTION_DAYS = 7;
export const ACCOUNT_DELETION_RECOVERY_DAYS = 30;
export const ACCOUNT_BACKUP_RETENTION_DAYS = 30;
export const ACCOUNT_DELETION_SYSTEM_ROLE = "account_deletion";
export const ACCOUNT_PURGE_JOB_ID_PREFIX = "account-purge-";
export const ACCOUNT_PURGE_JOB_ATTEMPTS = 5;
export const ACCOUNT_PURGE_RETRY_DELAY_MS = 60_000;

export const ACCOUNT_TENANT_COLUMNS = ["user_id", "work_id", "branch_id"] as const;
export const ACCOUNT_DIRECT_USER_COLUMNS = [
  "user_id",
  "actor_id",
  "created_by",
  "signed_off_by",
  "decided_by",
  "locked_by",
  "revoked_by",
] as const;

export const ACCOUNT_EXPORT_EXCLUDED_TABLES = new Set(["deletion_requests", "export_receipts"]);
export const ACCOUNT_EXPORT_SENSITIVE_COLUMNS: Record<string, string[]> = {
  email_verification_codes: ["code_hash"],
  model_configs: ["encrypted_key", "idempotency_key"],
  password_resets: ["token_hash"],
  sessions: ["token_hash"],
  users: ["password_hash"],
};

export type AccountStoreOwnership =
  | "self"
  | "email"
  | "user_id"
  | "work_id"
  | "branch_id"
  | "actor_id"
  | `column:${string}`
  | `columns:${string}`;

export interface AccountStore {
  tableName: string;
  ownership: AccountStoreOwnership;
}

export interface AccountCatalogRow {
  table_name: string;
  columns: string[];
  user_reference_columns: string[];
}

export async function discoverAccountStores(
  query: (text: string, values?: unknown[]) => Promise<{ rows: AccountCatalogRow[] }>,
  mode: "export" | "delete",
): Promise<AccountStore[]> {
  const result = await query(
    `WITH user_references AS (
       SELECT conrelid::regclass::text AS table_name,
              array_agg(attribute.attname ORDER BY attribute.attname) AS columns
         FROM pg_constraint AS constraint_record
         JOIN pg_attribute AS attribute
           ON attribute.attrelid = constraint_record.conrelid
          AND attribute.attnum = ANY(constraint_record.conkey)
        WHERE constraint_record.contype = 'f'
          AND constraint_record.confrelid = 'users'::regclass
        GROUP BY constraint_record.conrelid
     )
     SELECT column_record.table_name,
            jsonb_agg(column_record.column_name ORDER BY column_record.column_name) AS columns,
            COALESCE(to_jsonb(MAX(user_references.columns)), '[]'::jsonb) AS user_reference_columns
       FROM information_schema.columns AS column_record
       LEFT JOIN user_references
         ON user_references.table_name = column_record.table_name
      WHERE column_record.table_schema = 'public'
      GROUP BY column_record.table_name
      ORDER BY column_record.table_name`,
  );
  const excluded =
    mode === "export" ? ACCOUNT_EXPORT_EXCLUDED_TABLES : new Set(["deletion_requests"]);
  const stores = result.rows
    .filter((row) => !excluded.has(row.table_name))
    .flatMap((row) => {
      const store = classifyAccountStore(row.table_name, row.columns, row.user_reference_columns);
      return store ? [store] : [];
    });
  for (const store of [
    { tableName: "email_verification_codes", ownership: "email" as const },
    { tableName: "audit_logs", ownership: "actor_id" as const },
    { tableName: "users", ownership: "self" as const },
  ]) {
    if (!stores.some((candidate) => candidate.tableName === store.tableName)) {
      stores.unshift(store);
    }
  }
  return stores;
}

export function accountPurgeJobId(deletionRequestId: string): string {
  return `${ACCOUNT_PURGE_JOB_ID_PREFIX}${deletionRequestId}`;
}

export function accountPurgeJobPayload(deletionRequestId: string): AccountPurgeJob {
  return {
    jobType: "account_purge",
    deletionRequestId,
    workId: null,
    branchId: null,
    idempotencyKey: accountPurgeJobId(deletionRequestId),
    checkpoint: {
      schemaVersion: 1,
      revision: 0,
      step: "prepare",
    },
  };
}

export function accountPurgeTickJobPayload(): AccountPurgeTickJob {
  return {
    jobType: "account_purge_tick",
    workId: null,
    branchId: null,
    idempotencyKey: "account-purge-tick",
    checkpoint: {
      schemaVersion: 1,
      revision: 0,
      step: "scan",
    },
  };
}

export function classifyAccountStore(
  tableName: string,
  tenantColumns: string[],
  userReferenceColumns: string[] = [],
): AccountStore | null {
  if (tableName === "users") {
    return { tableName, ownership: "self" };
  }
  if (tableName === "email_verification_codes") {
    return { tableName, ownership: "email" };
  }
  if (tenantColumns.includes("user_id")) {
    return { tableName, ownership: "user_id" };
  }
  if (tenantColumns.includes("work_id")) {
    return { tableName, ownership: "work_id" };
  }
  if (tenantColumns.includes("branch_id")) {
    return { tableName, ownership: "branch_id" };
  }
  const directColumns = userReferenceColumns.filter(
    (column) =>
      ACCOUNT_DIRECT_USER_COLUMNS.includes(
        column as (typeof ACCOUNT_DIRECT_USER_COLUMNS)[number],
      ) || !["id"].includes(column),
  );
  if (directColumns.length === 1) {
    return { tableName, ownership: `column:${directColumns[0]}` };
  }
  if (directColumns.length > 1) {
    return { tableName, ownership: `columns:${directColumns.join(",")}` };
  }
  return null;
}

export function accountOwnershipPredicate(ownership: AccountStoreOwnership): string {
  const userId = "NULLIF(current_setting('app.user_id', true), '')::uuid";
  if (ownership === "self") {
    return `t.id = ${userId}`;
  }
  if (ownership === "email") {
    return `t.email = (SELECT u.email FROM users u WHERE u.id = ${userId})`;
  }
  if (ownership.startsWith("column:")) {
    const column = ownership.slice("column:".length);
    if (!/^[a-z][a-z0-9_]*$/.test(column)) {
      throw new Error(`Unsafe account ownership column: ${column}`);
    }
    return `t.${column} = ${userId}`;
  }
  if (ownership.startsWith("columns:")) {
    const columns = ownership.slice("columns:".length).split(",");
    if (columns.length === 0 || columns.some((column) => !/^[a-z][a-z0-9_]*$/.test(column))) {
      throw new Error(`Unsafe account ownership columns: ${ownership}`);
    }
    return columns.map((column) => `t.${column} = ${userId}`).join(" OR ");
  }
  switch (ownership) {
    case "user_id":
      return `t.user_id = ${userId}`;
    case "actor_id":
      return `t.actor_id = ${userId}`;
    case "work_id":
      return `t.work_id IN (SELECT w.id FROM works w WHERE w.user_id = ${userId})`;
    case "branch_id":
      return `t.branch_id IN (
        SELECT b.id FROM work_branches b WHERE b.user_id = ${userId}
      )`;
  }
  throw new Error(`Unsupported account ownership: ${ownership}`);
}

export function quoteSqlIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}
import type { AccountPurgeJob, AccountPurgeTickJob } from "@novel-brain/contracts";
