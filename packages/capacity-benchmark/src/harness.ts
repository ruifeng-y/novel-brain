import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { createDatabasePool } from "@novel-brain/db";
import { uuidv7 } from "uuidv7";

import type { FixtureManifest } from "./seed";
import { benchmarkCsrfToken, benchmarkSessionToken, deterministicUuid } from "./fixture-ids";
import { percentile, summarizeSamples, type SampleSummary } from "./statistics";
import {
  createWorkloadProfile,
  type WorkloadOperationId,
  type WorkloadProfile,
} from "./workload-profile";
import { writeJsonArtifact } from "./report-io";

export interface WorkloadRunInput {
  fixtureManifest: FixtureManifest;
  apiBaseUrl: string;
  databaseUrl: string;
  concurrency: number;
  durationSeconds: number;
  rampSeconds: number;
  outputDirectory: string;
  origin?: string;
  storageMetricsUrl?: string;
}

export interface WorkloadSample {
  sequence: number;
  runId: string;
  workerId: number;
  operation: WorkloadOperationId;
  method: string;
  requestPath: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: number | null;
  ok: boolean;
  responseBytes: number;
  errorCode: string | null;
}

export interface WorkloadSummary {
  formatVersion: 1;
  runId: string;
  sourceCommit: string;
  fixtureSha256: string;
  apiBaseUrl: string;
  startedAt: string;
  completedAt: string;
  elapsedMs: number;
  profile: WorkloadProfile;
  overall: SampleSummary;
  byOperation: Record<string, SampleSummary>;
  targets: {
    interactiveReadP95Ms: number | null;
    interactiveReadP99Ms: number | null;
    searchP95Ms: number | null;
    sseDeliveryP95Ms: number | null;
    firstTokenMs: number | null;
  };
  database: {
    sizeBytes: number;
    tableBytes: number;
    indexBytes: number;
    xactCommit: number;
    blocksRead: number;
    blocksHit: number;
    tempBytes: number;
    deadlocks: number;
    queueWaitP95Ms: number | null;
    queueWaitMaxMs: number | null;
    jobStatusCounts: Record<string, number>;
  };
  storage: {
    objectCount: number | null;
    objectBytes: number | null;
    metricsUrl: string;
  };
  cost: {
    modelCostCny: number;
    infrastructureCostCny: null;
    note: string;
  };
  resources: RuntimeSample[];
  errors: Array<{
    operation: WorkloadOperationId;
    status: number | null;
    errorCode: string | null;
    requestPath: string;
  }>;
  artifacts: {
    rawSamplesPath: string;
    summaryPath: string;
  };
}

export interface RuntimeSample {
  capturedAt: string;
  containers: Array<{
    name: string;
    cpuPercent: number | null;
    memoryBytes: number | null;
    blockReadBytes: number | null;
    blockWriteBytes: number | null;
    networkInputBytes: number | null;
    networkOutputBytes: number | null;
  }>;
  storageMetrics: Record<string, number>;
}

interface SampleWriter {
  write(sample: WorkloadSample): void;
  close(): Promise<void>;
}

interface RequestResult {
  status: number | null;
  ok: boolean;
  responseBytes: number;
  errorCode: string | null;
  body: unknown;
  durationMs?: number;
}

type OperationExecutor = () => Promise<{
  method: string;
  requestPath: string;
  result: RequestResult;
}>;

export async function runWorkload(input: WorkloadRunInput): Promise<WorkloadSummary> {
  if (input.fixtureManifest.logicalCharacters !== 10_000_000) {
    throw new Error("WORKLOAD_REQUIRES_10M_FIXTURE");
  }
  const profile = createWorkloadProfile({
    apiConcurrency: input.concurrency,
    durationSeconds: input.durationSeconds,
    rampSeconds: input.rampSeconds,
    workerConcurrency: { global: 4, perWork: 2, perUser: 2 },
  });
  const rawSamplesPath = path.join(input.outputDirectory, "raw-samples.ndjson");
  const summaryPath = path.join(input.outputDirectory, "workload-summary.json");
  await mkdir(input.outputDirectory, { recursive: true });
  await writeFile(rawSamplesPath, "", "utf8");
  const writer = createSampleWriter(rawSamplesPath);
  const pool = createDatabasePool(input.databaseUrl, {
    max: 4,
    statement_timeout: 300_000,
    query_timeout: 300_000,
  });
  const resources: RuntimeSample[] = [];
  let resourceSampling = true;
  const resourcePromise = sampleResources(
    input.storageMetricsUrl ?? "http://127.0.0.1:9000/minio/v2/metrics/cluster",
  ).then((sample) => resources.push(sample));
  const resourceTimer = setInterval(() => {
    if (!resourceSampling) {
      return;
    }
    void sampleResources(
      input.storageMetricsUrl ?? "http://127.0.0.1:9000/minio/v2/metrics/cluster",
    ).then((sample) => resources.push(sample));
  }, 10_000);

  const before = await databaseRuntime(pool, new Date(0));
  const initialStorage = await storageMetrics(
    input.storageMetricsUrl ?? "http://127.0.0.1:9000/minio/v2/metrics/cluster",
  );
  const samples: WorkloadSample[] = [];
  const started = new Date();
  const runNonce = started.getTime().toString(36);
  const runId = `capacity-${started.toISOString().replaceAll(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`;
  let sequence = 0;
  const onceResults = new Map<string, Promise<RequestResult>>();
  const activeOnce = new Set<string>();
  const origin = input.origin ?? "http://localhost:3000";
  const sessionToken = benchmarkSessionToken(input.fixtureManifest.seed);
  const csrfToken = benchmarkCsrfToken(input.fixtureManifest.seed);
  const client = apiClient({
    apiBaseUrl: input.apiBaseUrl,
    origin,
    sessionToken,
    csrfToken,
  });

  const deadline = started.getTime() + input.durationSeconds * 1_000;
  const workers = Array.from({ length: input.concurrency }, (_, workerIndex) =>
    runWorker({
      workerIndex,
      deadline,
      rampSeconds: input.rampSeconds,
      concurrency: input.concurrency,
      fixture: input.fixtureManifest,
      profile,
      pool,
      client,
      onceResults,
      activeOnce,
      runNonce,
      emit: (sample) => {
        sequence += 1;
        const completed = { ...sample, sequence, runId };
        samples.push(completed);
        writer.write(completed);
      },
    }),
  );
  await Promise.all(workers);
  const completed = new Date();
  resourceSampling = false;
  clearInterval(resourceTimer);
  await resourcePromise;
  await writer.close();

  const after = await databaseRuntime(pool, started);
  const afterSizes = await databaseSizes(pool);
  const finalStorage = await storageMetrics(
    input.storageMetricsUrl ?? "http://127.0.0.1:9000/minio/v2/metrics/cluster",
  );
  const modelCost = await modelCostCny(pool, started);
  await pool.end();

  const elapsedMs = completed.getTime() - started.getTime();
  const byOperation = Object.fromEntries(
    profile.operations.map((operation) => {
      const operationSamples = samples.filter((sample) => sample.operation === operation.id);
      return [
        operation.id,
        summarizeSamples(
          operationSamples.map((sample) => ({ durationMs: sample.durationMs, ok: sample.ok })),
          elapsedMs,
        ),
      ];
    }),
  );
  const interactive = samples.filter((sample) =>
    [
      "overview-read",
      "chapter-read",
      "chapter-history",
      "story-bible-read",
      "entity-detail",
      "timeline-read",
      "branch-head-read",
      "chapter-save",
      "settings-update",
      "canon-submit",
    ].includes(sample.operation),
  );
  const search = samples.filter((sample) =>
    ["title-search", "body-search", "alias-search"].includes(sample.operation),
  );
  const sse = samples.filter((sample) => sample.operation === "sse-events");
  const interactiveSummary = summarizeSamples(
    interactive.map((sample) => ({ durationMs: sample.durationMs, ok: sample.ok })),
    elapsedMs,
  );
  const searchSummary = summarizeSamples(
    search.map((sample) => ({ durationMs: sample.durationMs, ok: sample.ok })),
    elapsedMs,
  );
  const sseSummary = summarizeSamples(
    sse.map((sample) => ({ durationMs: sample.durationMs, ok: sample.ok })),
    elapsedMs,
  );
  const summary: WorkloadSummary = {
    formatVersion: 1,
    runId,
    sourceCommit: input.fixtureManifest.sourceCommit,
    fixtureSha256: input.fixtureManifest.manuscriptSha256,
    apiBaseUrl: input.apiBaseUrl,
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    elapsedMs,
    profile,
    overall: summarizeSamples(
      samples.map((sample) => ({ durationMs: sample.durationMs, ok: sample.ok })),
      elapsedMs,
    ),
    byOperation,
    targets: {
      interactiveReadP95Ms: interactiveSummary.p95Ms,
      interactiveReadP99Ms: interactiveSummary.p99Ms,
      searchP95Ms: searchSummary.p95Ms,
      sseDeliveryP95Ms: sseSummary.p95Ms,
      firstTokenMs: null,
    },
    database: {
      sizeBytes: afterSizes.sizeBytes,
      tableBytes: afterSizes.tableBytes,
      indexBytes: afterSizes.indexBytes,
      xactCommit: after.xactCommit - before.xactCommit,
      blocksRead: after.blocksRead - before.blocksRead,
      blocksHit: after.blocksHit - before.blocksHit,
      tempBytes: after.tempBytes - before.tempBytes,
      deadlocks: after.deadlocks - before.deadlocks,
      queueWaitP95Ms: after.queueWaitP95Ms,
      queueWaitMaxMs: after.queueWaitMaxMs,
      jobStatusCounts: after.jobStatusCounts,
    },
    storage: {
      objectCount: finalStorage.objectCount,
      objectBytes: finalStorage.objectBytes ?? initialStorage.objectBytes,
      metricsUrl: input.storageMetricsUrl ?? "http://127.0.0.1:9000/minio/v2/metrics/cluster",
    },
    cost: {
      modelCostCny: modelCost,
      infrastructureCostCny: null,
      note: "Infrastructure cost requires an approved host cost rate and is decision-required.",
    },
    resources,
    errors: samples
      .filter((sample) => !sample.ok)
      .slice(0, 1_000)
      .map((sample) => ({
        operation: sample.operation,
        status: sample.status,
        errorCode: sample.errorCode,
        requestPath: sample.requestPath,
      })),
    artifacts: {
      rawSamplesPath: rawSamplesPath.replaceAll("\\", "/"),
      summaryPath: summaryPath.replaceAll("\\", "/"),
    },
  };
  await writeJsonArtifact(summaryPath, summary);
  return summary;
}

async function runWorker(input: {
  workerIndex: number;
  deadline: number;
  rampSeconds: number;
  concurrency: number;
  fixture: FixtureManifest;
  profile: WorkloadProfile;
  pool: ReturnType<typeof createDatabasePool>;
  client: ReturnType<typeof apiClient>;
  onceResults: Map<string, Promise<RequestResult>>;
  activeOnce: Set<string>;
  runNonce: string;
  emit(sample: Omit<WorkloadSample, "sequence" | "runId">): void;
}): Promise<void> {
  if (input.rampSeconds > 0) {
    const delay = Math.floor((input.rampSeconds * 1_000 * input.workerIndex) / input.concurrency);
    await sleep(delay);
  }
  let localCounter = 0;
  const random = mulberry32(input.fixture.seed ^ Math.imul(input.workerIndex + 1, 0x9e3779b1));
  while (Date.now() < input.deadline) {
    localCounter += 1;
    let operation = chooseOperation(input.profile, random);
    const canRunOnce = ![
      "canon-submit",
      "index-rebuild",
      "sse-events",
      "export",
      "batch-jobs",
    ].includes(operation);
    if (!canRunOnce && input.onceResults.has(operation)) {
      operation = "chapter-read";
    }
    if (!canRunOnce && input.activeOnce.has(operation)) {
      operation = "chapter-read";
    }
    if (!canRunOnce) {
      input.activeOnce.add(operation);
    }
    const startedAt = new Date();
    let method = "GET";
    let requestPath = "/";
    let result: RequestResult;
    try {
      const executor = operationExecutor({
        operation,
        workerIndex: input.workerIndex,
        localCounter,
        fixture: input.fixture,
        pool: input.pool,
        client: input.client,
        onceResults: input.onceResults,
        runNonce: input.runNonce,
      });
      const executed = await executor();
      method = executed.method;
      requestPath = executed.requestPath;
      result = executed.result;
    } catch (error) {
      result = {
        status: null,
        ok: false,
        responseBytes: 0,
        errorCode: error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN_ERROR",
        body: null,
      };
    } finally {
      if (!canRunOnce) {
        input.activeOnce.delete(operation);
      }
    }
    const finishedAt = new Date();
    input.emit({
      workerId: input.workerIndex,
      operation,
      method,
      requestPath,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: result.durationMs ?? finishedAt.getTime() - startedAt.getTime(),
      status: result.status,
      ok: result.ok,
      responseBytes: result.responseBytes,
      errorCode: result.errorCode,
    });
  }
}

function operationExecutor(input: {
  operation: WorkloadOperationId;
  workerIndex: number;
  localCounter: number;
  fixture: FixtureManifest;
  pool: ReturnType<typeof createDatabasePool>;
  client: ReturnType<typeof apiClient>;
  onceResults: Map<string, Promise<RequestResult>>;
  runNonce: string;
}): OperationExecutor {
  const work = input.fixture.ids.workId;
  const branch = input.fixture.ids.mainBranchId;
  const branchSegment = `/works/${work}/branches/${branch}`;
  const chapterNumber =
    ((input.workerIndex * 37 + input.localCounter * 11) % (input.fixture.chapterCount - 1)) + 1;
  const chapterId = deterministicUuid(input.fixture.seed, `chapter:${chapterNumber}`);
  const writeChapterNumber =
    ((input.workerIndex * 100 + input.localCounter) % (input.fixture.chapterCount - 2)) + 1;
  const writeChapterId = deterministicUuid(
    input.fixture.seed,
    `chapter:${writeChapterNumber % 50 === 0 ? writeChapterNumber + 1 : writeChapterNumber}`,
  );
  const entityIndex = ((input.workerIndex * 13 + input.localCounter * 7) % 100) + 1;
  const entityId = deterministicUuid(input.fixture.seed, `entity:${entityIndex}`);
  const mutableEntityId = deterministicUuid(
    input.fixture.seed,
    `entity:${Math.min(8, input.workerIndex + 1)}`,
  );
  const searchTerm = `锚点${((input.localCounter * 17) % input.fixture.chapterCount) + 1}`;
  const request = input.client.request;

  switch (input.operation) {
    case "overview-read": {
      const requestPath = `/works/${work}?branchId=${branch}`;
      return async () => ({ method: "GET", requestPath, result: await request(requestPath) });
    }
    case "chapter-read": {
      const requestPath = `${branchSegment}/chapters/${chapterId}`;
      return async () => ({ method: "GET", requestPath, result: await request(requestPath) });
    }
    case "chapter-history": {
      const requestPath = `${branchSegment}/chapters/${chapterId}/versions?limit=20`;
      return async () => ({ method: "GET", requestPath, result: await request(requestPath) });
    }
    case "story-bible-read": {
      const requestPath = `${branchSegment}/story-bible`;
      return async () => ({ method: "GET", requestPath, result: await request(requestPath) });
    }
    case "entity-detail": {
      const requestPath = `${branchSegment}/entities/${entityId}`;
      return async () => ({ method: "GET", requestPath, result: await request(requestPath) });
    }
    case "timeline-read": {
      const requestPath = `${branchSegment}/world/timeline`;
      return async () => ({ method: "GET", requestPath, result: await request(requestPath) });
    }
    case "branch-head-read": {
      const requestPath = `/works/${work}/branches`;
      return async () => ({ method: "GET", requestPath, result: await request(requestPath) });
    }
    case "title-search": {
      const requestPath = `${branchSegment}/search?q=${encodeURIComponent(searchTerm)}&limit=20`;
      return async () => ({ method: "GET", requestPath, result: await request(requestPath) });
    }
    case "body-search": {
      const requestPath = `${branchSegment}/search?q=${encodeURIComponent("山雨")}&limit=20`;
      return async () => ({ method: "GET", requestPath, result: await request(requestPath) });
    }
    case "alias-search": {
      const requestPath = `${branchSegment}/search?q=${encodeURIComponent("别名")}&limit=20`;
      return async () => ({ method: "GET", requestPath, result: await request(requestPath) });
    }
    case "context-compile": {
      const requestPath = `${branchSegment}/chapters/${chapterId}/context-preview?tokenBudget=30000`;
      return async () => ({ method: "GET", requestPath, result: await request(requestPath) });
    }
    case "chapter-save": {
      const requestPath = `${branchSegment}/chapters/${writeChapterId}/versions`;
      const detailPath = `${branchSegment}/chapters/${writeChapterId}`;
      return async () => {
        const detail = await request(detailPath);
        const data = asRecord(asRecord(detail.body)?.data);
        const current = asRecord(data?.currentVersion);
        const version = numberValue(data?.version) ?? 1;
        const content = stringValue(current?.content) ?? "容量基准写入";
        const result = await request(requestPath, {
          method: "POST",
          body: {
            version,
            content: `${content}\n容量写入锚点：${input.workerIndex}-${input.localCounter}`,
          },
          idempotencyKey: `save-${input.workerIndex}-${input.localCounter}`,
        });
        return { method: "POST", requestPath, result };
      };
    }
    case "settings-update": {
      const detailPath = `${branchSegment}/entities/${mutableEntityId}`;
      const requestPath = `${branchSegment}/entities/${mutableEntityId}`;
      return async () => {
        const detail = await request(detailPath);
        const data = asRecord(asRecord(detail.body)?.data);
        const version = numberValue(data?.version) ?? 1;
        const result = await request(requestPath, {
          method: "PATCH",
          body: {
            version,
            summary: `容量基准设置更新 ${input.workerIndex}-${input.localCounter}`,
          },
        });
        return { method: "PATCH", requestPath, result };
      };
    }
    case "canon-submit": {
      const canonChapterNumber = Math.max(1, input.fixture.chapterCount - 1);
      const canonChapterId = deterministicUuid(input.fixture.seed, `chapter:${canonChapterNumber}`);
      const detailPath = `${branchSegment}/chapters/${canonChapterId}`;
      const requestPath = `${branchSegment}/chapters/${canonChapterId}/canon/commit`;
      return async () => {
        const detail = await request(detailPath);
        const data = asRecord(asRecord(detail.body)?.data);
        const current = asRecord(data?.currentVersion);
        const chapterVersionId = stringValue(current?.id);
        const result = await once(input.onceResults, input.operation, () =>
          request(requestPath, {
            method: "POST",
            body: { chapterVersionId },
            idempotencyKey: `canon-${input.fixture.seed}-${input.runNonce}`,
          }),
        );
        return { method: "POST", requestPath, result };
      };
    }
    case "index-rebuild": {
      const requestPath = `${branchSegment}/search/rebuild`;
      return async () => {
        const result = await once(input.onceResults, input.operation, async () => {
          const started = await request(requestPath, { method: "POST", body: {} });
          const runId = stringValue(asRecord(asRecord(started.body)?.data)?.runId);
          if (!started.ok || !runId) {
            return started;
          }
          let current = started;
          for (let attempt = 0; attempt < 200; attempt += 1) {
            const status = stringValue(asRecord(asRecord(current.body)?.data)?.status);
            if (status === "completed" || status === "failed") {
              return current;
            }
            current = await request(`${branchSegment}/search/rebuilds/${runId}/process`, {
              method: "POST",
              body: {},
            });
          }
          return {
            ...current,
            ok: false,
            errorCode: "INDEX_REBUILD_TIMEOUT",
          };
        });
        return { method: "POST", requestPath, result };
      };
    }
    case "sse-events": {
      const jobId = deterministicUuid(input.fixture.seed, "job:child:1");
      const requestPath = `${branchSegment}/jobs/${jobId}/events`;
      return async () => {
        const result = await once(input.onceResults, input.operation, () =>
          measureSseDelivery({
            client: input.client,
            pool: input.pool,
            fixture: input.fixture,
            jobId,
            requestPath,
          }),
        );
        return { method: "GET", requestPath, result };
      };
    }
    case "export": {
      const requestPath = `${branchSegment}/exports`;
      return async () => ({
        method: "POST",
        requestPath,
        result: await once(input.onceResults, input.operation, async () => {
          const created = await request(requestPath, {
            method: "POST",
            body: {
              format: "markdown",
              scope: { kind: "book" },
              sourceVersionNodeId: null,
            },
            idempotencyKey: `export-${input.fixture.seed}-${input.runNonce}`,
          });
          const exportId = stringValue(asRecord(asRecord(created.body)?.data)?.id);
          if (!created.ok || !exportId) {
            return created;
          }
          let current = created;
          for (let attempt = 0; attempt < 240; attempt += 1) {
            const status = stringValue(asRecord(asRecord(current.body)?.data)?.status);
            if (status === "completed" || status === "failed" || status === "expired") {
              return current;
            }
            await sleep(250);
            current = await request(`${branchSegment}/exports/${exportId}`);
          }
          return { ...current, ok: false, errorCode: "EXPORT_TIMEOUT" };
        }),
      });
    }
    case "batch-jobs": {
      return async () => {
        const result = await once(input.onceResults, input.operation, async () => {
          const outcomes = await Promise.all(
            [1, 2].map(async (planIndex) => {
              const create = await request(`${branchSegment}/batch-plans`, {
                method: "POST",
                body: {
                  scope: {
                    type: "range",
                    fromChapterNumber: 1,
                    toChapterNumber: 5,
                  },
                  approvalMode: "per_volume",
                  priorityClass: "batch",
                  costBudgetPolicy: {
                    chapterMaxCostCny: 2.5,
                    volumeMaxCostCny: null,
                    taskMaxCostCny: null,
                    perTenThousandCharsMaxCostCny: null,
                  },
                  maxConcurrency: 2,
                },
                idempotencyKey: `capacity-plan-${input.fixture.seed}-${input.runNonce}-${planIndex}`,
              });
              if (!create.ok) {
                return create;
              }
              const planId = stringValue(asRecord(asRecord(create.body)?.data)?.id);
              if (!planId) {
                return create;
              }
              const started = await request(`${branchSegment}/batch-plans/${planId}/start`, {
                method: "POST",
                body: { reason: "capacity benchmark" },
                idempotencyKey: `capacity-start-${input.fixture.seed}-${input.runNonce}-${planIndex}`,
              });
              let current = started;
              if (started.ok) {
                for (let attempt = 0; attempt < 10; attempt += 1) {
                  const status = stringValue(asRecord(asRecord(current.body)?.data)?.status);
                  if (status === "completed" || status === "failed" || status === "cancelled") {
                    break;
                  }
                  await sleep(500);
                  current = await request(`${branchSegment}/batch-plans/${planId}`);
                }
              }
              return {
                ...started,
                ok: create.ok && started.ok && current.ok,
                responseBytes: create.responseBytes + started.responseBytes,
                errorCode: started.errorCode ?? current.errorCode ?? create.errorCode ?? null,
              };
            }),
          );
          return {
            status: Math.max(...outcomes.map((outcome) => outcome.status ?? 0)),
            ok: outcomes.every((outcome) => outcome.ok),
            responseBytes: outcomes.reduce((total, outcome) => total + outcome.responseBytes, 0),
            errorCode: outcomes.find((outcome) => outcome.errorCode)?.errorCode ?? null,
            body: outcomes,
          };
        });
        return {
          method: "POST",
          requestPath: `${branchSegment}/batch-plans`,
          result,
        };
      };
    }
  }
}

function apiClient(input: {
  apiBaseUrl: string;
  origin: string;
  sessionToken: string;
  csrfToken: string;
}) {
  const base = input.apiBaseUrl.replace(/\/+$/, "");
  return {
    async request(
      requestPath: string,
      options: {
        method?: string;
        body?: unknown;
        headers?: Record<string, string>;
        idempotencyKey?: string;
        timeoutMs?: number;
      } = {},
    ): Promise<RequestResult> {
      const method = options.method ?? "GET";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
      try {
        const response = await fetch(`${base}/api/v1${requestPath}`, {
          method,
          headers: {
            cookie: `nb_session=${input.sessionToken}; nb_csrf=${input.csrfToken}`,
            origin: input.origin,
            "x-csrf-token": input.csrfToken,
            "user-agent": "novel-brain-capacity-benchmark/1",
            ...(options.body === undefined ? {} : { "content-type": "application/json" }),
            ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
            ...options.headers,
          },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          signal: controller.signal,
        });
        const text = await response.text();
        let body: unknown = null;
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        return {
          status: response.status,
          ok: response.ok,
          responseBytes: Buffer.byteLength(text, "utf8"),
          errorCode: response.ok ? null : apiErrorCode(body),
          body,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
    async requestSseFirstEvent(
      requestPath: string,
      previousEventId: string | null,
    ): Promise<RequestResult> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(`${base}/api/v1${requestPath}`, {
          headers: {
            cookie: `nb_session=${input.sessionToken}; nb_csrf=${input.csrfToken}`,
            origin: input.origin,
            "x-csrf-token": input.csrfToken,
            "user-agent": "novel-brain-capacity-benchmark/1",
            accept: "text/event-stream",
            ...(previousEventId ? { "last-event-id": previousEventId } : {}),
          },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          return {
            status: response.status,
            ok: false,
            responseBytes: 0,
            errorCode: `SSE_HTTP_${response.status}`,
            body: null,
          };
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        let bytes = 0;
        while (!text.includes("\n\n")) {
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }
          bytes += chunk.value.byteLength;
          text += decoder.decode(chunk.value, { stream: true });
        }
        await reader.cancel();
        const dataLine = text.split(/\r?\n/u).find((line) => line.startsWith("data:"));
        let body: unknown = null;
        if (dataLine) {
          try {
            body = JSON.parse(dataLine.slice("data:".length).trim());
          } catch {
            body = dataLine;
          }
        }
        return {
          status: response.status,
          ok: Boolean(dataLine),
          responseBytes: bytes,
          errorCode: dataLine ? null : "SSE_EVENT_MISSING",
          body,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

async function once(
  results: Map<string, Promise<RequestResult>>,
  key: string,
  operation: () => Promise<RequestResult>,
): Promise<RequestResult> {
  const existing = results.get(key);
  if (existing) {
    return existing;
  }
  const promise = operation();
  results.set(key, promise);
  return promise;
}

async function enqueueSseEvent(
  pool: ReturnType<typeof createDatabasePool>,
  input: { fixture: FixtureManifest; jobId: string },
): Promise<{ previousEventId: string | null; eventId: string }> {
  const result = await pool.query<{ next_sequence: number; previous_event_id: string | null }>(
    `SELECT
       COALESCE(max(sequence), 0)::int + 1 AS next_sequence,
       (SELECT id FROM job_events WHERE job_id = $1 ORDER BY sequence DESC LIMIT 1)
         AS previous_event_id
     FROM job_events WHERE job_id = $1`,
    [input.jobId],
  );
  const sequence = result.rows[0]?.next_sequence ?? 1;
  const eventId = uuidv7();
  await pool.query(
    `INSERT INTO job_events (
       id, job_id, work_id, branch_id, user_id, sequence, event_type, payload, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'job.progress', $7::jsonb, now())`,
    [
      eventId,
      input.jobId,
      input.fixture.ids.workId,
      input.fixture.ids.mainBranchId,
      input.fixture.ids.userId,
      sequence,
      JSON.stringify({ progress: Math.min(99, sequence * 10), benchmark: true }),
    ],
  );
  return {
    previousEventId: result.rows[0]?.previous_event_id ?? null,
    eventId,
  };
}

async function measureSseDelivery(input: {
  client: ReturnType<typeof apiClient>;
  pool: ReturnType<typeof createDatabasePool>;
  fixture: FixtureManifest;
  jobId: string;
  requestPath: string;
}): Promise<RequestResult> {
  const durations: number[] = [];
  const received: Array<{
    eventId: string;
    status: number | null;
    ok: boolean;
    errorCode: string | null;
  }> = [];
  for (let index = 0; index < 10; index += 1) {
    const queued = await enqueueSseEvent(input.pool, {
      fixture: input.fixture,
      jobId: input.jobId,
    });
    const startedAt = performance.now();
    const result = await input.client.requestSseFirstEvent(
      input.requestPath,
      queued.previousEventId,
    );
    const durationMs = performance.now() - startedAt;
    const receivedEventId = stringValue(asRecord(result.body)?.eventId);
    const matched = receivedEventId === queued.eventId;
    durations.push(durationMs);
    received.push({
      eventId: queued.eventId,
      status: result.status,
      ok: result.ok && matched,
      errorCode: result.errorCode ?? (matched ? null : "SSE_EVENT_ID_MISMATCH"),
    });
  }
  return {
    status: received.at(-1)?.status ?? null,
    ok: received.every((event) => event.ok),
    responseBytes: received.length,
    errorCode: received.find((event) => event.errorCode)?.errorCode ?? null,
    body: received,
    durationMs:
      percentile(
        [...durations].sort((left, right) => left - right),
        0.95,
      ) ?? 0,
  };
}

async function databaseSizes(pool: ReturnType<typeof createDatabasePool>): Promise<{
  sizeBytes: number;
  tableBytes: number;
  indexBytes: number;
}> {
  const result = await pool.query<{
    size_bytes: string;
    table_bytes: string;
    index_bytes: string;
  }>(
    `SELECT
       pg_database_size(current_database())::text AS size_bytes,
       COALESCE(sum(pg_table_size(c.oid)), 0)::text AS table_bytes,
       COALESCE(sum(pg_indexes_size(c.oid)), 0)::text AS index_bytes
     FROM pg_class c
     INNER JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'`,
  );
  return {
    sizeBytes: Number(result.rows[0]?.size_bytes ?? 0),
    tableBytes: Number(result.rows[0]?.table_bytes ?? 0),
    indexBytes: Number(result.rows[0]?.index_bytes ?? 0),
  };
}

async function databaseRuntime(
  pool: ReturnType<typeof createDatabasePool>,
  since: Date,
): Promise<{
  xactCommit: number;
  blocksRead: number;
  blocksHit: number;
  tempBytes: number;
  deadlocks: number;
  queueWaitP95Ms: number | null;
  queueWaitMaxMs: number | null;
  jobStatusCounts: Record<string, number>;
}> {
  const database = await pool.query<{
    xact_commit: string;
    blks_read: string;
    blks_hit: string;
    temp_bytes: string;
    deadlocks: string;
  }>(
    `SELECT xact_commit::text, blks_read::text, blks_hit::text,
            temp_bytes::text, deadlocks::text
     FROM pg_stat_database WHERE datname = current_database()`,
  );
  const waits = await pool.query<{ p95_ms: string | null; max_ms: string | null }>(
    `SELECT
       percentile_disc(0.95) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM (started_at - created_at)) * 1000
       )::text AS p95_ms,
       max(EXTRACT(EPOCH FROM (started_at - created_at)) * 1000)::text AS max_ms
     FROM jobs
     WHERE started_at IS NOT NULL AND created_at >= $1`,
    [since],
  );
  const row = database.rows[0];
  const jobs = await pool.query<{ status: string; count: string }>(
    `SELECT status, count(*)::text AS count
     FROM jobs
     WHERE created_at >= $1
     GROUP BY status`,
    [since],
  );
  return {
    xactCommit: Number(row?.xact_commit ?? 0),
    blocksRead: Number(row?.blks_read ?? 0),
    blocksHit: Number(row?.blks_hit ?? 0),
    tempBytes: Number(row?.temp_bytes ?? 0),
    deadlocks: Number(row?.deadlocks ?? 0),
    queueWaitP95Ms: nullableNumber(waits.rows[0]?.p95_ms),
    queueWaitMaxMs: nullableNumber(waits.rows[0]?.max_ms),
    jobStatusCounts: Object.fromEntries(jobs.rows.map((job) => [job.status, Number(job.count)])),
  };
}

async function modelCostCny(
  pool: ReturnType<typeof createDatabasePool>,
  since: Date,
): Promise<number> {
  const result = await pool.query<{ cost: string }>(
    `SELECT COALESCE(sum(cost_cny), 0)::text AS cost
     FROM model_calls WHERE created_at >= $1`,
    [since],
  );
  return Number(result.rows[0]?.cost ?? 0);
}

async function sampleResources(metricsUrl: string): Promise<RuntimeSample> {
  let containers: RuntimeSample["containers"] = [];
  try {
    const output = execFileSync("docker", ["stats", "--no-stream", "--format", "{{json .}}"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    containers = output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const row = JSON.parse(line) as Record<string, string>;
        const memory = splitPair(row.MemUsage);
        const block = splitPair(row.BlockIO);
        const network = splitPair(row.NetIO);
        return {
          name: row.Name ?? "unknown",
          cpuPercent: parsePercent(row.CPUPerc),
          memoryBytes: parseBytes(memory?.[0]),
          blockReadBytes: parseBytes(block?.[0]),
          blockWriteBytes: parseBytes(block?.[1]),
          networkInputBytes: parseBytes(network?.[0]),
          networkOutputBytes: parseBytes(network?.[1]),
        };
      })
      .filter((container) => container.name.includes("novel-brain"));
  } catch {
    containers = [];
  }
  const storageMetrics = await fetchMetrics(metricsUrl);
  return {
    capturedAt: new Date().toISOString(),
    containers,
    storageMetrics,
  };
}

async function storageMetrics(metricsUrl: string): Promise<{
  objectBytes: number | null;
  objectCount: number | null;
}> {
  const metrics = await fetchMetrics(metricsUrl);
  return {
    objectBytes:
      metrics.minio_cluster_usage_total_bytes ?? metrics.minio_bucket_usage_total_bytes ?? null,
    objectCount:
      metrics.minio_cluster_objects_total ??
      metrics.minio_cluster_usage_object_total ??
      metrics.minio_bucket_objects_total ??
      null,
  };
}

async function fetchMetrics(url: string): Promise<Record<string, number>> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) {
      return {};
    }
    return parsePrometheusMetrics(await response.text());
  } catch {
    return {};
  }
}

export function parsePrometheusMetrics(text: string): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match =
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.exec(
        line.trim(),
      );
    if (!match) {
      continue;
    }
    const name = match[1]!;
    const value = Number(match[2]);
    metrics[name] = (metrics[name] ?? 0) + value;
  }
  return metrics;
}

function createSampleWriter(filePath: string): SampleWriter {
  let chain = Promise.resolve();
  return {
    write(sample) {
      chain = chain.then(() => appendFile(filePath, `${JSON.stringify(sample)}\n`, "utf8"));
    },
    async close() {
      await chain;
    },
  };
}

function chooseOperation(profile: WorkloadProfile, random: () => number): WorkloadOperationId {
  const total = profile.operations.reduce((sum, operation) => sum + operation.weight, 0);
  let threshold = random() * total;
  for (const operation of profile.operations) {
    threshold -= operation.weight;
    if (threshold <= 0) {
      return operation.id;
    }
  }
  return profile.operations.at(-1)!.id;
}

function apiErrorCode(body: unknown): string | null {
  return stringValue(asRecord(asRecord(body)?.error)?.code);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parsePercent(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseFloat(value.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function splitPair(value: string | undefined): string[] | null {
  return value ? value.split("/") : null;
}

function parseBytes(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = /^\s*([\d.]+)\s*([kmgtpe]?i?b|[kmgtpe]?b)\s*$/i.exec(value);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const powers: Record<string, number> = {
    b: 0,
    kb: 1,
    kib: 1,
    mb: 2,
    mib: 2,
    gb: 3,
    gib: 3,
    tb: 4,
    tib: 4,
  };
  const power = powers[unit];
  return power === undefined ? null : Math.round(amount * 1024 ** power);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}
