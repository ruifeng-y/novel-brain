import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { jobs, workBlueprints } from "../src/schema";

describe("workBlueprints schema", () => {
  it("keeps one blueprint aggregate per work branch and tenant", () => {
    const config = getTableConfig(workBlueprints);
    const columns = new Set(config.columns.map((column) => column.name));

    expect(config.name).toBe("work_blueprints");
    expect([...columns]).toEqual(
      expect.arrayContaining([
        "id",
        "user_id",
        "work_id",
        "branch_id",
        "job_id",
        "status",
        "version",
        "input_hash",
        "estimate",
        "story_bible_draft",
        "core_settings_draft",
        "outline_draft",
        "missing_fields",
        "conflicts",
        "acknowledgements",
        "confirmed_at",
        "confirmed_by",
      ]),
    );
    expect(config.indexes.map((index) => index.config.name)).toContain(
      "work_blueprints_work_branch_unique",
    );
  });

  it("enables tenant RLS in the generated migration", () => {
    const migrationDirectory = join(process.cwd(), "packages/db/migrations");
    const migration = readFileSync(join(migrationDirectory, "0079_certain_gwen_stacy.sql"), "utf8");

    expect(migration).toContain('ALTER TABLE "work_blueprints" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY "work_blueprints_tenant_policy"');
  });

  it("persists blueprint idempotency per work branch", () => {
    const config = getTableConfig(jobs);

    expect(config.indexes.map((index) => index.config.name)).toContain(
      "jobs_generate_blueprint_idempotency_unique",
    );
  });
});
