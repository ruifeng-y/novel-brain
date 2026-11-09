import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "apps/**/test/**/*.test.ts",
      "packages/**/test/**/*.test.ts",
      "scripts/test/**/*.test.mjs",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
