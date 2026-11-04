import { runMigrations } from "./migrations";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  await runMigrations(databaseUrl);
  console.log(JSON.stringify({ event: "database.migrations.completed" }));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown migration error";
  console.error(JSON.stringify({ event: "database.migrations.failed", message }));
  process.exitCode = 1;
});
