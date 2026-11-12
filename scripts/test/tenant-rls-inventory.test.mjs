import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("tenant RLS inventory", () => {
  it("contains a complete, fully covered tenant table inventory", async () => {
    const inventory = JSON.parse(
      await readFile(
        new URL("../../docs/security/tenant-rls-inventory.json", import.meta.url),
        "utf8",
      ),
    );
    expect(inventory.scope).toContain("user_id");
    expect(inventory.uncovered).toEqual([]);
    expect(inventory.tables.length).toBeGreaterThan(50);
    for (const table of inventory.tables) {
      expect(table.rlsEnabled, table.table).toBe(true);
      expect(table.rlsForced, table.table).toBe(true);
      expect(table.policies.length, table.table).toBeGreaterThan(0);
      expect(table.ownershipKey).toMatch(/^(user_id|work_id|branch_id)$/u);
      expect(table.covered, table.table).toBe(true);
    }
  });
});
