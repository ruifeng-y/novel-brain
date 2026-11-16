import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      DATABASE_QUERY_TIMEOUT_MS: "15000",
    },
    include: ["apps/**/test/**/*.integration.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    passWithNoTests: false,
    restoreMocks: true,
  },
});
