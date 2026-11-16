import { describe, expect, it } from "vitest";

import {
  ACCOUNT_PURGE_JOB,
  ACCOUNT_PURGE_TICK_JOB,
  accountDeletionCreateRequestSchema,
  accountDeletionRequestSchema,
  accountExportReceiptSchema,
  workerJobSchema,
} from "../src";

const ids = {
  receipt: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e01",
  deletion: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e02",
};

describe("account lifecycle contracts", () => {
  it("requires an export receipt before accepting a deletion request", () => {
    expect(
      accountDeletionCreateRequestSchema.parse({
        exportReceiptId: ids.receipt,
        confirm: true,
      }),
    ).toEqual({
      exportReceiptId: ids.receipt,
      confirm: true,
    });

    expect(
      accountDeletionCreateRequestSchema.safeParse({
        exportReceiptId: ids.receipt,
        confirm: false,
      }).success,
    ).toBe(false);
  });

  it("types versioned, checksummed export receipts and lifecycle status", () => {
    const receipt = accountExportReceiptSchema.parse({
      id: ids.receipt,
      schemaVersion: 1,
      inventoryVersion: "account-export-v1",
      checksum: "a".repeat(64),
      byteSize: 2048,
      inventory: [
        { store: "users", rowCount: 1 },
        { store: "works", rowCount: 2 },
      ],
      generatedAt: "2026-11-16T08:00:00.000Z",
      expiresAt: "2026-11-23T08:00:00.000Z",
    });
    expect(receipt.inventoryVersion).toBe("account-export-v1");
    expect(() =>
      accountExportReceiptSchema.parse({
        ...receipt,
        checksum: "not-a-checksum",
      }),
    ).toThrow();

    const deletion = accountDeletionRequestSchema.parse({
      id: ids.deletion,
      status: "recovery_pending",
      exportReceiptId: ids.receipt,
      requestedAt: "2026-11-16T08:00:00.000Z",
      recoverableUntil: "2026-12-16T08:00:00.000Z",
      purgeAfter: "2026-12-16T08:00:00.000Z",
      backupExpiresAt: "2027-01-15T08:00:00.000Z",
      completedAt: null,
      failure: null,
      stores: [],
    });
    expect(deletion.status).toBe("recovery_pending");
    expect(deletion.backupExpiresAt).toBe("2027-01-15T08:00:00.000Z");
  });

  it("adds account purge work to the typed worker union", () => {
    expect(
      workerJobSchema.parse({
        jobType: ACCOUNT_PURGE_JOB,
        deletionRequestId: ids.deletion,
        idempotencyKey: `account-purge:${ids.deletion}`,
        workId: null,
        branchId: null,
        checkpoint: {
          schemaVersion: 1,
          revision: 0,
          step: "prepare",
        },
      }),
    ).toMatchObject({ jobType: ACCOUNT_PURGE_JOB });
    expect(
      workerJobSchema.parse({
        jobType: ACCOUNT_PURGE_TICK_JOB,
        idempotencyKey: "account-purge-tick",
        workId: null,
        branchId: null,
        checkpoint: {
          schemaVersion: 1,
          revision: 0,
          step: "scan",
        },
      }),
    ).toMatchObject({ jobType: ACCOUNT_PURGE_TICK_JOB });
  });
});
