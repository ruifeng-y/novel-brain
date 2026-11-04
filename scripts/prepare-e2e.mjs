import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { runMigrations } = require("../packages/db/dist/migrations.js");

const databaseUrl =
  process.env.E2E_DATABASE_URL ?? "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain";

await runMigrations(databaseUrl);
console.log(JSON.stringify({ event: "e2e.database.ready" }));
