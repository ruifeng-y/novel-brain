import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_e2e";
const redisUrl = process.env.E2E_REDIS_URL ?? "redis://localhost:6379/1";

export async function startWorker(options: { failStep?: "draft" | "verify" | "revise" } = {}) {
  const root = path.resolve(__dirname, "../../../..");
  const child = spawn(process.execPath, [path.join(root, "apps/worker/dist/main.js")], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      LOG_LEVEL: "info",
      ...(options.failStep ? { FAKE_AI_FAILURE_STEP: options.failStep } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForWorker(child);
  return {
    child,
    stop: () => stopWorker(child),
  };
}

function waitForWorker(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Worker did not become ready. stdout=${stdout} stderr=${stderr}`));
    }, 15_000);

    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes("worker.ready")) {
        cleanup();
        resolve();
      }
    };
    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString();
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Worker exited before ready with code ${code}. stderr=${stderr}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
    };

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("exit", onExit);
  });
}

function stopWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
