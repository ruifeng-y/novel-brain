import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { WORKER_QUEUE_NAME, type WorkerJob } from "@novel-brain/contracts";
import { Queue } from "bullmq";
import Redis from "ioredis";

const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_e2e";
const redisUrl = process.env.E2E_REDIS_URL ?? "redis://localhost:6379/1";

export async function startWorker(
  options: {
    failStep?: "draft" | "verify" | "revise";
    failImportSequence?: number;
    importProcessingDelayMs?: number;
    workerLockDurationMs?: number;
    workerStalledIntervalMs?: number;
  } = {},
) {
  const root = path.resolve(__dirname, "../../../..");
  const child = spawn(process.execPath, [path.join(root, "apps/worker/dist/main.js")], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      AI_PROVIDER_MODE: "fake",
      MODEL_CONNECTION_TESTER: "fake",
      STORAGE_LOCAL_DIRECTORY: "test-results/playwright-storage",
      NODE_ENV: "test",
      LOG_LEVEL: "info",
      ...(options.failStep ? { FAKE_AI_FAILURE_STEP: options.failStep } : {}),
      ...(options.failImportSequence !== undefined
        ? { FAKE_IMPORT_FAILURE_SEQUENCE: String(options.failImportSequence) }
        : {}),
      ...(options.importProcessingDelayMs !== undefined
        ? { IMPORT_PROCESSING_DELAY_MS: String(options.importProcessingDelayMs) }
        : {}),
      ...(options.workerLockDurationMs !== undefined
        ? { WORKER_LOCK_DURATION_MS: String(options.workerLockDurationMs) }
        : {}),
      ...(options.workerStalledIntervalMs !== undefined
        ? { WORKER_STALLED_INTERVAL_MS: String(options.workerStalledIntervalMs) }
        : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForWorker(child);
  const probeConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const probeQueue = new Queue<WorkerJob>(WORKER_QUEUE_NAME, { connection: probeConnection });
  await probeQueue.waitUntilReady();
  const closeProbe = async () => {
    await probeQueue.close();
    if (probeConnection.status === "ready") {
      await probeConnection.quit();
    } else {
      probeConnection.disconnect();
    }
  };
  const stop = async () => {
    try {
      await stopWorker(child);
    } finally {
      await closeProbe();
    }
  };
  const crash = async () => {
    try {
      await crashWorker(child);
    } finally {
      await closeProbe();
    }
  };
  return {
    child,
    stop,
    crash,
    activeJobCount: async () => (await probeQueue.getActive()).length,
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

function crashWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGKILL");
  });
}
