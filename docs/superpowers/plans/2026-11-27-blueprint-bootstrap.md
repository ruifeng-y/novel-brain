# Story Blueprint Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a one-line idea automatically produce a durable, budgeted story blueprint that the author can review and explicitly confirm before it becomes authoritative.

**Architecture:** Add one `work_blueprints` aggregate and one `generate_blueprint` Worker job. The Worker writes staged JSON candidates through `jobs.checkpoint` and `work_blueprints`; confirmation projects those candidates into the existing first-class story bible, settings, outline, chapter and scene tables in one transaction.

**Tech Stack:** TypeScript, Zod, NestJS, Drizzle/PostgreSQL, BullMQ/Redis, Next.js/React, Vitest, Playwright.

**Spec:** `docs/planning/blueprint-bootstrap-spec.md`

## Global Constraints

- Every command runs in native PowerShell with `shell: "powershell"` and `login: false`.
- The automatic blueprint applies only to `WorkCreateRequest.mode === "idea"`.
- The feature never writes chapter prose and never auto-starts chapter generation.
- AI candidates cannot become authoritative before the author calls the confirm API.
- Confirmation must be idempotent and atomic; a failed confirmation cannot partially lock settings or create outline rows.
- Unresolved P0 conflicts block confirmation. Missing required fields block confirmation unless the author records a non-empty `not_applicable` reason.
- Budget is checked before each provider call; the task pauses rather than silently shrinking output or changing model.
- All story tables are tenant-scoped and protected by RLS.
- Prompt text, manuscript text, model keys and private context must not enter ordinary logs or notifications.
- The review page requires an accepted prototype, UI contract row and author visual signoff before its production UI may merge.
- Use Chinese Conventional Commit subjects and bodies.

---

### Task 1: Contracts, Estimate Rule and Durable Blueprint State

**Files:**
- Create: `packages/core/src/blueprint.ts`
- Create: `packages/core/test/blueprint.test.ts`
- Create: `packages/contracts/test/blueprint.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/db/src/schema.ts`
- Generate: `packages/db/migrations/<new>/snapshot.json`
- Generate: `packages/db/migrations/<new>/migration.sql`

**Interfaces:**
- Produces: `estimateBlueprint(input: BlueprintEstimateInput): BlueprintEstimate`
- Produces: `blueprintStatusSchema`
- Produces: `workBlueprintSchema`
- Produces: `generateBlueprintJobSchema`
- Produces table `work_blueprints`

- [ ] **Step 1: Write the failing core estimate test**

Create `packages/core/test/blueprint.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { estimateBlueprint } from "../src/blueprint";

describe("estimateBlueprint", () => {
  it("scales the long blueprint deterministically from chapter length", () => {
    const estimate = estimateBlueprint({
      genre: "xianxia",
      scaleTarget: "long",
      chapterLengthTarget: 4000,
      modelRatePerTokenCny: 0.000002,
    });

    expect(estimate.planned).toEqual({ volumes: 5, chapters: 60, scenes: 120 });
    expect(estimate.estimatedTokens).toBe(198000);
    expect(estimate.defaultBudget).toEqual({
      maxTokens: 238000,
      maxCostCny: 0.6,
    });
    expect(estimate.ruleVersion).toBe("blueprint-estimate-v1");
  });

  it("clamps chapter length factor to the supported range", () => {
    expect(
      estimateBlueprint({
        genre: "history",
        scaleTarget: "short",
        chapterLengthTarget: 1000,
        modelRatePerTokenCny: 0.000002,
      }).estimatedTokens,
    ).toBe(32000);
    expect(
      estimateBlueprint({
        genre: "urban",
        scaleTarget: "short",
        chapterLengthTarget: 12000,
        modelRatePerTokenCny: 0.000002,
      }).estimatedTokens,
    ).toBe(60000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
pnpm vitest run packages/core/test/blueprint.test.ts
```

Expected: FAIL because `../src/blueprint` does not exist.

- [ ] **Step 3: Implement the deterministic estimator**

Create `packages/core/src/blueprint.ts` with:

```ts
export type BlueprintEstimateInput = {
  genre: "xianxia" | "history" | "urban";
  scaleTarget: "short" | "medium" | "long" | "epic";
  chapterLengthTarget: number;
  modelRatePerTokenCny: number;
};

const SCALE = {
  short: { volumes: 1, chapters: 12, scenes: 24, baseTokens: 40_000 },
  medium: { volumes: 3, chapters: 36, scenes: 72, baseTokens: 100_000 },
  long: { volumes: 5, chapters: 60, scenes: 120, baseTokens: 180_000 },
  epic: { volumes: 8, chapters: 96, scenes: 192, baseTokens: 300_000 },
} as const;

export function estimateBlueprint(input: BlueprintEstimateInput) {
  const scale = SCALE[input.scaleTarget];
  const factor = Math.max(
    0.8,
    Math.min(1.5, 1 + (input.chapterLengthTarget - 3000) / 10_000),
  );
  const estimatedTokens = Math.round(scale.baseTokens * factor);
  const estimatedCostCny = roundMoney(estimatedTokens * input.modelRatePerTokenCny);
  return {
    ruleVersion: "blueprint-estimate-v1" as const,
    planned: {
      volumes: scale.volumes,
      chapters: scale.chapters,
      scenes: scale.scenes,
    },
    estimatedTokens,
    estimatedCostCny,
    defaultBudget: {
      maxTokens: Math.ceil((estimatedTokens * 1.2) / 1000) * 1000,
      maxCostCny: Math.max(0.2, Math.ceil(estimatedCostCny * 1.5 * 10) / 10),
    },
    assumptions: [
      `按${input.genre}题材和${input.scaleTarget}规模估算`,
      `章节字数目标 ${input.chapterLengthTarget}`,
    ],
  };
}

function roundMoney(value: number): number {
  return Number(value.toFixed(4));
}
```

Export it from `packages/core/src/index.ts`.

- [ ] **Step 4: Run the core test**

```powershell
pnpm vitest run packages/core/test/blueprint.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing contract state tests**

Create `packages/contracts/test/blueprint.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  blueprintConfirmRequestSchema,
  workBlueprintSchema,
} from "../src";

describe("blueprint contracts", () => {
  it("requires an explicit author confirmation flag", () => {
    expect(() =>
      blueprintConfirmRequestSchema.parse({
        expectedVersion: 3,
        draftHash: "a".repeat(64),
        acknowledgements: [],
      }),
    ).toThrow();
    expect(
      blueprintConfirmRequestSchema.parse({
        expectedVersion: 3,
        draftHash: "a".repeat(64),
        acknowledgements: [],
        confirmed: true,
      }).confirmed,
    ).toBe(true);
  });

  it("does not allow an implementation to bypass waiting_review", () => {
    const base = {
      id: "01900000-0000-7000-8000-000000000001",
      workId: "01900000-0000-7000-8000-000000000002",
      branchId: "01900000-0000-7000-8000-000000000003",
      version: 1,
      progress: 100,
      currentStep: "await_review",
      estimate: {},
      cost: {},
      storyBibleDraft: null,
      coreSettingsDraft: [],
      outlineDraft: null,
      missingFields: [],
      conflicts: [],
      acknowledgements: [],
      allowedActions: [],
      createdAt: "2026-11-27T00:00:00.000Z",
      updatedAt: "2026-11-27T00:00:00.000Z",
    };
    expect(
      workBlueprintSchema.safeParse({ ...base, status: "confirmed" }).success,
    ).toBe(false);
  });
});
```

Run:

```powershell
pnpm vitest run packages/contracts/test/blueprint.test.ts
```

Expected: FAIL because the schemas are missing.

- [ ] **Step 6: Add shared contracts**

In `packages/contracts/src/index.ts`, add:

```ts
export const BLUEPRINT_JOB_STEPS = [
  "prepare",
  "story_bible",
  "core_settings",
  "outline",
  "validate",
  "await_review",
] as const;

export const blueprintStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_model_config",
  "budget_paused",
  "waiting_review",
  "failed",
  "confirmed",
  "cancelled",
]);

export const blueprintBudgetSchema = z
  .object({
    maxTokens: z.number().int().min(20_000).max(600_000),
    maxCostCny: z.number().positive().max(10),
  })
  .strict();

export const blueprintConfirmRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    draftHash: z.string().regex(/^[0-9a-f]{64}$/u),
    acknowledgements: z.array(
      z.object({
        fieldKey: z.string().trim().min(1).max(200),
        decision: z.literal("not_applicable"),
        reason: z.string().trim().min(2).max(500),
      }),
    ),
    confirmed: z.literal(true),
  })
  .strict();
```

Define `generateBlueprintJobSchema` in the same worker-job union pattern as `generateChapterJobSchema`. Extend `workerJobSchema`.

- [ ] **Step 7: Add the database aggregate**

In `packages/db/src/schema.ts`, add `workBlueprints` with the fields from spec section 4.3, a unique index on `(workId, branchId)`, indexes on `(userId, workId, createdAt)` and `(jobId)`, a status check, and foreign keys to users, works, branches and jobs.

Extend:

- `jobs` type check with `generate_blueprint`;
- `jobs_required_scope_check` so `generate_blueprint` requires work/branch/model config and no chapter;
- `version_nodes` node type check with `blueprint_version`.

Run:

```powershell
pnpm --filter @novel-brain/db db:generate
pnpm --filter @novel-brain/db typecheck
pnpm vitest run packages/contracts/test/blueprint.test.ts packages/core/test/blueprint.test.ts
```

Expected: all PASS, and the migration only adds the planned table, indexes, constraints and node type.

- [ ] **Step 8: Commit**

```powershell
git add packages/core/src/blueprint.ts packages/core/src/index.ts packages/core/test/blueprint.test.ts packages/contracts/src/index.ts packages/contracts/test/blueprint.test.ts packages/db/src/schema.ts packages/db/migrations
git commit -m "feat(蓝图): 增加故事蓝图契约与持久状态"
```

### Task 2: Create and Queue the Blueprint from Idea Mode

**Files:**
- Create: `apps/api/src/blueprints/blueprint.module.ts`
- Create: `apps/api/src/blueprints/blueprint.controller.ts`
- Create: `apps/api/src/blueprints/blueprint.service.ts`
- Create: `apps/api/src/blueprints/blueprint.repository.ts`
- Create: `apps/api/src/blueprints/blueprint.queue.ts`
- Create: `apps/api/test/blueprint-creation.integration.test.ts`
- Modify: `apps/api/src/works/works.service.ts`
- Modify: `apps/api/src/works/works.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `estimateBlueprint` and blueprint contracts from Task 1.
- Produces: `BlueprintService.startForIdea(...)`
- Produces: `GET /api/v1/blueprint-estimates`
- Produces: automatic `generate_blueprint` job after idea-work creation.

- [ ] **Step 1: Write the failing creation integration test**

Create `apps/api/test/blueprint-creation.integration.test.ts` with three cases:

```ts
it("creates a blueprint job after an idea work", async () => {
  const owner = await registerUser();
  const response = await owner
    .post("/api/v1/works")
    .set("Idempotency-Key", "idea-blueprint")
    .send({
      mode: "idea",
      title: "忘川书",
      idea: "一个被宗门抛弃的杂役，意外得到一本会吞噬记忆的古书。",
      genre: "xianxia",
      scaleTarget: "long",
      chapterLengthTarget: 3000,
    })
    .expect(200);

  const overview = response.body.data;
  const blueprint = await owner
    .get(`/api/v1/works/${overview.id}/branches/${overview.mainBranch.id}/blueprint`)
    .expect(200);
  expect(blueprint.body.data.status).toBe("queued");
  expect(blueprint.body.data.estimate.defaultBudget.maxTokens).toBeGreaterThanOrEqual(180000);
});

it("does not create a blueprint for blank mode", async () => {
  // Create mode=blank, then GET blueprint and expect 404 BLUEPRINT_NOT_FOUND.
});

it("returns a deterministic estimate without exposing provider secrets", async () => {
  const response = await owner
    .get("/api/v1/blueprint-estimates")
    .query({ genre: "xianxia", scaleTarget: "short", chapterLengthTarget: 3000 })
    .expect(200);
  expect(response.body.data.ruleVersion).toBe("blueprint-estimate-v1");
  expect(JSON.stringify(response.body)).not.toContain("apiKey");
});
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
pnpm build:packages
pnpm --filter @novel-brain/api build
pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/blueprint-creation.integration.test.ts
```

Expected: FAIL with missing route/module.

- [ ] **Step 3: Implement repository creation**

`BlueprintRepository.createQueued` accepts:

```ts
type CreateQueuedBlueprint = {
  userId: string;
  workId: string;
  branchId: string;
  jobId: string;
  modelConfigId: string;
  estimate: BlueprintEstimate;
  budget: BlueprintBudget;
  inputHash: string;
  audit: WorksAuditContext;
};
```

Inside one tenant transaction:

1. insert `jobs` with `type = "generate_blueprint"`, `checkpoint = { step: "prepare", payload: {} }`, `cost` zero and `status = "queued"`;
2. insert `work_blueprints` with `status = "queued"`;
3. insert the enqueue/outbox row only if the repository already has an established outbox pattern; otherwise enqueue after commit and use job idempotency to repair a missed queue message.

- [ ] **Step 4: Wire idea creation**

In `WorksService.create`, after `repository.create`:

```ts
if (input.mode === "idea") {
  await this.blueprints.startForIdea({
    userId,
    workId: created.work.id,
    branchId: created.branch.id,
    title: created.work.title,
    idea: input.idea,
    genre: input.genre,
    scaleTarget: input.scaleTarget,
    chapterLengthTarget: input.chapterLengthTarget,
    budgetOverride: input.blueprintBudget,
    audit,
  });
}
```

Do not wrap the work creation and queue delivery in a fake transaction. If the queue enqueue fails after commit, the blueprint remains queued and a retry/recovery endpoint repairs it.

- [ ] **Step 5: Add estimate and blueprint GET routes**

Controller routes:

```text
GET /blueprint-estimates
GET /works/:workId/branches/:branchId/blueprint
```

Both use session auth. The estimate route uses `CsrfGuard` consistently with other authenticated API routes. Missing blueprint returns `404 BLUEPRINT_NOT_FOUND`.

- [ ] **Step 6: Run focused tests**

```powershell
pnpm build:packages
pnpm --filter @novel-brain/api build
pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/blueprint-creation.integration.test.ts
pnpm --filter @novel-brain/api typecheck
```

- [ ] **Step 7: Commit**

```powershell
git add apps/api/src apps/api/test/blueprint-creation.integration.test.ts
git commit -m "feat(蓝图): 从一句话想法创建蓝图任务"
```

### Task 3: Generate and Checkpoint the Three Blueprint Sections

**Files:**
- Create: `apps/worker/src/blueprints/blueprint.processor.ts`
- Create: `apps/worker/src/blueprints/blueprint.repository.ts`
- Create: `apps/worker/test/blueprint-processor.test.ts`
- Modify: `apps/worker/src/worker.module.ts`
- Modify: `apps/worker/src/worker.service.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `GenerateBlueprintJob`.
- Produces: persisted `story_bible`, `core_settings`, `outline`, `validate` and `await_review` checkpoints.
- Produces: notifications for ready, failed, waiting model config and budget pause.

- [ ] **Step 1: Write the failing Worker processor test**

Create `apps/worker/test/blueprint-processor.test.ts` using the existing fake provider pattern:

```ts
it("generates and checkpoints all three sections in order", async () => {
  const repository = createBlueprintRepositoryFake();
  const provider = createSequencedFakeProvider([
    storyBibleJson(),
    coreSettingsJson(),
    outlineJson(),
  ]);
  const processor = new BlueprintJobProcessor(repository, provider);

  await processor.process(generateBlueprintPayload());

  expect(repository.committedSteps()).toEqual([
    "prepare",
    "story_bible",
    "core_settings",
    "outline",
    "validate",
    "await_review",
  ]);
  expect(repository.blueprintStatus()).toBe("waiting_review");
  expect(repository.chapterVersionCount()).toBe(0);
});

it("pauses before the provider call that would exceed budget", async () => {
  const provider = createThrowingIfCalledProvider();
  const repository = createBlueprintRepositoryFake({
    usedCostCny: 0.49,
    maxCostCny: 0.5,
    projectedCostCny: 0.02,
  });
  const processor = new BlueprintJobProcessor(repository, provider);

  await processor.process(generateBlueprintPayload());

  expect(provider.calls()).toBe(0);
  expect(repository.blueprintStatus()).toBe("budget_paused");
  expect(repository.errorCode()).toBe("JOB_BUDGET_EXCEEDED");
});

it("resumes after the last committed step", async () => {
  const repository = createBlueprintRepositoryFake({
    checkpointStep: "core_settings",
  });
  const provider = createSequencedFakeProvider([outlineJson()]);
  await new BlueprintJobProcessor(repository, provider).process(generateBlueprintPayload());
  expect(repository.committedSteps()).toEqual(["outline", "validate", "await_review"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
pnpm vitest run apps/worker/test/blueprint-processor.test.ts
```

- [ ] **Step 3: Implement the processor step machine**

Use the existing `GenerationJobProcessor` recovery shape:

```ts
async process(payload: GenerateBlueprintJob): Promise<void> {
  await this.repository.withJobLock(payload.jobId, async () => {
    const loaded = await this.repository.load(payload);
    const resumeIndex = BLUEPRINT_JOB_STEPS.indexOf(
      blueprintCheckpointSchema.parse(loaded.job.checkpoint).step,
    );
    for (const step of BLUEPRINT_JOB_STEPS.slice(resumeIndex)) {
      await this.repository.startStep(payload, step);
      const result = await this.runStep(payload, loaded, step);
      await this.repository.completeStep(payload, step, result);
    }
    await this.repository.complete(payload);
  });
}
```

`story_bible`, `core_settings` and `outline` each call `BudgetedProviderCallExecutor` with a distinct `operation` and strict Zod output schema. `validate` and `await_review` do not call the provider.

- [ ] **Step 4: Add step routing and providers**

Modify `WorkerService`:

- constructor injects `BlueprintJobProcessor`;
- startup `jobTypes` includes `GENERATE_BLUEPRINT_JOB`;
- `processJob` routes `payload.jobType === GENERATE_BLUEPRINT_JOB` to the processor;
- `jobLogContext` includes job id and checkpoint step only.

Modify `WorkerModule` to provide the processor and repository.

- [ ] **Step 5: Persist staged output and notifications**

After each successful model step, write:

- the current `status = "running"`;
- `progress` step percentage;
- section-specific JSON into `work_blueprints`;
- checkpoint output refs and payload;
- actual token/cost into `jobs.cost` and `work_blueprints.cost`.

On `await_review`:

- set `status = "waiting_review"`;
- set job `status = "waiting_review"`;
- insert one `blueprint_ready` notification with a dedupe key of `(jobId, "ready", checkpointVersion)`.

- [ ] **Step 6: Run focused tests**

```powershell
pnpm build:packages
pnpm vitest run apps/worker/test/blueprint-processor.test.ts apps/worker/test/budgeted-provider-call.test.ts
pnpm --filter @novel-brain/worker typecheck
```

- [ ] **Step 7: Commit**

```powershell
git add apps/worker/src/blueprints apps/worker/src/worker.module.ts apps/worker/src/worker.service.ts apps/worker/test/blueprint-processor.test.ts packages/contracts/src/index.ts
git commit -m "feat(蓝图): 后台生成故事圣经设定与初始大纲"
```

### Task 4: Review, Validate, Budget Resume and Atomic Confirmation

**Files:**
- Create: `apps/api/src/blueprints/blueprint-validation.ts`
- Create: `apps/api/src/blueprints/blueprint-confirmation.repository.ts`
- Create: `apps/api/test/blueprint-confirmation.integration.test.ts`
- Modify: `apps/api/src/blueprints/blueprint.controller.ts`
- Modify: `apps/api/src/blueprints/blueprint.service.ts`
- Modify: `apps/api/src/blueprints/blueprint.repository.ts`
- Modify: `apps/api/src/blueprints/blueprint.queue.ts`

**Interfaces:**
- Produces: `PATCH .../blueprint/draft`
- Produces: `POST .../blueprint/retry`
- Produces: `POST .../blueprint/budget`
- Produces: `POST .../blueprint/confirm`
- Produces: atomic projection to story bible, settings, outline, planned chapters and scene cards.

- [ ] **Step 1: Write failing confirmation gate tests**

Create `apps/api/test/blueprint-confirmation.integration.test.ts`:

```ts
it("blocks confirmation with an unresolved P0 conflict", async () => {
  const { owner, blueprintPath, blueprint } = await createBlueprint("P0");
  const response = await owner
    .post(`${blueprintPath}/confirm`)
    .send({
      expectedVersion: blueprint.version,
      draftHash: blueprint.draftHash,
      acknowledgements: [],
      confirmed: true,
    })
    .expect(409);
  expect(response.body.error.code).toBe("BLUEPRINT_P0_CONFLICT");
});

it("requires a reason when a required field is not applicable", async () => {
  const { owner, blueprintPath, blueprint } = await createBlueprint("MISSING_REQUIRED");
  const missing = blueprint.missingFields.find((field) => field.required);
  await owner
    .post(`${blueprintPath}/confirm`)
    .send({
      expectedVersion: blueprint.version,
      draftHash: blueprint.draftHash,
      acknowledgements: [{ fieldKey: missing.key, decision: "not_applicable", reason: "" }],
      confirmed: true,
    })
    .expect(400);
});

it("confirms once and projects the complete blueprint", async () => {
  const { owner, blueprintPath, blueprint, overview } = await createReadyBlueprint();
  const body = {
    expectedVersion: blueprint.version,
    draftHash: blueprint.draftHash,
    acknowledgements: [],
    confirmed: true,
  };

  const first = await owner.post(`${blueprintPath}/confirm`).send(body).expect(200);
  const second = await owner.post(`${blueprintPath}/confirm`).send(body).expect(200);
  expect(second.body.data).toEqual(first.body.data);

  const bible = await owner.get(
    `/api/v1/works/${overview.id}/branches/${overview.mainBranch.id}/story-bible`,
  );
  expect(bible.body.data.status).toBe("locked");
  expect(bible.body.data.readiness.completed).toBe(9);

  const outline = await owner.get(
    `/api/v1/works/${overview.id}/branches/${overview.mainBranch.id}/outline`,
  );
  expect(outline.body.data.nodes.some((node) => node.level === "scene")).toBe(true);

  const chapters = await owner.get(
    `/api/v1/works/${overview.id}/branches/${overview.mainBranch.id}/chapters`,
  );
  expect(chapters.body.data.length).toBeGreaterThan(0);
  expect(chapters.body.data.every((chapter) => chapter.currentVersion === null)).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
pnpm build:packages
pnpm --filter @novel-brain/api build
pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/blueprint-confirmation.integration.test.ts
```

- [ ] **Step 3: Implement server-side validation**

Create `blueprint-validation.ts` with one exported function:

```ts
export function validateBlueprintForConfirmation(input: {
  draft: BlueprintDraft;
  genrePack: GenrePackDefinition;
  missingFields: BlueprintMissingField[];
  conflicts: BlueprintConflict[];
  acknowledgements: BlueprintAcknowledgement[];
}): BlueprintValidationResult {
  const p0 = input.conflicts.filter(
    (conflict) => conflict.severity === "P0" && conflict.status !== "resolved",
  );
  if (p0.length > 0) return { ok: false, code: "BLUEPRINT_P0_CONFLICT", details: { p0 } };

  const acknowledgementByKey = new Map(
    input.acknowledgements.map((item) => [item.fieldKey, item]),
  );
  const unresolvedRequired = input.missingFields.filter(
    (field) =>
      field.required &&
      field.severity === "P0" &&
      !acknowledgementByKey.get(field.key)?.reason.trim(),
  );
  if (unresolvedRequired.length > 0) {
    return {
      ok: false,
      code: "BLUEPRINT_REQUIRED_FIELD_MISSING",
      details: { fields: unresolvedRequired },
    };
  }
  return { ok: true };
}
```

Do not trust any `ready` or `canConfirm` value from the client.

- [ ] **Step 4: Implement draft patch and budget resume**

- `PATCH draft` uses `expectedVersion`, validates every operation against the relevant Zod schema, increments blueprint version, and recomputes `draftHash`.
- `POST retry` is allowed only from `failed`, `waiting_model_config`, `budget_paused` or `cancelled`; it resets job error fields and re-enqueues the same job id.
- `POST budget` updates the budget, increments version, writes an audit record and re-enqueues without resetting successful checkpoints.
- `POST cancel` changes status and job status without deleting candidates.

- [ ] **Step 5: Implement the confirmation transaction**

`BlueprintConfirmationRepository.confirm` acquires rows in this order:

```text
work_blueprints FOR UPDATE
work_branches FOR UPDATE
jobs FOR UPDATE
```

Then:

1. verify user/work/branch/status/version/hash;
2. call `validateBlueprintForConfirmation`;
3. create story bible and story bible version rows;
4. create locked entities, entity versions and world-rule projections;
5. create outline nodes, volume contracts, scenes and planned chapters;
6. create chain-linked version nodes;
7. set story bible and entities to `locked`;
8. set branch head to `blueprint_version`;
9. set blueprint confirmed fields;
10. insert notification, audit and idempotency records.

Use `uuidv7()` for every ID. If any row is missing or a unique constraint fails, throw and let the transaction roll back.

- [ ] **Step 6: Run focused tests**

```powershell
pnpm build:packages
pnpm --filter @novel-brain/api build
pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/blueprint-confirmation.integration.test.ts
pnpm --filter @novel-brain/api typecheck
```

- [ ] **Step 7: Commit**

```powershell
git add apps/api/src/blueprints apps/api/test/blueprint-confirmation.integration.test.ts
git commit -m "feat(蓝图): 增加审阅预算恢复与原子确认"
```

### Task 5: Prototype, Contract and Blueprint Review UI

**Files:**
- Modify: `prototype/index.html`
- Modify: `prototype/app.js`
- Modify: `prototype/styles.css`
- Modify: `prototype/tests/visual.spec.ts`
- Modify: `prototype/screens/v1-baseline/blueprint-{390,900,1180,1440}.png`
- Modify: `docs/ui/prototype-contract.md`
- Modify: `docs/ui/v1-prototype-signoff.md`
- Modify: `docs/ui/v1-ui-parity-matrix.md`
- Create: `apps/web/app/workspace/[workId]/blueprint/page.tsx`
- Create: `apps/web/components/blueprint-review.tsx`
- Create: `apps/web/e2e/parity/blueprint.spec.ts`

**Interfaces:**
- Consumes: blueprint GET/patch/budget/retry/confirm APIs.
- Produces: author-visible review and explicit confirmation at all four viewports.

- [ ] **Step 1: Update the prototype before production UI**

Add a `blueprint` screen that shows:

- status/progress and current stage;
- estimate, budget and actual cost;
- three review sections: story bible, core settings, initial outline;
- missing fields and P0/P1/P2 conflict groups;
- disabled confirm gate and reason;
- waiting model config, budget paused, failed, review and confirmed states.

Author signoff is a hard blocker. Do not change the matrix to `production-built` before the signoff record and screenshots exist.

- [ ] **Step 2: Write the failing Playwright owner spec**

Create `apps/web/e2e/parity/blueprint.spec.ts`:

```ts
test("creates an idea, reviews the generated blueprint and confirms it", async ({
  page,
  context,
}) => {
  await createIdeaWork(page, context, "忘川书");
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/blueprint$/u);
  await expect(page.getByRole("heading", { name: "故事蓝图" })).toBeVisible();
  await expect(page.getByText("故事圣经")).toBeVisible();
  await expect(page.getByText("核心设定")).toBeVisible();
  await expect(page.getByText("初始大纲")).toBeVisible();

  await page.getByRole("button", { name: "确认蓝图" }).click();
  await expect(page).toHaveURL(/\/overview$/u);
  await expect(page.getByText("蓝图已完成")).toBeVisible();
  await expect(page.getByRole("link", { name: "开始写第一章" })).toBeVisible();
});

test("blocks confirmation until P0 conflicts are resolved", async ({ page, context }) => {
  await openBlueprintFixture(page, context, "p0-conflict");
  await expect(page.getByRole("button", { name: "确认蓝图" })).toBeDisabled();
  await expect(page.getByText("仍有 1 条 P0 冲突需要处理")).toBeVisible();
});

test("keeps every blueprint state usable at four viewports", async ({ page, context }) => {
  for (const width of [1440, 1180, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "故事蓝图" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
```

- [ ] **Step 3: Run the test to verify it fails**

```powershell
pnpm build:packages
pnpm --filter @novel-brain/api build
pnpm --filter @novel-brain/worker build
pnpm exec playwright test apps/web/e2e/parity/blueprint.spec.ts
```

Expected: FAIL because the route and component do not exist.

- [ ] **Step 4: Implement the page and component**

Create `blueprint/page.tsx` as a server shell that reads `params.workId` and passes it to the client component. Create `blueprint-review.tsx` with:

- load and polling only while status is queued/running;
- no polling after waiting_review/confirmed/cancelled;
- patch forms that submit `expectedVersion`;
- budget form with current usage and absolute caps;
- conflict groups sorted P0 -> P1 -> P2;
- disabled confirm reason derived from server `allowedActions`;
- confirmed state as read-only.

Use lucide icons for actions. Do not add decorative cards inside cards, do not invent a new visual system, and keep author-facing copy free of internal terms.

- [ ] **Step 5: Add screenshots and author signoff evidence**

After prototype approval:

```powershell
pnpm exec playwright test apps/web/e2e/parity/blueprint.spec.ts --update-snapshots
```

Store Goldens at:

```text
artifacts/ui/golden/blueprint/blueprint-{390,900,1180,1440}.png
```

Add the matrix row, prototype contract row and signoff record only after the author explicitly approves the four viewports.

- [ ] **Step 6: Run focused tests**

```powershell
pnpm exec playwright test apps/web/e2e/parity/blueprint.spec.ts
pnpm --filter @novel-brain/web typecheck
```

- [ ] **Step 7: Commit**

```powershell
git add prototype docs/ui apps/web/app/workspace/[workId]/blueprint apps/web/components/blueprint-review.tsx apps/web/e2e/parity/blueprint.spec.ts artifacts/ui/golden/blueprint
git commit -m "feat(蓝图): 增加故事蓝图审阅与确认页面"
```

### Task 6: Creation Entry, Overview Completion State and Notifications

**Files:**
- Modify: `apps/web/components/new-project-wizard.tsx`
- Modify: `apps/web/components/work-overview.tsx`
- Modify: `apps/web/e2e/parity/new-project.spec.ts`
- Modify: `apps/web/e2e/parity/work-overview.spec.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/notifications/notification.repository.ts`
- Modify: `apps/api/test/notifications.integration.test.ts`

**Interfaces:**
- Consumes: `GET /blueprint-estimates`, `GET .../blueprint`.
- Produces: visible estimate in the creation form.
- Produces: `idea` redirect to blueprint review.
- Produces: overview "蓝图已完成" and "开始写第一章".

- [ ] **Step 1: Extend Playwright tests first**

Add to `new-project.spec.ts`:

```ts
test("shows blueprint cost estimate and routes an idea into review", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  await page.getByLabel("故事灵感").fill("一个被宗门抛弃的杂役，意外得到一本会吞噬记忆的古书。");
  await page.getByLabel("故事规模").selectOption("short");
  await expect(page.getByText(/预计使用.*token/u)).toBeVisible();
  await expect(page.getByText(/预算上限/u)).toBeVisible();
  await page.getByRole("button", { name: "创建作品并生成蓝图" }).click();
  await expect(page).toHaveURL(/\/blueprint$/u);
});
```

Add to `work-overview.spec.ts`:

```ts
test("shows blueprint completion without generating chapter prose", async ({ page, context }) => {
  const work = await createConfirmedBlueprintWork(page, context);
  await page.goto(`/workspace/${work.id}/overview`);
  await expect(page.getByText("蓝图已完成")).toBeVisible();
  await expect(page.getByRole("link", { name: "开始写第一章" })).toBeVisible();
  const chapters = await getPersistedChapters(page, work);
  expect(chapters[0]?.currentVersion).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
pnpm exec playwright test apps/web/e2e/parity/new-project.spec.ts apps/web/e2e/parity/work-overview.spec.ts
```

- [ ] **Step 3: Implement creation estimate and redirect**

- Fetch `/api/v1/blueprint-estimates` after genre/scale/chapter length changes for idea mode only.
- Show token/cost/default cap and assumptions.
- Allow budget override with server bounds.
- Change the idea submit label to `创建作品并生成蓝图`.
- Send `blueprintBudget` only when the author changes defaults.
- Redirect idea mode to `/workspace/{workId}/blueprint`.

- [ ] **Step 4: Implement overview completion and notification copy**

- Fetch blueprint state with the overview data.
- When confirmed, show `蓝图已完成`.
- Primary action links to `/workspace/{workId}/write?chapterId=<first planned chapter>`.
- When unconfirmed, link to `/workspace/{workId}/blueprint`.
- Add notification types and author-facing titles for ready/failed/model-config/budget states.
- Never include candidate Prompt or full private context in notification payload.

- [ ] **Step 5: Run focused tests**

```powershell
pnpm exec playwright test apps/web/e2e/parity/new-project.spec.ts apps/web/e2e/parity/work-overview.spec.ts apps/web/e2e/parity/blueprint.spec.ts
pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/notifications.integration.test.ts
```

- [ ] **Step 6: Commit**

```powershell
git add apps/web/components/new-project-wizard.tsx apps/web/components/work-overview.tsx apps/web/e2e/parity/new-project.spec.ts apps/web/e2e/parity/work-overview.spec.ts packages/contracts/src/index.ts apps/api/src/notifications apps/api/test/notifications.integration.test.ts
git commit -m "feat(蓝图): 展示预算估算与开书完成状态"
```

### Task 7: Recovery, Security, Evidence and Full Verification

**Files:**
- Create: `docs/implementation/blueprint-bootstrap.md`
- Create: `docs/implementation/m4-blueprint-evidence.json`
- Modify: `docs/planning/implementation-frontier.md`
- Modify: `docs/planning/v1-capability-traceability.md`
- Modify: `.github/workflows/ci.yml` only if Worker recovery smoke must be added to an existing required job

**Interfaces:**
- Produces: implementation evidence, machine-readable acceptance record and explicit human signoff status.

- [ ] **Step 1: Add recovery and tenant tests**

Integration tests must cover:

```ts
it.each([
  "queue-message-missing",
  "worker-crash-after-story-bible",
  "worker-crash-after-core-settings",
  "budget-paused-then-resumed",
])("recovers blueprint job from %s", async (scenario) => {
  const result = await runBlueprintRecoveryScenario(scenario);
  expect(result.duplicateProviderCalls).toBe(0);
  expect(result.finalStatus).toBe("waiting_review");
});

it("rejects cross-tenant blueprint access", async () => {
  const { owner, outsider, blueprintPath } = await createBlueprintFixture();
  await outsider.get(blueprintPath).expect(403);
  await outsider.post(`${blueprintPath}/confirm`).send(validConfirm(owner)).expect(403);
});
```

- [ ] **Step 2: Run focused recovery, notification and security tests**

```powershell
pnpm build:packages
pnpm --filter @novel-brain/api build
pnpm --filter @novel-brain/worker build
pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/blueprint-creation.integration.test.ts apps/api/test/blueprint-confirmation.integration.test.ts apps/api/test/notifications.integration.test.ts
pnpm vitest run apps/worker/test/blueprint-processor.test.ts
```

- [ ] **Step 3: Run the required repository checks**

```powershell
pnpm typecheck
pnpm test
pnpm test:guardrails
pnpm check:pr
pnpm check:migrations
```

- [ ] **Step 4: Run the focused E2E suite**

```powershell
pnpm test:e2e -- apps/web/e2e/parity/new-project.spec.ts apps/web/e2e/parity/blueprint.spec.ts apps/web/e2e/parity/work-overview.spec.ts
```

- [ ] **Step 5: Record evidence**

`docs/implementation/blueprint-bootstrap.md` must record:

- base and head SHAs;
- ADR/spec/ticket links;
- migration name;
- fake-provider deterministic evidence;
- budget pause/resume evidence;
- confirmation transaction evidence;
- cross-tenant evidence;
- 1440/1180/900/390 screenshots and author signoff;
- test commands and exact results;
- any deferred scope.

`m4-blueprint-evidence.json` contains booleans only for checks that actually passed. No field may be set to `true` from a plan or unrun command.

- [ ] **Step 6: Code review**

Use the `code-review` skill against the recorded base/head. Resolve all high-severity findings, rerun the affected tests, and restart the review if either ref moves.

- [ ] **Step 7: Commit**

```powershell
git add docs/implementation docs/planning/implementation-frontier.md docs/planning/v1-capability-traceability.md
git commit -m "docs(蓝图): 记录自动开书实现与验收证据"
```
