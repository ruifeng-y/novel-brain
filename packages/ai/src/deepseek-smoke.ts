import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { runDeepSeekSmoke } from "./index";

async function main(): Promise<void> {
  const outputPath = path.resolve(
    process.env.INIT_CWD ?? process.cwd(),
    process.env.DEEPSEEK_SMOKE_OUTPUT ?? "artifacts/playwright/deepseek-smoke.json",
  );
  const evidence = await runDeepSeekSmoke({ env: process.env });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify({
      event: "ai.deepseek.smoke.completed",
      status: evidence.status,
      networkCalls: evidence.networkCalls,
      outputPath,
      ...(evidence.status === "skipped" ? { reason: evidence.reason } : {}),
    }),
  );

  if (evidence.status === "skipped" && process.env.REQUIRE_DEEPSEEK_SMOKE === "1") {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown DeepSeek smoke error";
  console.error(JSON.stringify({ event: "ai.deepseek.smoke.failed", message }));
  process.exitCode = 1;
});
