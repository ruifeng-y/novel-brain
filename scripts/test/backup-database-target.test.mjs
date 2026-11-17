import { describe, expect, it } from "vitest";

import { backupDatabaseNameForTarget } from "../backup/backup-runtime.mjs";

describe("backup database target", () => {
  it("keeps the production database name as the default", () => {
    expect(backupDatabaseNameForTarget({})).toBe("novelbrain");
  });

  it("allows an explicit benchmark database without accepting SQL syntax", () => {
    expect(backupDatabaseNameForTarget({ BACKUP_DATABASE_NAME: "novelbrain_benchmark" })).toBe(
      "novelbrain_benchmark",
    );
    expect(() =>
      backupDatabaseNameForTarget({ BACKUP_DATABASE_NAME: "novelbrain; DROP TABLE users" }),
    ).toThrow("BACKUP_DATABASE_NAME_INVALID");
  });
});
