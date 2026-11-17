import { describe, expect, it } from "vitest";

import { assertBenchmarkDatabaseTarget, benchmarkDatabaseName } from "../src/database-safety";

describe("benchmark database safety", () => {
  it("requires a dedicated benchmark database and an exact confirmation", () => {
    const url = "postgresql://novelbrain:secret@localhost:5432/novelbrain_benchmark";

    expect(benchmarkDatabaseName(url)).toBe("novelbrain_benchmark");
    expect(() => assertBenchmarkDatabaseTarget(url, "novelbrain_benchmark")).not.toThrow();
    expect(() => assertBenchmarkDatabaseTarget(url, "novelbrain")).toThrow(
      "BENCHMARK_DATABASE_CONFIRMATION_MISMATCH",
    );
  });

  it("rejects ordinary product and admin database names", () => {
    expect(() =>
      assertBenchmarkDatabaseTarget(
        "postgresql://novelbrain:secret@localhost:5432/novelbrain",
        "novelbrain",
      ),
    ).toThrow("BENCHMARK_DATABASE_NAME_REQUIRED");
    expect(() =>
      assertBenchmarkDatabaseTarget(
        "postgresql://novelbrain:secret@localhost:5432/postgres",
        "postgres",
      ),
    ).toThrow("BENCHMARK_DATABASE_NAME_REQUIRED");
  });
});
