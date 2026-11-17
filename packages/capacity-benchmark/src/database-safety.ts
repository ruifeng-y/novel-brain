export function benchmarkDatabaseName(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL_INVALID");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!databaseName) {
    throw new Error("DATABASE_NAME_MISSING");
  }
  return databaseName;
}

export function assertBenchmarkDatabaseTarget(
  databaseUrl: string,
  confirmedDatabaseName: string,
): void {
  const databaseName = benchmarkDatabaseName(databaseUrl);
  if (!databaseName.endsWith("_benchmark") || databaseName === "postgres") {
    throw new Error("BENCHMARK_DATABASE_NAME_REQUIRED");
  }
  if (databaseName !== confirmedDatabaseName) {
    throw new Error("BENCHMARK_DATABASE_CONFIRMATION_MISMATCH");
  }
}
