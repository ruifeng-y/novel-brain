export const ACCOUNT_EXPORT_INVENTORY_VERSION = "account-export-v1" as const;
export const ACCOUNT_EXPORT_RETENTION_DAYS = 7;
export const ACCOUNT_DELETION_RECOVERY_DAYS = 30;
export const ACCOUNT_BACKUP_RETENTION_DAYS = 30;
export const ACCOUNT_DELETION_SYSTEM_ROLE = "account_deletion";

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
  "self" | "email" | "user_id" | "work_id" | "branch_id" | "actor_id" | `column:${string}`;

export interface AccountStore {
  tableName: string;
  ownership: AccountStoreOwnership;
}

export function classifyAccountStore(
  tableName: string,
  tenantColumns: string[],
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
  const directColumn = tenantColumns.find((column) =>
    ACCOUNT_DIRECT_USER_COLUMNS.includes(column as (typeof ACCOUNT_DIRECT_USER_COLUMNS)[number]),
  );
  return directColumn
    ? { tableName, ownership: `column:${directColumn}` as `column:${string}` }
    : null;
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
