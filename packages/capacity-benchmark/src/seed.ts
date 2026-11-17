import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { encryptApiKey } from "@novel-brain/ai";
import { createObjectStorageFromEnvironment } from "@novel-brain/storage";
import {
  agentRuns,
  auditLogs,
  canonCommits,
  changeImpacts,
  changeRequests,
  chapterVersions,
  chapters,
  characterKnowledgeStates,
  characterProfiles,
  characterRelationships,
  characterStateTransitions,
  contextPackVersions,
  costReservations,
  createDatabaseClient,
  createDatabasePool,
  entities,
  entityVersions,
  factDecisions,
  factProposals,
  facts,
  factionProfiles,
  factionRelationships,
  genrePacks,
  importChunks,
  importJobs,
  importReports,
  jobCheckpoints,
  jobEvents,
  jobStepAttempts,
  jobSteps,
  jobWorkItems,
  jobs,
  mapEdges,
  mapLayers,
  mapMarkers,
  mapNodes,
  mergeDecisions,
  mergeItems,
  modelCalls,
  modelConfigs,
  outlineNodes,
  penNames,
  powerPaths,
  powerRealms,
  powerSystems,
  promptVersions,
  qualityReports,
  reviewDecisions,
  runMigrations,
  searchDocuments,
  searchRebuildRuns,
  sessions,
  storyBibleVersions,
  storyBibles,
  summaryRebuildRuns,
  summaryRecords,
  specialMechanisms,
  itemTechniques,
  systemMetadata,
  timelineEras,
  timelineEvents,
  usageRecords,
  users,
  versionNodes,
  volumeContracts,
  workBranches,
  workExportReceipts,
  works,
  type DatabaseTransaction,
} from "@novel-brain/db";
import { eq, sql } from "drizzle-orm";

import { assertBenchmarkDatabaseTarget, benchmarkDatabaseName } from "./database-safety";
import { benchmarkChapterContent, digestBenchmarkManuscript, type BenchmarkPlan } from "./dataset";
import { benchmarkSessionToken, createBenchmarkFixtureIds, deterministicUuid } from "./fixture-ids";

export interface SeedBenchmarkFixtureInput {
  databaseUrl: string;
  confirmedDatabaseName: string;
  plan: BenchmarkPlan;
  sourceCommit?: string;
  replaceExisting?: boolean;
}

export interface FixtureManifest {
  formatVersion: 1;
  generatorVersion: string;
  seed: number;
  tier: BenchmarkPlan["tier"];
  topology: BenchmarkPlan["topology"];
  branchCount: number;
  branchTopology: {
    mainBranchName: "main";
    parallelBranchCount: number;
    divergenceDepth: number;
    branches: Array<{
      name: string;
      divergenceChapter: number;
      branchChapterCount: number;
    }>;
  };
  sourceCommit: string;
  schemaMigrationVersion: string;
  logicalCharacters: number;
  utf8ManuscriptBytes: number;
  manuscriptSha256: string;
  chapterCount: number;
  volumeCount: number;
  entityCounts: {
    versionNodes: number;
    chapters: number;
    chapterVersions: number;
    entities: number;
    facts: number;
    summaries: number;
    searchDocuments: number;
    jobs: number;
    jobWorkItems: number;
    importChunks: number;
    exportReceipts: number;
  };
  objectCount: number;
  objectBytes: number;
  objectChecksums: string[];
  versionNodeTypes: Record<string, number>;
  rowCounts: Record<string, number>;
  ids: {
    userId: string;
    workId: string;
    mainBranchId: string;
    branchIds: string[];
  };
}

const CHAPTER_BATCH_SIZE = 200;
const ENTITY_COUNT = 100;

export async function seedBenchmarkFixture(
  input: SeedBenchmarkFixtureInput,
): Promise<FixtureManifest> {
  assertBenchmarkDatabaseTarget(input.databaseUrl, input.confirmedDatabaseName);
  if (input.plan.branchCount === null) {
    throw new Error("BRANCH_COUNT_DECISION_REQUIRED");
  }
  const expected = digestBenchmarkManuscript(input.plan);
  await runMigrations(input.databaseUrl);
  const objectFixture = await seedCapacityObjects(input.plan);

  const pool = createDatabasePool(input.databaseUrl, {
    max: 4,
    statement_timeout: 300_000,
    query_timeout: 300_000,
  });
  const db = createDatabaseClient(pool);
  const ids = createBenchmarkFixtureIds(input.plan.seed, input.plan.branchCount);
  const now = new Date("2026-11-17T00:00:00.000Z");
  const sourceCommit = input.sourceCommit ?? resolveSourceCommit();
  const sessionToken = benchmarkSessionToken(input.plan.seed);
  const sessionTokenHash = sha256(sessionToken);
  const encryptedProviderKey = syntheticProviderKey();
  const branchIds = [ids.mainBranchId];

  try {
    const [genrePack] = await db
      .select()
      .from(genrePacks)
      .where(eq(genrePacks.key, "xianxia"))
      .orderBy(sql`${genrePacks.version} desc`)
      .limit(1);
    if (!genrePack) {
      throw new Error("XIANXIA_GENRE_PACK_MISSING");
    }

    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${ids.userId}, true)`);
      await tx.execute(sql`set local statement_timeout = 0`);
      if (input.replaceExisting !== false) {
        await tx.delete(users).where(eq(users.id, ids.userId));
      }

      await tx.insert(users).values({
        id: ids.userId,
        email: `capacity-${input.plan.seed}@benchmark.invalid`,
        passwordHash: "synthetic-benchmark-password-not-used",
        displayName: "容量基准作者",
        bio: "",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(penNames).values({
        id: ids.penNameId,
        userId: ids.userId,
        name: "容量基准笔名",
        bio: "",
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(sessions).values({
        id: ids.sessionId,
        userId: ids.userId,
        tokenHash: sessionTokenHash,
        userAgent: "capacity-benchmark-harness",
        ip: "127.0.0.1",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        lastSeenAt: now,
        createdAt: now,
      });
      await tx.insert(modelConfigs).values({
        id: ids.modelConfigId,
        userId: ids.userId,
        provider: "deepseek",
        label: "Benchmark Deterministic Fake",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        purposes: ["planning", "writing", "review"],
        encryptedKey: encryptedProviderKey,
        keyMasked: "sk-****-fake",
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(works).values({
        id: ids.workId,
        userId: ids.userId,
        title: "十兆字容量基准",
        penName: "容量基准笔名",
        genre: "xianxia",
        status: "serializing",
        scaleTarget: "epic",
        chapterLengthTarget: 3_000,
        sourceMode: "manuscript_import",
        idea: null,
        templatePackId: genrePack.id,
        settings: {
          benchmark: true,
          benchmarkSeed: input.plan.seed,
          benchmarkTier: input.plan.tier,
        },
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(workBranches).values({
        id: ids.mainBranchId,
        workId: ids.workId,
        userId: ids.userId,
        name: "main",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });

      const rootNodeId = deterministicUuid(input.plan.seed, "version:root");
      await tx.insert(versionNodes).values({
        id: rootNodeId,
        workId: ids.workId,
        branchId: ids.mainBranchId,
        userId: ids.userId,
        nodeType: "snapshot",
        objectType: "work",
        objectId: ids.workId,
        objectVersion: 1,
        snapshotId: rootNodeId,
        payload: { benchmarkSeed: input.plan.seed },
        actorId: ids.userId,
        message: "容量基准初始快照",
        createdAt: now,
      });

      const storyBibleId = deterministicUuid(input.plan.seed, "story-bible");
      const storyBibleNodeId = deterministicUuid(input.plan.seed, "version:story-bible");
      const cards = storyBibleCards(input.plan.seed);
      await tx.insert(storyBibles).values({
        id: storyBibleId,
        workId: ids.workId,
        branchId: ids.mainBranchId,
        userId: ids.userId,
        version: 1,
        status: "locked",
        cards,
        lockedAt: now,
        lockedBy: ids.userId,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(versionNodes).values({
        id: storyBibleNodeId,
        workId: ids.workId,
        branchId: ids.mainBranchId,
        userId: ids.userId,
        parentNodeId: rootNodeId,
        nodeType: "story_bible_version",
        objectType: "story_bible",
        objectId: storyBibleId,
        objectVersion: 1,
        payload: { status: "locked" },
        actorId: ids.userId,
        message: "锁定容量基准故事圣经",
        createdAt: now,
      });
      await tx.insert(storyBibleVersions).values({
        id: deterministicUuid(input.plan.seed, "story-bible-version"),
        storyBibleId,
        workId: ids.workId,
        branchId: ids.mainBranchId,
        userId: ids.userId,
        version: 1,
        cards,
        readiness: { status: "ready", benchmarkSynthetic: true },
        action: "locked",
        reason: "容量基准夹具",
        versionNodeId: storyBibleNodeId,
        createdBy: ids.userId,
        createdAt: now,
      });

      let parentNodeId = storyBibleNodeId;
      const entityIds: string[] = [];
      const entityNodeIds: string[] = [];
      for (let index = 1; index <= ENTITY_COUNT; index += 1) {
        const entityId = deterministicUuid(input.plan.seed, `entity:${index}`);
        const entityNodeId = deterministicUuid(input.plan.seed, `version:entity:${index}`);
        const entityVersionId = deterministicUuid(input.plan.seed, `entity-version:${index}`);
        const type = entityType(index);
        const name = entityName(type, index);
        await tx.insert(entities).values({
          id: entityId,
          workId: ids.workId,
          branchId: ids.mainBranchId,
          userId: ids.userId,
          type,
          name,
          aliases: [`${name}别名`, `锚点${index}`],
          summary: `${name}用于容量基准的确定性设置数据。`,
          description: `${name}的描述包含可检索锚点${index}，不代表真实产品内容。`,
          attributes: entityAttributes(type, index),
          tags: ["benchmark", type],
          status: index <= 8 ? ("draft" as const) : ("locked" as const),
          source: index <= 8 ? ("author" as const) : ("canon" as const),
          version: 1,
          lockedAt: index <= 8 ? null : now,
          lockedBy: index <= 8 ? null : ids.userId,
          createdAt: now,
          updatedAt: now,
        });
        await tx.insert(versionNodes).values({
          id: entityNodeId,
          workId: ids.workId,
          branchId: ids.mainBranchId,
          userId: ids.userId,
          parentNodeId,
          nodeType: "entity_version",
          objectType: "entity",
          objectId: entityId,
          objectVersion: 1,
          payload: { benchmarkIndex: index, type },
          actorId: ids.userId,
          message: `基准设置 ${index}`,
          createdAt: now,
        });
        await tx.insert(entityVersions).values({
          id: entityVersionId,
          entityId,
          workId: ids.workId,
          branchId: ids.mainBranchId,
          userId: ids.userId,
          version: 1,
          snapshot: {
            id: entityId,
            type,
            name,
            status: index <= 8 ? "draft" : "locked",
          },
          versionNodeId: entityNodeId,
          createdBy: ids.userId,
          createdAt: now,
        });
        entityIds.push(entityId);
        entityNodeIds.push(entityNodeId);
        parentNodeId = entityNodeId;
      }

      await insertDomainRecords(tx, {
        plan: input.plan,
        ids,
        rootNodeId,
        now,
      });

      const mainChapterIds = chapterIds(input.plan);
      const mainChapterVersionIds = chapterVersionIds(input.plan);
      const mainChapterNodeIds = chapterNodeIds(input.plan);
      for (let offset = 0; offset < mainChapterIds.length; offset += CHAPTER_BATCH_SIZE) {
        const end = Math.min(mainChapterIds.length, offset + CHAPTER_BATCH_SIZE);
        const chapterRows = [];
        const nodeRows = [];
        const versionRows = [];
        for (let index = offset; index < end; index += 1) {
          const chapterNumber = index + 1;
          const content = benchmarkChapterContent(input.plan, chapterNumber);
          const chapterId = mainChapterIds[index]!;
          const versionId = mainChapterVersionIds[index]!;
          const nodeId = mainChapterNodeIds[index]!;
          const approved =
            chapterNumber % 50 === 0 || chapterNumber === input.plan.topology.chapterCount - 1;
          chapterRows.push({
            id: chapterId,
            workId: ids.workId,
            branchId: ids.mainBranchId,
            userId: ids.userId,
            number: chapterNumber,
            title: `第${chapterNumber}章 容量锚点`,
            status: approved ? "approved" : "writing",
            version: 1,
            wordCount: content.length,
            brief: {
              goal: `容量基准章节 ${chapterNumber}`,
              pov: "沈砚",
              location: `地点${chapterNumber % 37}`,
              sceneBeats: [{ id: `beat-${chapterNumber}`, title: "容量场景" }],
              requiredFacts: [`基准事实${chapterNumber}`],
            },
            createdAt: now,
            updatedAt: now,
          });
          nodeRows.push({
            id: nodeId,
            workId: ids.workId,
            branchId: ids.mainBranchId,
            userId: ids.userId,
            parentNodeId,
            nodeType: "chapter_version",
            objectType: "chapter",
            objectId: chapterId,
            objectVersion: 1,
            payload: { chapterNumber, contentHash: sha256(content) },
            actorId: ids.userId,
            message: `容量基准第 ${chapterNumber} 章`,
            createdAt: now,
          });
          versionRows.push({
            id: versionId,
            workId: ids.workId,
            branchId: ids.mainBranchId,
            userId: ids.userId,
            chapterId,
            version: 1,
            content,
            contentHash: sha256(content),
            versionNodeId: nodeId,
            source: "manuscript_import",
            createdAt: now,
          });
          parentNodeId = nodeId;
        }
        await tx.insert(chapters).values(chapterRows);
        await tx.insert(versionNodes).values(nodeRows);
        await tx.insert(chapterVersions).values(versionRows);
      }
      await tx.execute(sql`
        UPDATE chapters AS chapter
        SET current_version_id = version.id
        FROM chapter_versions AS version
        WHERE chapter.work_id = ${ids.workId}::uuid
          AND chapter.id = version.chapter_id
      `);

      await insertHistoricalChapterVersions(tx, {
        plan: input.plan,
        ids,
        chapterIds: mainChapterIds,
        chapterVersionIds: mainChapterVersionIds,
        chapterNodeIds: mainChapterNodeIds,
        now,
      });

      const outline = await insertOutline(tx, {
        plan: input.plan,
        ids,
        rootNodeId,
        chapterIds: mainChapterIds,
        chapterNodeIds: mainChapterNodeIds,
        now,
      });

      for (const [branchIndex, branchId] of ids.branchIds.entries()) {
        const divergenceChapter = Math.max(
          1,
          Math.min(
            input.plan.topology.chapterCount,
            Math.floor(
              ((branchIndex + 1) * input.plan.topology.chapterCount) / (ids.branchIds.length + 1),
            ),
          ),
        );
        await tx.insert(workBranches).values({
          id: branchId,
          workId: ids.workId,
          userId: ids.userId,
          name: `parallel-${branchIndex + 1}`,
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
        const branchRootNodeId = deterministicUuid(
          input.plan.seed,
          `version:branch-root:${branchIndex + 1}`,
        );
        await tx.insert(versionNodes).values({
          id: branchRootNodeId,
          workId: ids.workId,
          branchId,
          userId: ids.userId,
          parentNodeId: mainChapterNodeIds[divergenceChapter - 1]!,
          nodeType: "snapshot",
          objectType: "branch",
          objectId: branchId,
          objectVersion: 1,
          snapshotId: branchRootNodeId,
          payload: { divergenceChapter, sourceBranchId: ids.mainBranchId },
          actorId: ids.userId,
          message: "从主线创建平行版本",
          createdAt: now,
        });
        await tx
          .update(workBranches)
          .set({ headNodeId: branchRootNodeId, updatedAt: now })
          .where(eq(workBranches.id, branchId));
        const branchChapterId = deterministicUuid(
          input.plan.seed,
          `branch-chapter:${branchIndex + 1}`,
        );
        const branchVersionId = deterministicUuid(
          input.plan.seed,
          `branch-chapter-version:${branchIndex + 1}`,
        );
        const branchNodeId = deterministicUuid(
          input.plan.seed,
          `version:branch-chapter:${branchIndex + 1}`,
        );
        const content = `平行版本${branchIndex + 1}锚点。${benchmarkChapterContent(
          input.plan,
          divergenceChapter,
        ).slice(0, 2_000)}`;
        await tx.insert(chapters).values({
          id: branchChapterId,
          workId: ids.workId,
          branchId,
          userId: ids.userId,
          number: divergenceChapter,
          title: `平行版本${branchIndex + 1}分叉章`,
          status: "writing",
          version: 1,
          wordCount: content.length,
          brief: { goal: "验证平行版本读取", pov: "顾青", location: "分叉点" },
          createdAt: now,
          updatedAt: now,
        });
        await tx.insert(versionNodes).values({
          id: branchNodeId,
          workId: ids.workId,
          branchId,
          userId: ids.userId,
          parentNodeId: branchRootNodeId,
          nodeType: "chapter_version",
          objectType: "chapter",
          objectId: branchChapterId,
          objectVersion: 1,
          payload: { divergenceChapter, contentHash: sha256(content) },
          actorId: ids.userId,
          message: "平行版本分叉章",
          createdAt: now,
        });
        await tx.insert(chapterVersions).values({
          id: branchVersionId,
          workId: ids.workId,
          branchId,
          userId: ids.userId,
          chapterId: branchChapterId,
          version: 1,
          content,
          contentHash: sha256(content),
          versionNodeId: branchNodeId,
          source: "manual",
          createdAt: now,
        });
        await tx
          .update(chapters)
          .set({ currentVersionId: branchVersionId, updatedAt: now })
          .where(eq(chapters.id, branchChapterId));
        await tx
          .update(workBranches)
          .set({ headNodeId: branchNodeId, updatedAt: now })
          .where(eq(workBranches.id, branchId));
        branchIds.push(branchId);
      }

      await insertChangeAndMergeTopology(tx, {
        plan: input.plan,
        ids,
        branchIds,
        mainChapterIds,
        mainChapterNodeIds,
        now,
      });

      await insertCanonFacts(tx, {
        plan: input.plan,
        ids,
        chapterIds: mainChapterIds,
        chapterVersionIds: mainChapterVersionIds,
        chapterNodeIds: mainChapterNodeIds,
        now,
      });

      await insertSummaries(tx, {
        plan: input.plan,
        ids,
        chapterIds: mainChapterIds,
        chapterNodeIds: mainChapterNodeIds,
        outline,
        now,
      });

      await insertSearchDocuments(tx, {
        plan: input.plan,
        ids,
        chapterIds: mainChapterIds,
        chapterNodeIds: mainChapterNodeIds,
        entityIds,
        entityNodeIds,
        now,
      });

      const jobSummary = await insertOperationalRecords(tx, {
        plan: input.plan,
        ids,
        chapterIds: mainChapterIds,
        outline,
        now,
      });

      const importJobId = deterministicUuid(input.plan.seed, "import-job");
      const importChunkCount = Math.min(100, input.plan.topology.chapterCount);
      await tx.insert(importJobs).values({
        id: importJobId,
        userId: ids.userId,
        workId: ids.workId,
        branchId: ids.mainBranchId,
        mode: "manuscript_text",
        status: "completed",
        sourceKind: "paste",
        sourceName: "capacity-benchmark.txt",
        sourceText: "",
        idempotencyKey: `benchmark-import-${input.plan.seed}`,
        chunkCount: importChunkCount,
        processedChunks: importChunkCount,
        checkpoint: { nextSequence: importChunkCount },
        metadata: { benchmark: true, chunked: true },
        confirmedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      let importOffset = 0;
      for (let offset = 0; offset < importChunkCount; offset += 50) {
        const end = Math.min(importChunkCount, offset + 50);
        const rows = [];
        for (let index = offset; index < end; index += 1) {
          const content = benchmarkChapterContent(input.plan, index + 1).slice(0, 5_000);
          rows.push({
            id: deterministicUuid(input.plan.seed, `import-chunk:${index + 1}`),
            importJobId,
            userId: ids.userId,
            sequence: index,
            sourceText: content,
            startOffset: importOffset,
            endOffset: importOffset + content.length,
            status: "processed" as const,
            createdAt: now,
            updatedAt: now,
          });
          importOffset += content.length;
        }
        await tx.insert(importChunks).values(rows);
      }
      await tx.insert(importReports).values({
        id: deterministicUuid(input.plan.seed, "import-report"),
        importJobId,
        userId: ids.userId,
        acceptedCandidateIds: [],
        pendingCandidateIds: [],
        unparsed: [],
        createdAt: now,
      });

      await insertExports(tx, {
        plan: input.plan,
        ids,
        now,
      });

      await tx.insert(searchRebuildRuns).values({
        id: deterministicUuid(input.plan.seed, "search-rebuild"),
        workId: ids.workId,
        branchId: ids.mainBranchId,
        userId: ids.userId,
        status: "completed",
        stage: 5,
        stageOffset: 0,
        indexed: input.plan.topology.chapterCount + ENTITY_COUNT,
        expectedTotal: input.plan.topology.chapterCount + ENTITY_COUNT,
        startedAt: now,
        completedAt: now,
        updatedAt: now,
      });
      await tx.insert(summaryRebuildRuns).values({
        id: deterministicUuid(input.plan.seed, "summary-rebuild"),
        workId: ids.workId,
        branchId: ids.mainBranchId,
        userId: ids.userId,
        status: "completed",
        levels: ["chapter", "volume", "book"],
        idempotencyKey: `benchmark-summary-${input.plan.seed}`,
        compilerVersion: input.plan.generatorVersion,
        modelVersion: "deterministic-fake-v1",
        checkpointRevision: 1,
        totalItems: input.plan.topology.chapterCount,
        completedItems: input.plan.topology.chapterCount,
        failedItems: 0,
        createdAt: now,
        updatedAt: now,
        finishedAt: now,
      });

      await tx
        .update(workBranches)
        .set({ headNodeId: parentNodeId, updatedAt: now })
        .where(eq(workBranches.id, ids.mainBranchId));
      await tx
        .insert(systemMetadata)
        .values([
          {
            key: `capacity_benchmark:${input.plan.seed}:work_id`,
            value: ids.workId,
            updatedAt: now,
          },
          {
            key: `capacity_benchmark:${input.plan.seed}:manifest`,
            value: JSON.stringify({
              generatorVersion: input.plan.generatorVersion,
              logicalCharacters: expected.logicalCharacters,
            }),
            updatedAt: now,
          },
        ])
        .onConflictDoUpdate({
          target: systemMetadata.key,
          set: {
            value: sql`excluded.value`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
      await tx.insert(auditLogs).values(
        Array.from({ length: 20 }, (_, index) => ({
          id: deterministicUuid(input.plan.seed, `audit:${index + 1}`),
          actorId: ids.userId,
          action: "capacity.benchmark.seeded",
          targetType: "work",
          targetId: ids.workId,
          decision: "allowed",
          correlationId: `capacity-seed-${index + 1}`,
          ip: "127.0.0.1",
          userAgent: "capacity-benchmark-harness",
          createdAt: now,
        })),
      );

      return {
        importChunks: importChunkCount,
        jobCount: jobSummary.jobCount,
        jobWorkItems: jobSummary.jobWorkItems,
      };
    });

    const migrationVersion = await latestMigrationVersion(pool);
    const textTotals = await pool.query<{
      logical_characters: string;
      utf8_bytes: string;
      chapters: string;
      versions: string;
    }>(
      `SELECT
         COALESCE(sum(char_length(version.content)), 0)::text AS logical_characters,
         COALESCE(sum(octet_length(version.content)), 0)::text AS utf8_bytes,
         count(version.id)::text AS versions,
         count(DISTINCT chapter.id)::text AS chapters
       FROM chapters AS chapter
       INNER JOIN chapter_versions AS version ON version.id = chapter.current_version_id
       WHERE chapter.work_id = $1 AND chapter.branch_id = $2`,
      [ids.workId, ids.mainBranchId],
    );
    const totals = textTotals.rows[0];
    if (
      Number(totals?.logical_characters) !== expected.logicalCharacters ||
      Number(totals?.utf8_bytes) !== expected.utf8Bytes ||
      Number(totals?.chapters) !== input.plan.topology.chapterCount ||
      Number(totals?.versions) !== input.plan.topology.chapterCount
    ) {
      throw new Error("FIXTURE_TEXT_INTEGRITY_MISMATCH");
    }
    const rowCounts = await collectRowCounts(pool);
    const versionNodeTypes = await collectVersionNodeTypes(pool, ids.workId);
    const entityCounts = {
      versionNodes: rowCounts.version_nodes ?? 0,
      chapters: rowCounts.chapters ?? 0,
      chapterVersions: rowCounts.chapter_versions ?? 0,
      entities: rowCounts.entities ?? 0,
      facts: rowCounts.facts ?? 0,
      summaries: rowCounts.summary_records ?? 0,
      searchDocuments: rowCounts.search_documents ?? 0,
      jobs: rowCounts.jobs ?? 0,
      jobWorkItems: rowCounts.job_work_items ?? 0,
      importChunks: rowCounts.import_chunks ?? 0,
      exportReceipts: rowCounts.work_export_receipts ?? 0,
    };
    return {
      formatVersion: 1,
      generatorVersion: input.plan.generatorVersion,
      seed: input.plan.seed,
      tier: input.plan.tier,
      topology: input.plan.topology,
      branchCount: branchCountFromPlan(input.plan),
      branchTopology: {
        mainBranchName: "main",
        parallelBranchCount: input.plan.branchCount,
        divergenceDepth: input.plan.branchCount === 0 ? 0 : 1,
        branches: ids.branchIds.map((_, index) => ({
          name: `parallel-${index + 1}`,
          divergenceChapter: Math.max(
            1,
            Math.min(
              input.plan.topology.chapterCount,
              Math.floor(
                ((index + 1) * input.plan.topology.chapterCount) / (ids.branchIds.length + 1),
              ),
            ),
          ),
          branchChapterCount: 1,
        })),
      },
      sourceCommit,
      schemaMigrationVersion: migrationVersion,
      logicalCharacters: expected.logicalCharacters,
      utf8ManuscriptBytes: expected.utf8Bytes,
      manuscriptSha256: expected.sha256,
      chapterCount: input.plan.topology.chapterCount,
      volumeCount: input.plan.topology.volumeCount,
      entityCounts,
      objectCount: objectFixture.count,
      objectBytes: objectFixture.bytes,
      objectChecksums: objectFixture.checksums,
      versionNodeTypes,
      rowCounts,
      ids: {
        userId: ids.userId,
        workId: ids.workId,
        mainBranchId: ids.mainBranchId,
        branchIds,
      },
    };
  } finally {
    await pool.end();
  }
}

type TenantTransaction = DatabaseTransaction;

async function insertDomainRecords(
  tx: TenantTransaction,
  input: {
    plan: BenchmarkPlan;
    ids: ReturnType<typeof createBenchmarkFixtureIds>;
    rootNodeId: string;
    now: Date;
  },
) {
  const indexesByType = new Map<string, number[]>();
  for (let index = 1; index <= ENTITY_COUNT; index += 1) {
    const type = entityType(index);
    indexesByType.set(type, [...(indexesByType.get(type) ?? []), index]);
  }
  const indexes = (type: string) => indexesByType.get(type) ?? [];
  const entityId = (index: number) => deterministicUuid(input.plan.seed, `entity:${index}`);
  const entityNodeId = (index: number) =>
    deterministicUuid(input.plan.seed, `version:entity:${index}`);

  const characterIndexes = indexes("character");
  const factionIndexes = indexes("faction");
  const mapIndexes = indexes("map");
  const timelineIndexes = indexes("timeline_event");
  const powerIndexes = indexes("power_system");
  const goldenFingerIndexes = indexes("golden_finger");
  const itemIndexes = indexes("item");

  if (characterIndexes.length > 0) {
    await tx.insert(characterProfiles).values(
      characterIndexes.map((index) => ({
        entityId: entityId(index),
        workId: input.ids.workId,
        branchId: input.ids.mainBranchId,
        userId: input.ids.userId,
        desire: `角色${index}的欲望`,
        fear: `角色${index}的恐惧`,
        goal: `角色${index}的目标`,
        voiceSample: `角色${index}的声音样本`,
        voiceGuide: `角色${index}的声音指南`,
        disguise: "",
        createdAt: input.now,
        updatedAt: input.now,
      })),
    );
  }
  if (factionIndexes.length > 0) {
    await tx.insert(factionProfiles).values(
      factionIndexes.map((index) => ({
        entityId: entityId(index),
        workId: input.ids.workId,
        branchId: input.ids.mainBranchId,
        userId: input.ids.userId,
        overview: `势力${index}概览`,
        goals: `势力${index}目标`,
        resources: `势力${index}资源`,
        doctrine: `势力${index}规则`,
        createdAt: input.now,
        updatedAt: input.now,
      })),
    );
  }
  if (characterIndexes.length >= 2) {
    await tx.insert(characterRelationships).values({
      id: deterministicUuid(input.plan.seed, "character-relationship:1"),
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      sourceCharacterId: entityId(characterIndexes[0]!),
      targetType: "character",
      targetId: entityId(characterIndexes[1]!),
      targetLabel: `角色${characterIndexes[1]}`,
      relationType: "ally",
      validFromChapter: 1,
      versionNodeId: entityNodeId(characterIndexes[0]!),
      createdBy: input.ids.userId,
      createdAt: input.now,
    });
  }
  if (factionIndexes.length >= 2) {
    await tx.insert(factionRelationships).values({
      id: deterministicUuid(input.plan.seed, "faction-relationship:1"),
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      sourceFactionId: entityId(factionIndexes[0]!),
      targetType: "faction",
      targetId: entityId(factionIndexes[1]!),
      targetLabel: `势力${factionIndexes[1]}`,
      relationType: "trade",
      validFromChapter: 1,
      versionNodeId: entityNodeId(factionIndexes[0]!),
      createdBy: input.ids.userId,
      createdAt: input.now,
    });
  }
  if (characterIndexes.length > 0) {
    await tx.insert(characterStateTransitions).values({
      id: deterministicUuid(input.plan.seed, "character-state:1"),
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      characterId: entityId(characterIndexes[0]!),
      stateKind: "body",
      stateKey: "body_state",
      value: "健康",
      validFromChapter: 1,
      versionNodeId: entityNodeId(characterIndexes[0]!),
      createdBy: input.ids.userId,
      createdAt: input.now,
    });
  }

  const mapNodeIds: string[] = [];
  if (mapIndexes.length > 0) {
    const mapId = entityId(mapIndexes[0]!);
    const layerId = deterministicUuid(input.plan.seed, "map-layer:1");
    await tx.insert(mapLayers).values({
      id: layerId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      mapId,
      name: "基准图层",
      sortOrder: 1,
      minScale: 0,
      maxScale: 100,
      validFromChapter: 1,
      versionNodeId: entityNodeId(mapIndexes[0]!),
      createdBy: input.ids.userId,
      createdAt: input.now,
    });
    for (let index = 1; index <= 3; index += 1) {
      const nodeId = deterministicUuid(input.plan.seed, `map-node:${index}`);
      mapNodeIds.push(nodeId);
      await tx.insert(mapNodes).values({
        id: nodeId,
        workId: input.ids.workId,
        branchId: input.ids.mainBranchId,
        userId: input.ids.userId,
        mapId,
        layerId,
        name: `基准地点${index}`,
        nodeType: index === 1 ? "settlement" : "landmark",
        summary: `基准地图节点${index}`,
        x: index / 10,
        y: index / 10,
        validFromChapter: 1,
        versionNodeId: entityNodeId(mapIndexes[0]!),
        createdBy: input.ids.userId,
        createdAt: input.now,
      });
    }
    await tx.insert(mapEdges).values({
      id: deterministicUuid(input.plan.seed, "map-edge:1"),
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      mapId,
      layerId,
      fromNodeId: mapNodeIds[0]!,
      toNodeId: mapNodeIds[1]!,
      routeType: "road",
      bidirectional: true,
      travelMinutes: 60,
      validFromChapter: 1,
      versionNodeId: entityNodeId(mapIndexes[0]!),
      createdBy: input.ids.userId,
      createdAt: input.now,
    });
    await tx.insert(mapMarkers).values({
      id: deterministicUuid(input.plan.seed, "map-marker:1"),
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      mapId,
      layerId,
      nodeId: mapNodeIds[0]!,
      label: "基准标记",
      markerType: "note",
      x: 0.1,
      y: 0.1,
      validFromChapter: 1,
      versionNodeId: entityNodeId(mapIndexes[0]!),
      createdBy: input.ids.userId,
      createdAt: input.now,
    });
  }

  const eraName = "基准纪元";
  await tx.insert(timelineEras).values({
    id: deterministicUuid(input.plan.seed, "timeline-era:1"),
    workId: input.ids.workId,
    branchId: input.ids.mainBranchId,
    userId: input.ids.userId,
    name: eraName,
    orderIndex: 1,
    startSortKey: 0,
    endSortKey: input.plan.topology.chapterCount,
    description: "容量基准时间线",
    versionNodeId: input.rootNodeId,
    createdBy: input.ids.userId,
    createdAt: input.now,
  });
  if (timelineIndexes.length > 0) {
    await tx.insert(timelineEvents).values(
      timelineIndexes.map((index, offset) => ({
        id: entityId(index),
        workId: input.ids.workId,
        branchId: input.ids.mainBranchId,
        userId: input.ids.userId,
        era: eraName,
        storyTimeLabel: `第${offset + 1}日`,
        storyTimeSortKey: offset + 1,
        durationMinutes: 120,
        durationLabel: "两个时辰",
        eventText: `容量基准时间线事件${index}`,
        validFromChapter: offset + 1,
        versionNodeId: entityNodeId(index),
        createdBy: input.ids.userId,
        createdAt: input.now,
      })),
    );
  }

  if (powerIndexes.length > 0) {
    const powerSystemId = entityId(powerIndexes[0]!);
    const pathId = deterministicUuid(input.plan.seed, "power-path:1");
    await tx.insert(powerSystems).values({
      entityId: powerSystemId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      overview: "容量基准力量体系",
      lifespanMode: "none",
      lifespanUnit: "年",
      lifespanBasis: "",
      lifespanDescription: "",
      createdAt: input.now,
      updatedAt: input.now,
    });
    await tx.insert(powerPaths).values({
      id: pathId,
      powerSystemId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      name: "基准路径",
      pathType: "orthodox",
      description: "容量基准力量路径",
      sortOrder: 1,
      versionNodeId: entityNodeId(powerIndexes[0]!),
      createdBy: input.ids.userId,
      createdAt: input.now,
    });
    const realmOneId = deterministicUuid(input.plan.seed, "power-realm:1");
    await tx.insert(powerRealms).values([
      {
        id: realmOneId,
        pathId,
        workId: input.ids.workId,
        branchId: input.ids.mainBranchId,
        userId: input.ids.userId,
        name: "炼气",
        rank: 1,
        description: "基础境界",
        breakthroughConditions: "完成基础修炼",
        versionNodeId: entityNodeId(powerIndexes[0]!),
        createdBy: input.ids.userId,
        createdAt: input.now,
      },
      {
        id: deterministicUuid(input.plan.seed, "power-realm:2"),
        pathId,
        workId: input.ids.workId,
        branchId: input.ids.mainBranchId,
        userId: input.ids.userId,
        name: "筑基",
        rank: 2,
        description: "第二境界",
        breakthroughConditions: "完成筑基",
        prerequisiteRealmId: realmOneId,
        versionNodeId: entityNodeId(powerIndexes[0]!),
        createdBy: input.ids.userId,
        createdAt: input.now,
      },
    ]);
  }

  if (goldenFingerIndexes.length > 0) {
    await tx.insert(specialMechanisms).values({
      entityId: entityId(goldenFingerIndexes[0]!),
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      mechanismType: "golden_finger",
      ownerType: characterIndexes.length > 0 ? "character" : null,
      ownerId: characterIndexes.length > 0 ? entityId(characterIndexes[0]!) : null,
      ownerLabel: characterIndexes.length > 0 ? `角色${characterIndexes[0]}` : null,
      powerSystemId: powerIndexes.length > 0 ? entityId(powerIndexes[0]!) : null,
      rules: "容量基准金手指规则",
      costs: "容量基准代价",
      limits: "容量基准限制",
      growth: "容量基准成长",
      createdAt: input.now,
      updatedAt: input.now,
    });
  }
  if (itemIndexes.length > 0) {
    await tx.insert(itemTechniques).values(
      itemIndexes.map((index) => ({
        entityId: entityId(index),
        workId: input.ids.workId,
        branchId: input.ids.mainBranchId,
        userId: input.ids.userId,
        kind: "item",
        category: "法器",
        grade: "基准",
        effect: `物品效果${index}`,
        cost: "",
        limits: "",
        ownershipModel: "shared",
        consumable: false,
        quantity: 1,
        createdAt: input.now,
        updatedAt: input.now,
      })),
    );
  }
}

async function insertHistoricalChapterVersions(
  tx: TenantTransaction,
  input: {
    plan: BenchmarkPlan;
    ids: ReturnType<typeof createBenchmarkFixtureIds>;
    chapterIds: string[];
    chapterVersionIds: string[];
    chapterNodeIds: string[];
    now: Date;
  },
) {
  for (
    let chapterNumber = 10;
    chapterNumber <= input.plan.topology.chapterCount;
    chapterNumber += 25
  ) {
    if (chapterNumber % 50 === 0) {
      continue;
    }
    const index = chapterNumber - 1;
    const content = benchmarkChapterContent(input.plan, chapterNumber);
    const revisedContent = content;
    const versionId = deterministicUuid(input.plan.seed, `chapter-version:${chapterNumber}:2`);
    const versionNodeId = deterministicUuid(input.plan.seed, `version:chapter:${chapterNumber}:2`);
    await tx.insert(versionNodes).values({
      id: versionNodeId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      parentNodeId: input.chapterNodeIds[index]!,
      nodeType: "chapter_version",
      objectType: "chapter",
      objectId: input.chapterIds[index]!,
      objectVersion: 2,
      payload: { contentHash: sha256(revisedContent), revision: 2 },
      actorId: input.ids.userId,
      message: `容量基准第 ${chapterNumber} 章修订`,
      createdAt: input.now,
    });
    await tx.insert(chapterVersions).values({
      id: versionId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      chapterId: input.chapterIds[index]!,
      version: 2,
      content: revisedContent,
      contentHash: sha256(revisedContent),
      versionNodeId,
      source: "manual",
      createdAt: input.now,
    });
    await tx
      .update(chapters)
      .set({
        version: 2,
        currentVersionId: versionId,
        wordCount: revisedContent.length,
        status: "writing",
        updatedAt: input.now,
      })
      .where(eq(chapters.id, input.chapterIds[index]!));
    input.chapterVersionIds[index] = versionId;
    input.chapterNodeIds[index] = versionNodeId;
  }
}

async function insertChangeAndMergeTopology(
  tx: TenantTransaction,
  input: {
    plan: BenchmarkPlan;
    ids: ReturnType<typeof createBenchmarkFixtureIds>;
    branchIds: string[];
    mainChapterIds: string[];
    mainChapterNodeIds: string[];
    now: Date;
  },
) {
  for (let index = 0; index < Math.min(6, input.mainChapterIds.length); index += 1) {
    const changeId = deterministicUuid(input.plan.seed, `change-request:${index + 1}`);
    const nodeId = deterministicUuid(input.plan.seed, `version:change-apply:${index + 1}`);
    await tx.insert(changeRequests).values({
      id: changeId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      title: `容量基准修改${index + 1}`,
      reason: "覆盖版本应用路径",
      targetVersion: 1,
      targetType: "chapter",
      targetId: input.mainChapterIds[index]!,
      objectType: "chapter",
      before: { status: "writing" },
      after: { status: "writing", revised: true },
      diff: { changed: ["content"] },
      source: "author",
      risk: "low",
      status: "applied",
      idempotencyKey: `benchmark-change-${index + 1}`,
      createdAt: input.now,
      updatedAt: input.now,
    });
    await tx.insert(changeImpacts).values({
      id: deterministicUuid(input.plan.seed, `change-impact:${index + 1}`),
      changeId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      category: "safe",
      affectedType: "chapter",
      affectedId: input.mainChapterIds[index]!,
      chapterId: input.mainChapterIds[index]!,
      summary: "容量基准修改影响",
      evidence: { benchmark: true },
      confidence: 0.99,
      createdAt: input.now,
    });
    await tx.insert(versionNodes).values({
      id: nodeId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      parentNodeId: input.mainChapterNodeIds[index]!,
      nodeType: "change_apply",
      objectType: "change_request",
      objectId: changeId,
      objectVersion: 1,
      payload: { benchmark: true },
      actorId: input.ids.userId,
      message: "应用容量基准修改",
      createdAt: input.now,
    });
  }

  for (let index = 0; index < input.plan.topology.volumeCount; index += 1) {
    await tx.insert(versionNodes).values({
      id: deterministicUuid(input.plan.seed, `version:outline:${index + 1}`),
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      parentNodeId:
        input.mainChapterNodeIds[
          Math.min(
            input.mainChapterNodeIds.length - 1,
            index * input.plan.topology.chaptersPerVolume,
          )
        ],
      nodeType: "outline_version",
      objectType: "outline",
      objectId: input.mainChapterIds[index] ?? input.mainChapterIds[0]!,
      objectVersion: 1,
      payload: { volumeNumber: index + 1, benchmark: true },
      actorId: input.ids.userId,
      message: `容量基准第 ${index + 1} 卷大纲版本`,
      createdAt: input.now,
    });
  }

  for (const [index, sourceBranchId] of input.branchIds.slice(1).entries()) {
    const sourceChapterId = deterministicUuid(input.plan.seed, `branch-chapter:${index + 1}`);
    const sourceNodeId = deterministicUuid(input.plan.seed, `version:branch-chapter:${index + 1}`);
    const mergeItemId = deterministicUuid(input.plan.seed, `merge-item:${index + 1}`);
    const mergeNodeId = deterministicUuid(input.plan.seed, `version:branch-merge:${index + 1}`);
    await tx.insert(mergeItems).values({
      id: mergeItemId,
      workId: input.ids.workId,
      sourceBranchId,
      targetBranchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      sourceNodeId,
      targetNodeId: input.mainChapterNodeIds[0]!,
      objectType: "chapter",
      objectId: sourceChapterId,
      objectKey: `chapter:${index + 1}`,
      sourcePayload: { source: "parallel" },
      targetPayload: { source: "main" },
      diff: { changed: true },
      changeKind: "changed",
      risk: index === 0 ? "high" : "medium",
      conflict: index === 1,
      status: "applied",
      reason: "容量基准选择性摘取",
      createdAt: input.now,
      updatedAt: input.now,
    });
    await tx.insert(mergeDecisions).values({
      id: deterministicUuid(input.plan.seed, `merge-decision:${index + 1}`),
      mergeItemId,
      userId: input.ids.userId,
      action: "accept",
      reason: "容量基准摘取决策",
      expectedVersion: 1,
      createdAt: input.now,
    });
    await tx.insert(versionNodes).values({
      id: mergeNodeId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      parentNodeId: input.mainChapterNodeIds[0]!,
      nodeType: "branch_merge",
      objectType: "merge_item",
      objectId: mergeItemId,
      objectVersion: 1,
      payload: { sourceBranchId, sourceNodeId },
      actorId: input.ids.userId,
      message: "容量基准分支摘取",
      createdAt: input.now,
    });
  }

  await tx.insert(versionNodes).values({
    id: deterministicUuid(input.plan.seed, "version:rollback:1"),
    workId: input.ids.workId,
    branchId: input.ids.mainBranchId,
    userId: input.ids.userId,
    parentNodeId: input.mainChapterNodeIds.at(-1),
    nodeType: "rollback",
    objectType: "work",
    objectId: input.ids.workId,
    objectVersion: 1,
    payload: { benchmark: true },
    actorId: input.ids.userId,
    message: "容量基准回滚节点",
    createdAt: input.now,
  });
}

async function insertOutline(
  tx: TenantTransaction,
  input: {
    plan: BenchmarkPlan;
    ids: ReturnType<typeof createBenchmarkFixtureIds>;
    rootNodeId: string;
    chapterIds: string[];
    chapterNodeIds: string[];
    now: Date;
  },
) {
  const bookId = deterministicUuid(input.plan.seed, "outline:book");
  await tx.insert(outlineNodes).values({
    id: bookId,
    workId: input.ids.workId,
    branchId: input.ids.mainBranchId,
    userId: input.ids.userId,
    level: "book",
    sortOrder: 0,
    title: "容量基准全书",
    summary: "确定性十章容量结构",
    status: "active",
    locked: true,
    version: 1,
    versionNodeId: input.rootNodeId,
    createdAt: input.now,
    updatedAt: input.now,
  });
  const volumes: Array<{ id: string; number: number }> = [];
  for (let volumeNumber = 1; volumeNumber <= input.plan.topology.volumeCount; volumeNumber += 1) {
    const volumeId = deterministicUuid(input.plan.seed, `outline:volume:${volumeNumber}`);
    volumes.push({ id: volumeId, number: volumeNumber });
  }
  await tx.insert(outlineNodes).values(
    volumes.map((volume) => ({
      id: volume.id,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      level: "volume" as const,
      parentId: bookId,
      sortOrder: volume.number,
      title: `第${volume.number}卷`,
      summary: `第${volume.number}卷容量摘要`,
      status: "active" as const,
      locked: true,
      version: 1,
      versionNodeId: input.rootNodeId,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  );
  await tx.insert(volumeContracts).values(
    volumes.map((volume) => ({
      id: deterministicUuid(input.plan.seed, `volume-contract:${volume.number}`),
      nodeId: volume.id,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      objective: `完成第${volume.number}卷容量目标`,
      conflict: `第${volume.number}卷基准冲突`,
      turningPoints: ["转折一", "转折二"],
      exitConditions: ["卷末验收"],
      plotLines: [],
      version: 1,
      versionNodeId: input.rootNodeId,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  );

  const chapterOutlineIds: string[] = [];
  for (let offset = 0; offset < input.chapterIds.length; offset += CHAPTER_BATCH_SIZE) {
    const end = Math.min(input.chapterIds.length, offset + CHAPTER_BATCH_SIZE);
    const rows = [];
    for (let index = offset; index < end; index += 1) {
      const chapterNumber = index + 1;
      const volumeIndex = Math.min(
        volumes.length - 1,
        Math.floor((chapterNumber - 1) / input.plan.topology.chaptersPerVolume),
      );
      const volume = volumes[volumeIndex]!;
      const chapterOutlineId = deterministicUuid(
        input.plan.seed,
        `outline:chapter:${chapterNumber}`,
      );
      chapterOutlineIds.push(chapterOutlineId);
      rows.push({
        id: chapterOutlineId,
        workId: input.ids.workId,
        branchId: input.ids.mainBranchId,
        userId: input.ids.userId,
        level: "chapter" as const,
        parentId: volume.id,
        sortOrder: chapterNumber - volumeIndex * input.plan.topology.chaptersPerVolume,
        title: `第${chapterNumber}章`,
        summary: `第${chapterNumber}章容量锚点`,
        status: "done" as const,
        locked: true,
        version: 1,
        chapterId: input.chapterIds[index]!,
        tension: 50 + (chapterNumber % 50),
        versionNodeId: input.chapterNodeIds[index]!,
        createdAt: input.now,
        updatedAt: input.now,
      });
    }
    await tx.insert(outlineNodes).values(rows);
  }
  return { bookId, volumeIds: volumes.map((volume) => volume.id), chapterOutlineIds };
}

async function insertCanonFacts(
  tx: TenantTransaction,
  input: {
    plan: BenchmarkPlan;
    ids: ReturnType<typeof createBenchmarkFixtureIds>;
    chapterIds: string[];
    chapterVersionIds: string[];
    chapterNodeIds: string[];
    now: Date;
  },
) {
  const selected = input.chapterIds
    .map((chapterId, index) => ({ chapterId, index }))
    .filter(({ index }) => (index + 1) % 50 === 0);
  for (const { chapterId, index } of selected) {
    const chapterNumber = index + 1;
    const canonId = deterministicUuid(input.plan.seed, `canon:${chapterNumber}`);
    const canonNodeId = deterministicUuid(input.plan.seed, `version:canon:${chapterNumber}`);
    const proposalId = deterministicUuid(input.plan.seed, `fact-proposal:${chapterNumber}`);
    const decisionId = deterministicUuid(input.plan.seed, `fact-decision:${chapterNumber}`);
    const factId = deterministicUuid(input.plan.seed, `fact:${chapterNumber}`);
    const versionId = input.chapterVersionIds[index]!;
    await tx.insert(versionNodes).values({
      id: canonNodeId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      parentNodeId: input.chapterNodeIds[index]!,
      nodeType: "canon_commit",
      objectType: "canon_commit",
      objectId: canonId,
      objectVersion: 1,
      snapshotId: canonNodeId,
      payload: { chapterNumber },
      actorId: input.ids.userId,
      message: `提交第${chapterNumber}章正史`,
      createdAt: input.now,
    });
    await tx.insert(canonCommits).values({
      id: canonId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      chapterId,
      chapterVersionId: versionId,
      versionNodeId: canonNodeId,
      idempotencyKey: `benchmark-canon-${chapterNumber}`,
      decisionSnapshot: [{ factId, decision: "confirmed" }],
      summary: { benchmark: true, chapterNumber },
      actorId: input.ids.userId,
      createdAt: input.now,
    });
    await tx.insert(factProposals).values({
      id: proposalId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      chapterId,
      sourceVersionId: versionId,
      extractionKey: `benchmark-fact-${chapterNumber}`,
      subject: `角色${chapterNumber % 20}`,
      predicate: "位于",
      object: `地点${chapterNumber % 37}`,
      sourceSentence: `基准事实句子${chapterNumber}`,
      status: "confirmed",
      confidence: 0.99,
      risk: "low",
      required: true,
      createdAt: input.now,
      updatedAt: input.now,
    });
    await tx.insert(factDecisions).values({
      id: decisionId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      chapterId,
      factProposalId: proposalId,
      action: "confirm",
      actorId: input.ids.userId,
      actorName: "容量基准作者",
      reason: "确定性夹具",
      originalPayload: { subject: `角色${chapterNumber % 20}` },
      resultingPayload: { subject: `角色${chapterNumber % 20}`, confirmed: true },
      decidedAt: input.now,
    });
    await tx.insert(facts).values({
      id: factId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      chapterId,
      factProposalId: proposalId,
      decisionId,
      sourceVersionId: versionId,
      canonCommitId: canonId,
      subject: `角色${chapterNumber % 20}`,
      predicate: "位于",
      object: `地点${chapterNumber % 37}`,
      risk: "low",
      required: true,
      status: "active",
      validFromChapter: chapterNumber,
      createdAt: input.now,
    });
    await tx.insert(reviewDecisions).values({
      id: deterministicUuid(input.plan.seed, `review:${chapterNumber}`),
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      chapterId,
      chapterVersionId: versionId,
      action: "approve",
      actorId: input.ids.userId,
      actorName: "容量基准作者",
      reason: "确定性容量夹具",
      decidedAt: input.now,
    });
  }

  const candidateChapterNumber = input.plan.topology.chapterCount - 1;
  if (candidateChapterNumber % 50 !== 0) {
    const candidateIndex = candidateChapterNumber - 1;
    const candidateChapterId = input.chapterIds[candidateIndex]!;
    const candidateVersionId = input.chapterVersionIds[candidateIndex]!;
    const proposalId = deterministicUuid(
      input.plan.seed,
      `canon-candidate-proposal:${candidateChapterNumber}`,
    );
    const decisionId = deterministicUuid(
      input.plan.seed,
      `canon-candidate-decision:${candidateChapterNumber}`,
    );
    await tx.insert(factProposals).values({
      id: proposalId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      chapterId: candidateChapterId,
      sourceVersionId: candidateVersionId,
      extractionKey: `benchmark-canon-candidate-${candidateChapterNumber}`,
      subject: `候选角色${candidateChapterNumber}`,
      predicate: "确认",
      object: `候选事实${candidateChapterNumber}`,
      sourceSentence: `正史提交候选句${candidateChapterNumber}`,
      status: "confirmed",
      confidence: 0.99,
      risk: "low",
      required: true,
      createdAt: input.now,
      updatedAt: input.now,
    });
    await tx.insert(factDecisions).values({
      id: decisionId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      chapterId: candidateChapterId,
      factProposalId: proposalId,
      action: "confirm",
      actorId: input.ids.userId,
      actorName: "容量基准作者",
      reason: "容量基准正史提交候选",
      originalPayload: { benchmark: true },
      resultingPayload: { benchmark: true, confirmed: true },
      decidedAt: input.now,
    });
    await tx.insert(qualityReports).values({
      id: deterministicUuid(input.plan.seed, `canon-candidate-quality:${candidateChapterNumber}`),
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      chapterId: candidateChapterId,
      chapterVersionId: candidateVersionId,
      rubricVersion: "m1-quality-rubric-v1",
      ruleVersion: "m1-critic-rules-v1",
      sourceHash: sha256(`canon-candidate-quality:${candidateChapterNumber}`),
      dimensions: [
        {
          dimension: "hook",
          label: "钩子",
          score: 4,
          rationale: "容量基准候选章节通过确定性质量门",
          evidence: [],
        },
        {
          dimension: "pacing",
          label: "节奏",
          score: 4,
          rationale: "容量基准候选章节通过确定性质量门",
          evidence: [],
        },
        {
          dimension: "information_density",
          label: "信息密度",
          score: 4,
          rationale: "容量基准候选章节通过确定性质量门",
          evidence: [],
        },
        {
          dimension: "character_voice",
          label: "人物声音",
          score: 4,
          rationale: "容量基准候选章节通过确定性质量门",
          evidence: [],
        },
        {
          dimension: "prose",
          label: "文笔",
          score: 4,
          rationale: "容量基准候选章节通过确定性质量门",
          evidence: [],
        },
        {
          dimension: "continuity",
          label: "连续性",
          score: 4,
          rationale: "容量基准候选章节通过确定性质量门",
          evidence: [],
        },
      ],
      summary: "容量基准候选章节质量报告；无阻断项。",
      createdBy: input.ids.userId,
      createdAt: input.now,
    });
  }
  if (input.plan.topology.chapterCount >= 50) {
    await tx.insert(characterKnowledgeStates).values({
      id: deterministicUuid(input.plan.seed, "character-knowledge:1"),
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      characterId: deterministicUuid(input.plan.seed, "entity:1"),
      objectiveFactId: deterministicUuid(input.plan.seed, "fact:50"),
      state: "knowledge",
      claimedContent: "角色知道容量基准事实",
      sourceKind: "observed",
      validFromChapter: 50,
      sourceChapterId: input.chapterIds[49]!,
      versionNodeId: deterministicUuid(input.plan.seed, "version:entity:1"),
      createdBy: input.ids.userId,
      createdAt: input.now,
    });
  }
}

async function insertSummaries(
  tx: TenantTransaction,
  input: {
    plan: BenchmarkPlan;
    ids: ReturnType<typeof createBenchmarkFixtureIds>;
    chapterIds: string[];
    chapterNodeIds: string[];
    outline: Awaited<ReturnType<typeof insertOutline>>;
    now: Date;
  },
) {
  for (let offset = 0; offset < input.chapterIds.length; offset += CHAPTER_BATCH_SIZE) {
    const end = Math.min(input.chapterIds.length, offset + CHAPTER_BATCH_SIZE);
    const rows = [];
    for (let index = offset; index < end; index += 1) {
      const chapterNumber = index + 1;
      const content = `第${chapterNumber}章容量摘要：主角抵达地点${chapterNumber % 37}。`;
      rows.push({
        id: deterministicUuid(input.plan.seed, `summary:chapter:${chapterNumber}`),
        workId: input.ids.workId,
        branchId: input.ids.mainBranchId,
        userId: input.ids.userId,
        level: "chapter" as const,
        scopeId: input.chapterIds[index]!,
        chapterId: input.chapterIds[index]!,
        title: `第${chapterNumber}章摘要`,
        content,
        status: "stale" as const,
        version: 1,
        contentHash: sha256(content),
        inputHash: sha256(`input:${chapterNumber}`),
        compilerVersion: input.plan.generatorVersion,
        modelVersion: "deterministic-fake-v1",
        sourceRanges: [],
        fromChapter: chapterNumber,
        toChapter: chapterNumber,
        generatedAt: input.now,
        invalidatedAt: input.now,
        invalidationReason: "容量夹具初始化为可重建派生数据",
        createdAt: input.now,
        updatedAt: input.now,
      });
    }
    await tx.insert(summaryRecords).values(rows);
  }
  await tx.insert(summaryRecords).values(
    Array.from({ length: input.plan.topology.volumeCount }, (_, index) => {
      const volumeNumber = index + 1;
      const content = `第${volumeNumber}卷容量摘要`;
      return {
        id: deterministicUuid(input.plan.seed, `summary:volume:${volumeNumber}`),
        workId: input.ids.workId,
        branchId: input.ids.mainBranchId,
        userId: input.ids.userId,
        level: "volume" as const,
        scopeId: input.outline.volumeIds[index]!,
        title: `第${volumeNumber}卷摘要`,
        content,
        status: "fresh" as const,
        version: 1,
        contentHash: sha256(content),
        inputHash: sha256(`volume-input:${volumeNumber}`),
        compilerVersion: input.plan.generatorVersion,
        modelVersion: "deterministic-fake-v1",
        sourceRanges: [],
        fromChapter: index * input.plan.topology.chaptersPerVolume + 1,
        toChapter: (index + 1) * input.plan.topology.chaptersPerVolume,
        generatedAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      };
    }),
  );
  const bookContent = "全书容量摘要";
  await tx.insert(summaryRecords).values({
    id: deterministicUuid(input.plan.seed, "summary:book"),
    workId: input.ids.workId,
    branchId: input.ids.mainBranchId,
    userId: input.ids.userId,
    level: "book",
    scopeId: input.ids.workId,
    title: "全书摘要",
    content: bookContent,
    status: "fresh",
    version: 1,
    contentHash: sha256(bookContent),
    inputHash: sha256("book-input"),
    compilerVersion: input.plan.generatorVersion,
    modelVersion: "deterministic-fake-v1",
    sourceRanges: [],
    fromChapter: 1,
    toChapter: input.plan.topology.chapterCount,
    generatedAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

async function insertSearchDocuments(
  tx: TenantTransaction,
  input: {
    plan: BenchmarkPlan;
    ids: ReturnType<typeof createBenchmarkFixtureIds>;
    chapterIds: string[];
    chapterNodeIds: string[];
    entityIds: string[];
    entityNodeIds: string[];
    now: Date;
  },
) {
  for (let offset = 0; offset < input.chapterIds.length; offset += 100) {
    const end = Math.min(input.chapterIds.length, offset + 100);
    const rows = [];
    for (let index = offset; index < end; index += 1) {
      const chapterNumber = index + 1;
      rows.push({
        workId: input.ids.workId,
        branchId: input.ids.mainBranchId,
        userId: input.ids.userId,
        sourceType: "chapter" as const,
        sourceId: input.chapterIds[index]!,
        title: `第${chapterNumber}章 容量锚点`,
        content: benchmarkChapterContent(input.plan, chapterNumber),
        aliases: [`锚点${chapterNumber}`],
        versionNodeId: input.chapterNodeIds[index]!,
        objectVersion: 1,
        sourceChapterId: input.chapterIds[index]!,
        fromChapter: chapterNumber,
        toChapter: chapterNumber,
        metadata: { benchmark: true, searchAnchor: `章节锚点${chapterNumber}` },
        createdAt: input.now,
        updatedAt: input.now,
      });
    }
    await tx.insert(searchDocuments).values(rows);
  }
}

async function insertOperationalRecords(
  tx: TenantTransaction,
  input: {
    plan: BenchmarkPlan;
    ids: ReturnType<typeof createBenchmarkFixtureIds>;
    chapterIds: string[];
    outline: Awaited<ReturnType<typeof insertOutline>>;
    now: Date;
  },
) {
  const planCount = 4;
  const childCount = 4;
  const planIds: string[] = [];
  let jobWorkItemCount = 0;
  for (let planIndex = 1; planIndex <= planCount; planIndex += 1) {
    const planId = deterministicUuid(input.plan.seed, `job:batch:${planIndex}`);
    planIds.push(planId);
    await tx.insert(jobs).values({
      id: planId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      type: "batch_plan",
      jobType: "book",
      workItemKey: "book",
      status: planIndex === planCount ? "paused" : "running",
      progress: planIndex * 10,
      currentStep: "execute",
      idempotencyKey: `benchmark-batch-${planIndex}`,
      budget: { maxCostCny: 100, maxTokens: 10_000_000 },
      checkpoint: { benchmark: true },
      cost: { reservedCny: 10, settledCny: 5 },
      createdAt: input.now,
      updatedAt: input.now,
      startedAt: input.now,
    });
    const bookItemId = deterministicUuid(input.plan.seed, `job-item:${planIndex}:book`);
    await tx.insert(jobWorkItems).values({
      id: bookItemId,
      jobId: planId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      itemType: "book",
      workItemKey: "book",
      idempotencyKey: `item-${planIndex}-book`,
      status: "running",
      priority: 100,
      sortOrder: 0,
      inputVersion: { outlineVersion: 1, chapterVersion: null },
      dependencies: [],
      outputRefs: [],
      cost: {},
      checkpoint: {},
      createdAt: input.now,
      updatedAt: input.now,
    });
    jobWorkItemCount += 1;
    const volumeItemIds: string[] = [];
    for (let volumeNumber = 1; volumeNumber <= input.plan.topology.volumeCount; volumeNumber += 1) {
      volumeItemIds.push(
        deterministicUuid(input.plan.seed, `job-item:${planIndex}:volume:${volumeNumber}`),
      );
    }
    for (let offset = 0; offset < volumeItemIds.length; offset += 100) {
      const end = Math.min(volumeItemIds.length, offset + 100);
      const rows = [];
      for (let index = offset; index < end; index += 1) {
        rows.push({
          id: volumeItemIds[index]!,
          jobId: planId,
          workId: input.ids.workId,
          branchId: input.ids.mainBranchId,
          userId: input.ids.userId,
          parentId: bookItemId,
          itemType: "volume" as const,
          workItemKey: `volume:${index + 1}`,
          idempotencyKey: `item-${planIndex}-volume-${index + 1}`,
          status: "pending" as const,
          priority: 50,
          sortOrder: index + 1,
          inputVersion: { outlineVersion: 1, chapterVersion: null },
          dependencies: ["book"],
          outputRefs: [],
          cost: {},
          checkpoint: {},
          createdAt: input.now,
          updatedAt: input.now,
        });
      }
      await tx.insert(jobWorkItems).values(rows);
      jobWorkItemCount += rows.length;
    }
    const chapterItemCount = Math.min(100, input.chapterIds.length);
    const chapterRows = Array.from({ length: chapterItemCount }, (_, index) => {
      const chapterNumber = index + 1;
      const volumeIndex = Math.min(
        volumeItemIds.length - 1,
        Math.floor((chapterNumber - 1) / input.plan.topology.chaptersPerVolume),
      );
      return {
        id: deterministicUuid(input.plan.seed, `job-item:${planIndex}:chapter:${chapterNumber}`),
        jobId: planId,
        workId: input.ids.workId,
        branchId: input.ids.mainBranchId,
        userId: input.ids.userId,
        parentId: volumeItemIds[volumeIndex]!,
        itemType: "chapter" as const,
        workItemKey: `chapter:${chapterNumber}`,
        idempotencyKey: `item-${planIndex}-chapter-${chapterNumber}`,
        chapterId: input.chapterIds[index]!,
        outlineNodeId: input.outline.chapterOutlineIds[index]!,
        status: "pending" as const,
        priority: 20,
        sortOrder: chapterNumber,
        inputVersion: { outlineVersion: 1, chapterVersion: 1 },
        dependencies: [`volume:${volumeIndex + 1}`],
        outputRefs: [],
        cost: {},
        checkpoint: {},
        createdAt: input.now,
        updatedAt: input.now,
      };
    });
    await tx.insert(jobWorkItems).values(chapterRows);
    jobWorkItemCount += chapterRows.length;
  }

  const childJobIds: string[] = [];
  for (let childIndex = 1; childIndex <= childCount; childIndex += 1) {
    const childJobId = deterministicUuid(input.plan.seed, `job:child:${childIndex}`);
    childJobIds.push(childJobId);
    const chapterId = input.chapterIds[childIndex - 1]!;
    await tx.insert(jobs).values({
      id: childJobId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      chapterId,
      modelConfigId: input.ids.modelConfigId,
      parentJobId: planIds[childIndex - 1] ?? planIds[0]!,
      jobType: "chapter",
      workItemKey: `chapter:${childIndex}`,
      type: "generate_chapter",
      status: "completed",
      progress: 100,
      currentStep: "completed",
      idempotencyKey: `benchmark-child-${childIndex}`,
      budget: { maxCostCny: 2.5, maxTokens: 30_000 },
      checkpoint: { revision: 7, step: "completed" },
      checkpointVersion: 7,
      cost: { settledCny: 0.01 },
      createdAt: input.now,
      updatedAt: input.now,
      startedAt: input.now,
      finishedAt: input.now,
    });
    const stepKeys = [
      "prepare",
      "compile_context",
      "draft",
      "verify",
      "revise",
      "extract_facts",
      "await_review",
    ];
    await tx.insert(jobSteps).values(
      stepKeys.map((stepKey) => ({
        id: deterministicUuid(input.plan.seed, `job-step:${childIndex}:${stepKey}`),
        jobId: childJobId,
        workId: input.ids.workId,
        branchId: input.ids.mainBranchId,
        userId: input.ids.userId,
        stepKey,
        status: "succeeded" as const,
        attempt: 1,
        inputHash: sha256(`input:${childIndex}:${stepKey}`),
        output: { benchmark: true },
        outputRefs: [],
        cost: { cny: 0.001 },
        startedAt: input.now,
        finishedAt: input.now,
        createdAt: input.now,
      })),
    );
    await tx.insert(jobStepAttempts).values(
      stepKeys.map((stepKey, index) => ({
        id: deterministicUuid(input.plan.seed, `job-attempt:${childIndex}:${stepKey}`),
        jobId: childJobId,
        workId: input.ids.workId,
        branchId: input.ids.mainBranchId,
        userId: input.ids.userId,
        stepKey,
        attempt: 1,
        status: "succeeded" as const,
        inputHash: sha256(`input:${childIndex}:${stepKey}`),
        outputRefs: [],
        checkpointRevision: index + 1,
        startedAt: input.now,
        finishedAt: input.now,
        createdAt: input.now,
      })),
    );
    await tx.insert(jobCheckpoints).values({
      id: deterministicUuid(input.plan.seed, `job-checkpoint:${childIndex}`),
      jobId: childJobId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      stepKey: "await_review",
      schemaVersion: 1,
      revision: 7,
      attempt: 1,
      inputHash: sha256(`checkpoint:${childIndex}`),
      outputRefs: [],
      payload: { benchmark: true },
      createdAt: input.now,
    });
    await tx.insert(jobEvents).values(
      ["job.created", "job.preparing", "job.progress", "job.waiting_review", "job.completed"].map(
        (eventType, index) => ({
          id: deterministicUuid(input.plan.seed, `job-event:${childIndex}:${index + 1}`),
          jobId: childJobId,
          workId: input.ids.workId,
          branchId: input.ids.mainBranchId,
          userId: input.ids.userId,
          sequence: index + 1,
          eventType,
          payload: { progress: index * 25, benchmark: true },
          occurredAt: input.now,
        }),
      ),
    );
    const contextPackId = deterministicUuid(input.plan.seed, `context-pack:${childIndex}`);
    const promptVersionId = deterministicUuid(input.plan.seed, `prompt-version:${childIndex}`);
    const agentRunId = deterministicUuid(input.plan.seed, `agent-run:${childIndex}`);
    const costReservationId = deterministicUuid(input.plan.seed, `cost-reservation:${childIndex}`);
    await tx.insert(contextPackVersions).values({
      id: contextPackId,
      jobId: childJobId,
      chapterId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      version: 1,
      compilerVersion: input.plan.generatorVersion,
      tokenBudget: 30_000,
      tokenUsed: 12_000,
      selected: [{ priority: "P0", count: 1 }],
      evicted: [],
      sourceRefs: [{ type: "chapter", id: chapterId }],
      snapshot: { benchmark: true },
      createdAt: input.now,
    });
    await tx.insert(promptVersions).values({
      id: promptVersionId,
      jobId: childJobId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      stepKey: "draft",
      key: "benchmark.writer",
      version: 1,
      role: "writer",
      promptHash: sha256(`prompt:${childIndex}`),
      systemHash: sha256("benchmark-system"),
      inputHash: sha256(`prompt-input:${childIndex}`),
      contextPackId,
      compilerVersion: input.plan.generatorVersion,
      createdBy: input.ids.userId,
      createdAt: input.now,
    });
    await tx.insert(agentRuns).values({
      id: agentRunId,
      jobId: childJobId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      chapterId,
      promptVersionId,
      modelConfigId: input.ids.modelConfigId,
      stepKey: "draft",
      role: "writer",
      status: "succeeded",
      provider: "deepseek",
      model: "deepseek-chat",
      inputHash: sha256(`agent-input:${childIndex}`),
      outputHash: sha256(`agent-output:${childIndex}`),
      output: "",
      inputSummary: { benchmark: true, characterCount: 12_000 },
      outputSummary: { benchmark: true, characterCount: 3_000 },
      citations: [],
      usage: { inputTokens: 12_000, outputTokens: 3_000, costCny: 0.01 },
      startedAt: input.now,
      finishedAt: input.now,
    });
    await tx.insert(costReservations).values({
      id: costReservationId,
      userId: input.ids.userId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      jobId: childJobId,
      agentRunId,
      idempotencyKey: `benchmark-cost-${childIndex}`,
      status: "settled",
      reservedTokens: 30_000,
      reservedCostCny: 0.02,
      settledTokens: 15_000,
      settledCostCny: 0.01,
      createdAt: input.now,
      settledAt: input.now,
    });
    await tx.insert(modelCalls).values({
      id: deterministicUuid(input.plan.seed, `model-call:${childIndex}`),
      userId: input.ids.userId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      chapterId,
      jobId: childJobId,
      agentRunId,
      promptVersionId,
      costReservationId,
      stepKey: "draft",
      attempt: 1,
      status: "succeeded",
      provider: "deepseek",
      model: "deepseek-chat",
      parameters: { temperature: 0.7 },
      configHash: sha256("benchmark-model-config"),
      inputHash: sha256(`model-input:${childIndex}`),
      outputHash: sha256(`model-output:${childIndex}`),
      inputSummary: { benchmark: true },
      outputSummary: { benchmark: true },
      inputTokens: 12_000,
      outputTokens: 3_000,
      costCny: 0.01,
      startedAt: input.now,
      finishedAt: input.now,
      createdAt: input.now,
    });
    await tx.insert(usageRecords).values({
      id: deterministicUuid(input.plan.seed, `usage:${childIndex}`),
      userId: input.ids.userId,
      workId: input.ids.workId,
      jobId: childJobId,
      stepKey: "draft",
      model: "deepseek-chat",
      promptTokens: 12_000,
      completionTokens: 3_000,
      costCny: 0.01,
      createdAt: input.now,
    });
  }
  return { jobCount: planCount + childCount, jobWorkItems: jobWorkItemCount, childJobIds };
}

async function insertExports(
  tx: TenantTransaction,
  input: {
    plan: BenchmarkPlan;
    ids: ReturnType<typeof createBenchmarkFixtureIds>;
    now: Date;
  },
) {
  for (let exportIndex = 1; exportIndex <= 4; exportIndex += 1) {
    const jobId = deterministicUuid(input.plan.seed, `job:export:${exportIndex}`);
    await tx.insert(jobs).values({
      id: jobId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      userId: input.ids.userId,
      type: "export_work",
      jobType: "book",
      workItemKey: "book",
      status: "queued",
      progress: 0,
      currentStep: "prepare",
      idempotencyKey: `benchmark-export-${exportIndex}`,
      budget: { maxCostCny: 0, maxTokens: 0 },
      checkpoint: { benchmark: true },
      cost: { settledCny: 0 },
      createdAt: input.now,
      updatedAt: input.now,
    });
    await tx.insert(workExportReceipts).values({
      id: deterministicUuid(input.plan.seed, `export-receipt:${exportIndex}`),
      jobId,
      userId: input.ids.userId,
      workId: input.ids.workId,
      branchId: input.ids.mainBranchId,
      idempotencyKey: `benchmark-export-receipt-${exportIndex}`,
      format: exportIndex % 2 === 0 ? ("markdown" as const) : ("txt" as const),
      status: "queued",
      request: {
        format: exportIndex % 2 === 0 ? ("markdown" as const) : ("txt" as const),
        scope: { kind: "book" },
        sourceVersionNodeId: null,
        options: {
          includeStoryBible: true,
          includeSettingsAppendix: false,
          includeOutline: false,
          includeForeshadowLedger: false,
          includeChangeHistory: false,
          preset: "generic",
          chapterTitleFormat: "第{number}章 {title}",
          volumeTitleFormat: "第{number}卷 {title}",
          paragraphBlankLine: true,
          firstLineIndent: false,
          encoding: "utf-8",
        },
      },
      createdAt: input.now,
      updatedAt: input.now,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });
  }
}

async function latestMigrationVersion(
  pool: ReturnType<typeof createDatabasePool>,
): Promise<string> {
  const result = await pool.query<{ id: number; hash: string; created_at: string }>(
    `SELECT id, hash, created_at
     FROM drizzle.__drizzle_migrations
     ORDER BY created_at DESC
     LIMIT 1`,
  );
  const migration = result.rows[0];
  return migration ? `${migration.id}:${migration.hash.slice(0, 12)}` : "unavailable";
}

async function collectRowCounts(
  pool: ReturnType<typeof createDatabasePool>,
): Promise<Record<string, number>> {
  const tables = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  const counts: Record<string, number> = {};
  for (const table of tables.rows) {
    const identifier = `"${table.table_name.replaceAll('"', '""')}"`;
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${identifier}`,
    );
    counts[table.table_name] = Number(result.rows[0]?.count ?? "0");
  }
  return counts;
}

async function collectVersionNodeTypes(
  pool: ReturnType<typeof createDatabasePool>,
  workId: string,
): Promise<Record<string, number>> {
  const result = await pool.query<{ node_type: string; count: string }>(
    `SELECT node_type, count(*)::text AS count
     FROM version_nodes
     WHERE work_id = $1
     GROUP BY node_type
     ORDER BY node_type`,
    [workId],
  );
  return Object.fromEntries(result.rows.map((row) => [row.node_type, Number(row.count)]));
}

function chapterIds(plan: BenchmarkPlan): string[] {
  return Array.from({ length: plan.topology.chapterCount }, (_, index) =>
    deterministicUuid(plan.seed, `chapter:${index + 1}`),
  );
}

function chapterVersionIds(plan: BenchmarkPlan): string[] {
  return Array.from({ length: plan.topology.chapterCount }, (_, index) =>
    deterministicUuid(plan.seed, `chapter-version:${index + 1}`),
  );
}

function chapterNodeIds(plan: BenchmarkPlan): string[] {
  return Array.from({ length: plan.topology.chapterCount }, (_, index) =>
    deterministicUuid(plan.seed, `version:chapter:${index + 1}`),
  );
}

function entityType(index: number) {
  const types = [
    "character",
    "faction",
    "map",
    "power_system",
    "golden_finger",
    "item",
    "timeline_event",
    "world_rule",
  ] as const;
  return types[(index - 1) % types.length]!;
}

function entityName(type: ReturnType<typeof entityType>, index: number): string {
  return `${type}-${index}`;
}

function entityAttributes(type: ReturnType<typeof entityType>, index: number) {
  switch (type) {
    case "character":
      return {
        bodyState: `身体状态${index}`,
        knowledgeBoundary: `知识边界${index}`,
        relationshipSummary: `关系摘要${index}`,
      };
    case "golden_finger":
      return {
        rules: `规则${index}`,
        cost: `代价${index}`,
        limits: `限制${index}`,
        growth: `成长${index}`,
      };
    case "item":
      return {
        category: "法器",
        grade: "基准",
        effect: `效果${index}`,
        cost: `代价${index}`,
        ownership: `角色${index}`,
        limits: `限制${index}`,
      };
    case "timeline_event":
      return {
        era: "基准纪元",
        storyTime: `第${index}日`,
        storySortKey: index,
        duration: "一个时辰",
        event: `时间线事件${index}`,
      };
    case "world_rule":
      return { rule: `世界规则${index}` };
    case "faction":
    case "map":
    case "power_system":
      return { details: `${type}细节${index}` };
  }
}

function storyBibleCards(seed: number) {
  const keys = [
    "oneSentence",
    "sellingPoints",
    "protagonist",
    "goldenFinger",
    "worldLaws",
    "mainPlot",
    "subplots",
    "ending",
    "readerPromise",
  ] as const;
  return keys.map((key) => ({
    key,
    title: key,
    content: `容量基准${key}-${seed}`,
    complete: true,
  }));
}

function branchCountFromPlan(plan: BenchmarkPlan): number {
  return (plan.branchCount ?? 0) + 1;
}

function syntheticProviderKey(): string {
  try {
    return encryptApiKey("sk-capacity-benchmark-synthetic-key");
  } catch {
    return "capacity-benchmark-synthetic-encrypted-key";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveSourceCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

async function seedCapacityObjects(plan: BenchmarkPlan): Promise<{
  count: number;
  bytes: number;
  checksums: string[];
}> {
  try {
    const storage = createObjectStorageFromEnvironment();
    const checksums: string[] = [];
    let bytes = 0;
    for (let index = 1; index <= 6; index += 1) {
      const prefix = `capacity-benchmark:${plan.seed}:${index}\n`;
      const content = Buffer.from(prefix.repeat(Math.ceil((32 * 1024) / prefix.length))).subarray(
        0,
        32 * 1024,
      );
      const key = `capacity/${plan.seed}/object-${index}.txt`;
      await storage.putObject({
        key,
        bytes: content,
        contentType: "text/plain; charset=utf-8",
      });
      checksums.push(sha256(content.toString("utf8")));
      bytes += content.byteLength;
    }
    return { count: checksums.length, bytes, checksums };
  } catch (error) {
    throw new Error(
      `CAPACITY_OBJECT_STORAGE_REQUIRED: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function benchmarkDatabaseForRun(databaseUrl: string): string {
  return benchmarkDatabaseName(databaseUrl);
}
