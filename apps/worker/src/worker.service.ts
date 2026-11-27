import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import {
  ACCOUNT_PURGE_JOB,
  ACCOUNT_PURGE_TICK_JOB,
  BATCH_TICK_JOB,
  GENERATE_BLUEPRINT_JOB,
  GENERATE_CHAPTER_JOB,
  GENERATE_GOLDEN_THREE_JOB,
  PROCESS_IMPORT_JOB,
  SUMMARY_REBUILD_JOB,
  EXPORT_WORK_JOB,
  WORKER_QUEUE_NAME,
  WRITE_ACTION_JOB,
  workerJobSchema,
  type ExportWorkJob,
  type WorkerJob,
} from "@novel-brain/contracts";
import {
  ACCOUNT_PURGE_JOB_ATTEMPTS,
  ACCOUNT_PURGE_RETRY_DELAY_MS,
  accountPurgeJobId,
  accountPurgeJobPayload,
  accountPurgeTickJobPayload,
  emitTraceEnvelope,
  resolveTracePolicy,
  type TracePolicy,
} from "@novel-brain/core";
import { Queue, Worker as BullWorker, type Job } from "bullmq";
import type Redis from "ioredis";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GenerationJobProcessor } from "./generation/generation.processor";
import { BlueprintJobProcessor } from "./blueprints/blueprint.processor";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GoldenThreeJobProcessor } from "./golden-three/golden-three.processor";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BatchPlanTickProcessor } from "./batch-plan/batch-plan.processor";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SummaryRebuildProcessor } from "./summaries/summary-rebuild.processor";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WritingActionProcessor } from "./writing-actions/writing-action.processor";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AccountPurgeProcessor } from "./account-lifecycle/account-purge.processor";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorkExportProcessor } from "./exports/work-export.processor";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorkPurgeProcessor } from "./works/work-purge.processor";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ManuscriptImportProcessor } from "./imports/manuscript-import.processor";
import { SafePinoLogger } from "./logging/safe-logger";
import {
  durableJobStatusToOutcome,
  isFinalJobAttempt,
  WorkerOperationalMetricsRecorder,
  type WorkerJobOutcome,
} from "./metrics/operational-metrics-recorder";
import { WORKER_REDIS } from "./metrics/operational-metrics.tokens";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorkerGenerationRepository } from "./generation/generation.repository";

@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger: SafePinoLogger;
  private readonly tracePolicy: TracePolicy;
  private readonly queue: Queue<WorkerJob>;
  private readonly worker: BullWorker<WorkerJob, void>;

  constructor(
    private readonly processor: GenerationJobProcessor,
    private readonly blueprintProcessor: BlueprintJobProcessor,
    private readonly goldenThreeProcessor: GoldenThreeJobProcessor,
    private readonly batchPlanProcessor: BatchPlanTickProcessor,
    private readonly summaryProcessor: SummaryRebuildProcessor,
    private readonly writingActionProcessor: WritingActionProcessor,
    private readonly accountPurgeProcessor: AccountPurgeProcessor,
    private readonly workExportProcessor: WorkExportProcessor,
    private readonly workPurgeProcessor: WorkPurgeProcessor,
    private readonly manuscriptImportProcessor: ManuscriptImportProcessor,
    private readonly generationRepository: WorkerGenerationRepository,
    @Inject(WORKER_REDIS) private readonly connection: Redis,
    @Inject(WorkerOperationalMetricsRecorder)
    private readonly metrics: WorkerOperationalMetricsRecorder,
  ) {
    const tracePolicy = resolveTracePolicy(process.env);
    this.tracePolicy = tracePolicy;
    this.logger = new SafePinoLogger();
    this.logger.info({
      event: "worker.trace_policy",
      mode: tracePolicy.mode,
      retentionDays: tracePolicy.retentionDays,
      endpointConfigured: tracePolicy.endpoint !== null,
    });
    this.processor.setTraceLogger(this.logger);
    this.processor.configureRecovery({ maxAutomaticAttempts: 3 });
    this.writingActionProcessor.setTraceLogger(this.logger);
    this.logger.setTelemetrySink((payload) => {
      void this.metrics.recordModelCall(payload);
    });
    this.queue = new Queue<WorkerJob>(WORKER_QUEUE_NAME, {
      connection: this.connection,
    });
    this.worker = new BullWorker<WorkerJob, void>(
      WORKER_QUEUE_NAME,
      (job) => this.processJob(job),
      {
        connection: this.connection,
        concurrency: 1,
        lockDuration: positiveIntegerEnvironment("WORKER_LOCK_DURATION_MS", 30_000),
        stalledInterval: positiveIntegerEnvironment("WORKER_STALLED_INTERVAL_MS", 30_000),
        name: "novelbrain-worker",
      },
    );
  }

  async onApplicationBootstrap(): Promise<void> {
    await emitTraceEnvelope(this.tracePolicy, {
      name: "service.started",
      occurredAt: new Date().toISOString(),
      attributes: { service: "worker", event: "worker.ready" },
    });
    await this.queue.waitUntilReady();
    await this.worker.waitUntilReady();
    await this.queue.upsertJobScheduler(
      "account-purge-scan",
      { every: 60_000 },
      {
        name: ACCOUNT_PURGE_TICK_JOB,
        data: accountPurgeTickJobPayload(),
        opts: {
          removeOnComplete: true,
          removeOnFail: true,
          attempts: 1,
        },
      },
    );
    this.logger.info(
      {
        event: "worker.ready",
        queue: WORKER_QUEUE_NAME,
        jobTypes: [
          GENERATE_CHAPTER_JOB,
          GENERATE_BLUEPRINT_JOB,
          GENERATE_GOLDEN_THREE_JOB,
          WRITE_ACTION_JOB,
          SUMMARY_REBUILD_JOB,
          BATCH_TICK_JOB,
          ACCOUNT_PURGE_JOB,
          ACCOUNT_PURGE_TICK_JOB,
          EXPORT_WORK_JOB,
          PROCESS_IMPORT_JOB,
        ],
      },
      "Worker is consuming its queue",
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    if (this.connection.status === "ready") {
      await this.connection.quit();
    } else {
      this.connection.disconnect();
    }
  }

  private async processJob(job: Job<WorkerJob>): Promise<void> {
    const payload = workerJobSchema.parse(job.data);
    this.logger.metric("worker.job.started", {
      job_type: payload.jobType,
      queue: WORKER_QUEUE_NAME,
    });
    this.logger.info(
      {
        event: "worker.job.started",
        jobType: payload.jobType,
        ...jobLogContext(payload),
      },
      "Processing typed worker job",
    );
    let outcome: WorkerJobOutcome | undefined;
    try {
      if (payload.jobType === ACCOUNT_PURGE_TICK_JOB) {
        await this.runMaintenance(
          "account_export_cleanup",
          () => this.accountPurgeProcessor.cleanupExpiredExportReceipts(),
          undefined,
        );
        await this.runMaintenance(
          "work_export_cleanup",
          () => this.workExportProcessor.cleanupExpiredReceipts(),
          undefined,
        );
        await this.runMaintenance(
          "work_export_recovery",
          async () => {
            for (const pending of await this.workExportProcessor.listPendingJobs()) {
              await this.enqueueRecoveredWorkExport(pending);
            }
          },
          undefined,
        );
        await this.runMaintenance(
          "manuscript_import_recovery",
          () =>
            this.manuscriptImportProcessor.recoverPendingJobs((pending) =>
              this.enqueueRecoveredImport(pending),
            ),
          undefined,
        );
        await this.runMaintenance(
          "work_trash_purge",
          () => this.workPurgeProcessor.cleanupDue(),
          undefined,
        );
        const dueRequestIds = await this.runMaintenance(
          "account_purge_scan",
          () => this.accountPurgeProcessor.listDueRequestIds(),
          [],
        );
        for (const deletionRequestId of dueRequestIds) {
          await this.queue.add(ACCOUNT_PURGE_JOB, accountPurgeJobPayload(deletionRequestId), {
            jobId: accountPurgeJobId(deletionRequestId),
            removeOnComplete: true,
            removeOnFail: true,
            attempts: ACCOUNT_PURGE_JOB_ATTEMPTS,
            backoff: { type: "exponential", delay: ACCOUNT_PURGE_RETRY_DELAY_MS },
          });
        }
        outcome = "succeeded";
      } else if (payload.jobType === ACCOUNT_PURGE_JOB) {
        const result = await this.accountPurgeProcessor.process(payload);
        outcome = result.kind === "failed" ? "failed" : "succeeded";
      } else if (payload.jobType === SUMMARY_REBUILD_JOB) {
        outcome = await this.summaryProcessor.process(payload);
      } else if (payload.jobType === BATCH_TICK_JOB) {
        await this.batchPlanProcessor.process(payload);
      } else if (payload.jobType === WRITE_ACTION_JOB) {
        await this.writingActionProcessor.process(payload);
      } else if (payload.jobType === EXPORT_WORK_JOB) {
        outcome = await this.workExportProcessor.process(payload, {
          number: job.attemptsMade + 1,
          maxAttempts: Math.max(1, job.opts.attempts ?? 1),
        });
      } else if (payload.jobType === PROCESS_IMPORT_JOB) {
        outcome = await this.manuscriptImportProcessor.process(payload);
      } else if (payload.jobType === GENERATE_GOLDEN_THREE_JOB) {
        await this.goldenThreeProcessor.process(payload);
      } else if (payload.jobType === GENERATE_BLUEPRINT_JOB) {
        await this.blueprintProcessor.process(payload);
      } else if (payload.jobType === GENERATE_CHAPTER_JOB) {
        await this.processor.process(payload);
        await this.batchPlanProcessor.onChildFinished(payload);
      } else {
        throw new Error("Unsupported worker job type");
      }
      if (!outcome) {
        outcome = await this.completedJobOutcome(payload);
      }
    } catch (error) {
      if (isFinalJobAttempt(job.attemptsMade, job.opts.attempts)) {
        outcome = "failed";
      }
      throw error;
    } finally {
      if (outcome) {
        void this.metrics.recordJob(payload.jobType, outcome);
      }
    }
  }

  private async enqueueRecoveredWorkExport(payload: ExportWorkJob): Promise<void> {
    const existing = await this.queue.getJob(payload.jobId);
    if (!existing) {
      await this.addWorkExportJob(payload);
      return;
    }
    const state = await existing.getState();
    if (state === "failed" || state === "completed") {
      await existing.retry(state, { resetAttemptsMade: true });
      return;
    }
    if (!["active", "delayed", "prioritized", "waiting", "waiting-children"].includes(state)) {
      await existing.remove();
      await this.addWorkExportJob(payload);
    }
  }

  private async addWorkExportJob(payload: ExportWorkJob): Promise<void> {
    await this.queue.add(EXPORT_WORK_JOB, payload, {
      jobId: payload.jobId,
      removeOnComplete: false,
      removeOnFail: false,
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
    });
  }

  private async enqueueRecoveredImport(payload: WorkerJob): Promise<void> {
    if (payload.jobType !== PROCESS_IMPORT_JOB) {
      return;
    }
    const existing = await this.queue.getJob(payload.idempotencyKey);
    if (!existing) {
      await this.queue.add(PROCESS_IMPORT_JOB, payload, {
        jobId: payload.idempotencyKey,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
      });
      return;
    }
    const state = await existing.getState();
    if (state === "failed" || state === "completed") {
      await existing.remove();
      await this.queue.add(PROCESS_IMPORT_JOB, payload, {
        jobId: payload.idempotencyKey,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
      });
    }
  }

  private async runMaintenance<T>(
    operation: string,
    action: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await action();
    } catch {
      this.logger.warn(
        { event: "worker.maintenance.failed", operation },
        "Independent maintenance task failed",
      );
      return fallback;
    }
  }

  private async completedJobOutcome(payload: WorkerJob): Promise<WorkerJobOutcome | undefined> {
    if (!("jobId" in payload) || !("actorId" in payload)) {
      return "succeeded";
    }
    try {
      return durableJobStatusToOutcome(
        await this.generationRepository.jobStatus({
          jobId: payload.jobId,
          userId: payload.actorId,
        }),
      );
    } catch {
      return undefined;
    }
  }
}

function jobLogContext(payload: WorkerJob): Record<string, unknown> {
  switch (payload.jobType) {
    case ACCOUNT_PURGE_JOB:
      return { deletionRequestId: payload.deletionRequestId };
    case ACCOUNT_PURGE_TICK_JOB:
      return {};
    case SUMMARY_REBUILD_JOB:
      return { runId: payload.runId };
    case BATCH_TICK_JOB:
      return { planId: payload.planId };
    case EXPORT_WORK_JOB:
      return { jobId: payload.jobId, exportId: payload.exportId };
    case PROCESS_IMPORT_JOB:
      return { importId: payload.importId, checkpointStep: payload.checkpoint.nextProcessSequence };
    case GENERATE_GOLDEN_THREE_JOB:
      return {
        jobId: payload.jobId,
        checkpointStep: payload.checkpoint.stepKey ?? payload.checkpoint.stage,
      };
    case GENERATE_BLUEPRINT_JOB:
      return {
        jobId: payload.jobId,
        checkpointStep: payload.checkpoint.step,
      };
    default:
      return { jobId: payload.jobId, checkpointStep: payload.checkpoint.step };
  }
}

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? "");
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
