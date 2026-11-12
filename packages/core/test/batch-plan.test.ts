import {
  BATCH_SCHEDULING_CAPS,
  buildBatchPlan,
  deterministicUuidV7,
  selectDispatchableBatchItems,
  validateBatchWorkItemGraph,
  type BatchPlanChapterInput,
  type BatchPlanVolumeInput,
} from "../src";
import { uuidV7Schema, WORKER_JOB_STEPS } from "@novel-brain/contracts";
import { describe, expect, it } from "vitest";

const WORK_ID = deterministicUuidV7("work:max");
const BRANCH_ID = deterministicUuidV7("branch:max");
const USER_ID = deterministicUuidV7("user:max");
const PLAN_ID = deterministicUuidV7("plan:max");

describe("batch plan", () => {
  it("builds a bounded deterministic four-level plan for 4,000 chapters", () => {
    const fixture = maximumFixture(40, 100);
    const plan = buildBatchPlan({
      planId: PLAN_ID,
      workId: WORK_ID,
      branchId: BRANCH_ID,
      userId: USER_ID,
      scope: { type: "book" },
      approvalMode: "per_volume",
      priorityClass: "batch",
      maxConcurrency: 2,
      stepKeys: WORKER_JOB_STEPS,
      volumes: fixture.volumes,
      chapters: fixture.chapters,
    });

    expect(plan.counts).toMatchObject({
      total: 1 + 40 + 4_000 + 4_000 * WORKER_JOB_STEPS.length,
      book: 1,
      volume: 40,
      chapter: 4_000,
      step: 4_000 * WORKER_JOB_STEPS.length,
      ready: 100,
      pending: 1 + 40 + 4_000 + 4_000 * WORKER_JOB_STEPS.length - 100,
    });
    expect(new Set(plan.items.map((item) => item.key)).size).toBe(plan.counts.total);
    expect(new Set(plan.items.map((item) => item.id)).size).toBe(plan.counts.total);
    for (const item of plan.items) {
      expect(uuidV7Schema.safeParse(item.id).success).toBe(true);
    }

    expect(plan.scheduling.initialRunnableKeys).toHaveLength(2);
    expect(plan.scheduling.initialRunnableKeys.every((key) => key.startsWith("step:"))).toBe(true);

    const book = only(plan.items, (item) => item.type === "book");
    const firstVolume = only(
      plan.items,
      (item) => item.key === "volume:" + fixture.volumes[0]?.nodeId,
    );
    const firstChapter = only(
      plan.items,
      (item) => item.key === "chapter:" + fixture.chapters[0]?.chapterId,
    );
    const firstStep = only(
      plan.items,
      (item) => item.key === "step:" + fixture.chapters[0]?.chapterId + ":prepare",
    );
    const lastStep = only(
      plan.items,
      (item) =>
        item.key ===
        "step:" +
          fixture.chapters[0]?.chapterId +
          ":" +
          WORKER_JOB_STEPS[WORKER_JOB_STEPS.length - 1],
    );

    expect(book.parentKey).toBeNull();
    expect(book.dependsOn).toEqual(fixture.volumes.map((volume) => "volume:" + volume.nodeId));
    expect(firstVolume.parentKey).toBe("book");
    expect(firstVolume.dependsOn).toHaveLength(100);
    expect(firstVolume.dependsOn.every((key) => key.startsWith("chapter:"))).toBe(true);
    expect(firstChapter.parentKey).toBe("volume:" + fixture.volumes[0]?.nodeId);
    expect(firstStep.parentKey).toBe("chapter:" + fixture.chapters[0]?.chapterId);
    expect(firstStep.dependsOn).toEqual([]);
    expect(lastStep.dependsOn).toEqual([
      "step:" +
        fixture.chapters[0]?.chapterId +
        ":" +
        WORKER_JOB_STEPS[WORKER_JOB_STEPS.length - 2],
    ]);
    expect(firstChapter.dependsOn).toEqual([lastStep.key]);

    const secondChapterId = fixture.chapters[1]?.chapterId;
    const secondChapterFirstStep = only(
      plan.items,
      (item) => item.key === `step:${secondChapterId}:prepare`,
    );
    expect(secondChapterFirstStep.dependsOn).toEqual([]);

    const replay = buildBatchPlan({
      planId: PLAN_ID,
      workId: WORK_ID,
      branchId: BRANCH_ID,
      userId: USER_ID,
      scope: { type: "book" },
      approvalMode: "per_volume",
      priorityClass: "batch",
      maxConcurrency: 2,
      stepKeys: WORKER_JOB_STEPS,
      volumes: fixture.volumes,
      chapters: fixture.chapters,
    });
    expect(replay).toEqual(plan);

    const shuffled = buildBatchPlan({
      planId: PLAN_ID,
      workId: WORK_ID,
      branchId: BRANCH_ID,
      userId: USER_ID,
      scope: { type: "book" },
      approvalMode: "per_volume",
      priorityClass: "batch",
      maxConcurrency: 2,
      stepKeys: WORKER_JOB_STEPS,
      volumes: [...fixture.volumes].reverse(),
      chapters: [...fixture.chapters].reverse(),
    });
    expect(shuffled.items.map((item) => item.key)).toEqual(plan.items.map((item) => item.key));
  });

  it("rejects duplicate keys, missing dependencies, cycles, cross-work references and invalid parents", () => {
    const fixture = maximumFixture(2, 2);
    const plan = buildBatchPlan({
      planId: PLAN_ID,
      workId: WORK_ID,
      branchId: BRANCH_ID,
      userId: USER_ID,
      scope: { type: "book" },
      approvalMode: "per_volume",
      priorityClass: "batch",
      maxConcurrency: 2,
      stepKeys: WORKER_JOB_STEPS,
      volumes: fixture.volumes,
      chapters: fixture.chapters,
    });
    expect(validateBatchWorkItemGraph(plan.items, { workId: WORK_ID })).toEqual([]);

    expect(
      validateBatchWorkItemGraph([...plan.items, plan.items[1]!], { workId: WORK_ID }),
    ).toContainEqual(expect.objectContaining({ code: "duplicate_key" }));

    const missing = cloneItems(plan.items);
    missing[1]!.dependsOn = ["missing:key"];
    expect(validateBatchWorkItemGraph(missing, { workId: WORK_ID })).toContainEqual(
      expect.objectContaining({ code: "unknown_dependency" }),
    );

    const cyclic = cloneItems(plan.items);
    const firstStep = cyclic.find(
      (item) => item.key === "step:" + fixture.chapters[0]?.chapterId + ":prepare",
    )!;
    const lastStep = cyclic.find(
      (item) =>
        item.key ===
        "step:" +
          fixture.chapters[0]?.chapterId +
          ":" +
          WORKER_JOB_STEPS[WORKER_JOB_STEPS.length - 1],
    )!;
    firstStep.dependsOn = [lastStep.key];
    expect(validateBatchWorkItemGraph(cyclic, { workId: WORK_ID })).toContainEqual(
      expect.objectContaining({ code: "cycle" }),
    );

    const crossWork = cloneItems(plan.items);
    crossWork[1]!.workId = deterministicUuidV7("other-work");
    expect(validateBatchWorkItemGraph(crossWork, { workId: WORK_ID })).toContainEqual(
      expect.objectContaining({ code: "cross_work_reference" }),
    );

    const invalidParent = cloneItems(plan.items);
    const chapterItem = invalidParent.find(
      (item) => item.key === "chapter:" + fixture.chapters[0]?.chapterId,
    )!;
    chapterItem.parentKey = "chapter:" + fixture.chapters[1]?.chapterId;
    expect(validateBatchWorkItemGraph(invalidParent, { workId: WORK_ID })).toContainEqual(
      expect.objectContaining({ code: "invalid_parent_type" }),
    );
  });

  it("property: shuffled sizes and inputs always produce the same valid deterministic DAG", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const random = seededRandom(seed);
      const volumeCount = 1 + Math.floor(random() * 6);
      const chaptersPerVolume = 1 + Math.floor(random() * 10);
      const fixture = maximumFixture(volumeCount, chaptersPerVolume);
      const input = {
        planId: deterministicUuidV7(`plan:property:${seed}`),
        workId: WORK_ID,
        branchId: BRANCH_ID,
        userId: USER_ID,
        scope: { type: "book" as const },
        approvalMode: "per_volume" as const,
        priorityClass: "batch" as const,
        maxConcurrency: 2,
        stepKeys: WORKER_JOB_STEPS,
        volumes: fixture.volumes,
        chapters: fixture.chapters,
      };
      const plan = buildBatchPlan(input);
      const replay = buildBatchPlan({
        ...input,
        volumes: shuffled(input.volumes, random),
        chapters: shuffled(input.chapters, random),
      });
      expect(replay).toEqual(plan);
      expect(validateBatchWorkItemGraph(plan.items, { workId: WORK_ID })).toEqual([]);
      expect(new Set(plan.items.map((item) => item.key)).size).toBe(plan.counts.total);
      expect(plan.counts.ready).toBe(chaptersPerVolume);
      expect(plan.scheduling.initialRunnableKeys).toHaveLength(Math.min(2, chaptersPerVolume));
    }
  });

  it("schedules ready work within global, per-work and per-user caps and prefers interactive work", () => {
    const candidates = [
      candidate(
        "batch-a",
        deterministicUuidV7("work:a"),
        deterministicUuidV7("user:a"),
        "batch",
        100,
      ),
      candidate(
        "batch-b",
        deterministicUuidV7("work:a"),
        deterministicUuidV7("user:a"),
        "batch",
        100,
      ),
      candidate(
        "batch-c",
        deterministicUuidV7("work:b"),
        deterministicUuidV7("user:a"),
        "batch",
        100,
      ),
      candidate(
        "batch-d",
        deterministicUuidV7("work:b"),
        deterministicUuidV7("user:b"),
        "batch",
        100,
      ),
      candidate(
        "batch-e",
        deterministicUuidV7("work:c"),
        deterministicUuidV7("user:b"),
        "batch",
        100,
      ),
      candidate(
        "batch-f",
        deterministicUuidV7("work:c"),
        deterministicUuidV7("user:b"),
        "batch",
        100,
      ),
    ];
    const selected = selectDispatchableBatchItems(
      candidates,
      { runningGlobal: 0, runningByWork: {}, runningByUser: {} },
      BATCH_SCHEDULING_CAPS,
    );
    expect(selected).toHaveLength(4);
    expect(countBy(candidates, selected, (item) => item.workId)).toEqual(
      new Map([
        [candidates[0]!.workId, 2],
        [candidates[3]!.workId, 1],
        [candidates[4]!.workId, 1],
      ]),
    );
    expect(countBy(candidates, selected, (item) => item.userId)).toEqual(
      new Map([
        [candidates[0]!.userId, 2],
        [candidates[3]!.userId, 2],
      ]),
    );

    expect(
      selectDispatchableBatchItems(
        [
          candidates[0]!,
          candidate(
            "interactive",
            deterministicUuidV7("work:i"),
            deterministicUuidV7("user:i"),
            "interactive",
            1_000,
          ),
        ],
        { runningGlobal: 0, runningByWork: {}, runningByUser: {} },
        { global: 1, perWork: 1, perUser: 1 },
      ),
    ).toEqual(["interactive"]);

    expect(
      selectDispatchableBatchItems(
        [...candidates].reverse(),
        { runningGlobal: 0, runningByWork: {}, runningByUser: {} },
        BATCH_SCHEDULING_CAPS,
      ),
    ).toEqual(selected);

    expect(
      selectDispatchableBatchItems(
        candidates,
        {
          runningGlobal: 3,
          runningByWork: { [candidates[0]!.workId]: 1 },
          runningByUser: { [candidates[0]!.userId]: 1 },
        },
        BATCH_SCHEDULING_CAPS,
      ),
    ).toHaveLength(1);

    const blocked = candidate(
      "blocked",
      deterministicUuidV7("work:blocked"),
      deterministicUuidV7("user:blocked"),
      "batch",
      100,
      ["batch-a"],
    );
    expect(
      selectDispatchableBatchItems(
        [blocked],
        { runningGlobal: 0, runningByWork: {}, runningByUser: {} },
        BATCH_SCHEDULING_CAPS,
      ),
    ).toEqual([]);
    expect(
      selectDispatchableBatchItems(
        [blocked],
        { runningGlobal: 0, runningByWork: {}, runningByUser: {} },
        BATCH_SCHEDULING_CAPS,
        new Set(["batch-a"]),
      ),
    ).toEqual(["blocked"]);
  });
});

function candidate(
  key: string,
  workId: string,
  userId: string,
  priorityClass: "interactive" | "batch",
  priority: number,
  dependsOn: string[] = [],
) {
  return {
    key,
    workId,
    userId,
    priorityClass,
    priority,
    dependsOn,
    status: "ready" as const,
  };
}

function countBy<T>(
  items: readonly T[],
  selectedKeys: readonly string[],
  keyOf: (item: T) => string,
): Map<string, number> {
  const selected = new Set(selectedKeys);
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!selected.has((item as unknown as { key: string }).key)) {
      continue;
    }
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function only<T>(items: readonly T[], predicate: (item: T) => boolean): T {
  const matches = items.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one match, received ${matches.length}`);
  }
  return matches[0]!;
}

function cloneItems<T>(items: readonly T[]): T[] {
  return items.map((item) => structuredClone(item));
}

function maximumFixture(volumeCount: number, chaptersPerVolume: number) {
  const volumes: BatchPlanVolumeInput[] = Array.from({ length: volumeCount }, (_, index) => ({
    nodeId: deterministicUuidV7(`volume:${index + 1}`),
    version: 1,
    sortOrder: index + 1,
  }));
  const chapters: BatchPlanChapterInput[] = Array.from(
    { length: volumeCount * chaptersPerVolume },
    (_, index) => {
      const volumeIndex = Math.floor(index / chaptersPerVolume);
      const volume = volumes[volumeIndex]!;
      const chapterNumber = index + 1;
      return {
        chapterId: deterministicUuidV7(`chapter:${chapterNumber}`),
        chapterNodeId: deterministicUuidV7(`chapter-node:${chapterNumber}`),
        chapterNumber,
        chapterOutlineVersion: 1,
        chapterVersion: 1,
        chapterSortOrder: (index % chaptersPerVolume) + 1,
        volumeNodeId: volume.nodeId,
        volumeVersion: volume.version,
      };
    },
  );
  return { volumes, chapters };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex]!, copy[index]!];
  }
  return copy;
}
