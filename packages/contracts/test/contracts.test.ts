import { describe, expect, it } from "vitest";

import {
  authorPenNameCreateRequestSchema,
  authorPenNameUpdateRequestSchema,
  authDeviceSessionsResponseSchema,
  authPasswordSchema,
  authSessionResponseSchema,
  canonCommitRequestSchema,
  canonCommitSchema,
  characterChangeRequestCreateRequestSchema,
  characterItineraryCreateRequestSchema,
  characterKnowledgeProjectionQuerySchema,
  characterKnowledgeStateCreateRequestSchema,
  characterProfileUpdateRequestSchema,
  characterRelationshipCreateRequestSchema,
  characterStateTransitionCreateRequestSchema,
  chapterBriefSchema,
  chapterReadinessSchema,
  chapterReviewRequestSchema,
  chapterVersionCreateRequestSchema,
  chapterWorkspaceSchema,
  confirmedSettingSchema,
  contextPackManifestSchema,
  contextPackVersionSchema,
  csrfResponseSchema,
  customFieldDefinitionCreateRequestSchema,
  customFieldDefinitionListQuerySchema,
  customFieldDefinitionListResponseSchema,
  domainRefSchema,
  factProposalDecisionRequestSchema,
  factProposalSchema,
  factionCreateRequestSchema,
  factionRelationshipCreateRequestSchema,
  generateChapterRequestSchema,
  generationJobSchema,
  generationReadinessQuerySchema,
  generationReadinessSchema,
  GENERATE_CHAPTER_JOB,
  generateChapterJobSchema,
  jobEventSchema,
  importReportSchema,
  loginRequestSchema,
  mapEdgeCreateRequestSchema,
  mapLayerCreateRequestSchema,
  mapMarkerCreateRequestSchema,
  mapNodeCreateRequestSchema,
  manuscriptImportConfirmRequestSchema,
  manuscriptImportResponseSchema,
  modelConfigInputSchema,
  modelConfigSchema,
  modelConfigDeleteResponseSchema,
  modelConfigUpdateSchema,
  modelConnectionTestResponseSchema,
  modelProvidersResponseSchema,
  profileUpdateRequestSchema,
  readinessResponseSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  retrievalQuerySchema,
  retrievalResultSchema,
  sendRegistrationCodeRequestSchema,
  sendRegistrationCodeResponseSchema,
  settingsImportConfirmRequestSchema,
  settingsImportConflictDecisionRequestSchema,
  settingChangeRequestCreateRequestSchema,
  settingChangeRequestListQuerySchema,
  settingChangeRequestListResponseSchema,
  settingEntityCreateRequestSchema,
  settingEntityListQuerySchema,
  settingEntityListResponseSchema,
  settingEntityPatchRequestSchema,
  settingEntityRestoreRequestSchema,
  settingEntitySchema,
  settingEntityVersionListQuerySchema,
  settingEntityVersionListResponseSchema,
  settingProposalCreateRequestSchema,
  settingProposalListQuerySchema,
  settingProposalListResponseSchema,
  outlineNodeCreateRequestSchema,
  outlineNodeSchema,
  outlineReadinessSchema,
  outlineReplanResultSchema,
  outlineSceneCardWriteRequestSchema,
  sceneCardSchema,
  timelineEraCreateRequestSchema,
  timelineEventCreateRequestSchema,
  territoryCreateRequestSchema,
  volumeContractSchema,
  logoutResponseSchema,
  STORY_BIBLE_CARD_KEYS,
  STORY_BIBLE_CARD_TITLES,
  storyBibleChangeRequestCreateRequestSchema,
  storyBibleChangeRequestSchema,
  storyBiblePatchRequestSchema,
  storyBibleReadinessSchema,
  storyBibleSchema,
  storyBibleUnlockRequestSchema,
  storyBibleVersionSchema,
  storyBibleWorldRuleSchema,
  storyTimePointSchema,
  validityIntervalSchema,
  versionRefSchema,
  workBranchSchema,
  workCreateRequestSchema,
  workSchema,
  workSourceModeSchema,
  worldSnapshotQuerySchema,
} from "../src";

describe("shared contracts", () => {
  it("accepts typed fact proposals with source evidence and decisions", () => {
    const proposal = factProposalSchema.parse({
      id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c21",
      workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c22",
      branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c23",
      chapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c24",
      sourceVersionId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c25",
      subject: "沈砚",
      predicate: "身体状态",
      object: "左臂骨折，不能双手结印",
      sourceSentence: "沈砚把断臂藏进衣袍，只用右手结印。",
      status: "confirmed",
      confidence: 0.92,
      risk: "high",
      required: true,
      decision: {
        id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c26",
        action: "confirm",
        actorId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c27",
        actorName: "写作台作者",
        reason: "与正文一致",
        decidedAt: "2026-11-05T08:00:00.000Z",
      },
      createdAt: "2026-11-05T07:59:00.000Z",
      updatedAt: "2026-11-05T08:00:00.000Z",
    });

    expect(proposal.status).toBe("confirmed");
    expect(proposal.risk).toBe("high");
    expect(proposal.sourceSentence).toContain("断臂");
    expect(factProposalDecisionRequestSchema.parse({ action: "reject" })).toEqual({
      action: "reject",
    });
    expect(() =>
      factProposalDecisionRequestSchema.parse({
        action: "modify_confirm",
      }),
    ).toThrow("Modified confirmation requires at least one edited field");
    expect(() =>
      factProposalDecisionRequestSchema.parse({
        action: "confirm",
        modified: { object: "不能借确认动作偷偷修改事实" },
      }),
    ).toThrow("Edited fields are only allowed for modified confirmation");
  });

  it("validates chapter review, canon submission and submitted fact contracts", () => {
    expect(chapterReviewRequestSchema.parse({ action: "approve", version: 2 })).toEqual({
      action: "approve",
      version: 2,
    });
    expect(
      canonCommitRequestSchema.parse({
        chapterVersionId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c25",
      }),
    ).toEqual({ chapterVersionId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c25" });

    const commit = canonCommitSchema.parse({
      id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c31",
      workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c32",
      branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c33",
      chapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c34",
      chapterVersionId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c35",
      versionNodeId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c36",
      sourceChapter: {
        id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c34",
        number: 1,
        title: "一只手也能结印",
      },
      decisions: [
        {
          proposalId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c37",
          decisionId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c38",
          action: "confirm",
          resultingStatus: "confirmed",
          subject: "沈砚",
          predicate: "身体状态",
          object: "左臂骨折",
          risk: "high",
          required: true,
          sourceSentence: "沈砚把断臂藏进衣袍。",
          actorName: "写作台作者",
          reason: "与正文一致",
          decidedAt: "2026-11-05T08:00:00.000Z",
        },
      ],
      facts: [
        {
          id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c39",
          proposalId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c37",
          decisionId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c38",
          sourceChapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c34",
          validFromChapter: 1,
          validToChapter: null,
          subject: "沈砚",
          predicate: "身体状态",
          object: "左臂骨折",
          risk: "high",
          required: true,
          status: "confirmed",
        },
      ],
      summary: {
        factCount: 1,
        rejectedCount: 0,
        text: "第 1 章「一只手也能结印」：提交 1 条事实。",
      },
      createdAt: "2026-11-05T08:00:00.000Z",
    });
    expect(commit.summary.factCount).toBe(1);
    expect(
      confirmedSettingSchema.parse({
        kind: "fact",
        id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c39",
        type: "character",
        name: "沈砚",
        summary: "身体状态：左臂骨折",
        source: "canon",
        status: "locked",
        version: 1,
        lockedAt: "2026-11-05T08:00:00.000Z",
        sourceChapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c34",
        sourceFactId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c39",
        validFromChapter: 1,
        validToChapter: null,
        predicate: "身体状态",
        object: "左臂骨折",
      }),
    ).toMatchObject({ kind: "fact", source: "canon" });
  });

  it("accepts the readiness envelope shared by Web and API", () => {
    const response = readinessResponseSchema.parse({
      data: {
        status: "ready",
        service: "api",
        timestamp: "2026-11-04T08:00:00.000Z",
        checks: [
          { name: "database", status: "up", latencyMs: 4 },
          { name: "queue", status: "up", latencyMs: 2 },
        ],
      },
      requestId: "req_contract",
      meta: {},
    });

    expect(response.data.status).toBe("ready");
  });

  it("validates faction, map graph and story timeline contracts", () => {
    const branchId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c40";
    const otherId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c41";
    const faction = factionCreateRequestSchema.parse({
      name: "太玄门",
      aliases: ["玄门"],
      summary: "执掌太玄山脉的仙门。",
      description: "",
      tags: ["仙门"],
      profile: {
        overview: "以剑阵护山的正道宗门。",
        goals: "守住天门，追查忘川书。",
        resources: "太玄剑阵、灵脉与内门弟子。",
        doctrine: "门人不得私入禁地。",
      },
    });
    expect(faction.profile.goals).toContain("天门");

    const relationship = factionRelationshipCreateRequestSchema.parse({
      target: {
        type: "faction",
        id: branchId,
        branchId,
        label: "血河宗",
      },
      relationType: "enemy",
      validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
      sourceChapterId: null,
    });
    expect(relationship.relationType).toBe("enemy");

    const layer = mapLayerCreateRequestSchema.parse({
      name: "北域",
      parentLayerId: null,
      sortOrder: 0,
      minScale: 0,
      maxScale: 100,
      validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
    });
    expect(layer.name).toBe("北域");

    const node = mapNodeCreateRequestSchema.parse({
      layerId: null,
      parentNodeId: null,
      name: "忘川村",
      nodeType: "settlement",
      summary: "山脚的小村。",
      x: 0.2,
      y: 0.7,
      validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
    });
    expect(node.nodeType).toBe("settlement");

    const edge = mapEdgeCreateRequestSchema.parse({
      layerId: null,
      fromNodeId: branchId,
      toNodeId: otherId,
      routeType: "road",
      bidirectional: true,
      travelMinutes: 90,
      validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
    });
    expect(() =>
      mapEdgeCreateRequestSchema.parse({
        ...edge,
        travelMinutes: 0,
      }),
    ).toThrow("Travel time must be positive");

    const marker = mapMarkerCreateRequestSchema.parse({
      layerId: null,
      nodeId: null,
      label: "古战场",
      markerType: "danger",
      x: 0.4,
      y: 0.6,
      validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
    });
    expect(marker.markerType).toBe("danger");

    const territory = territoryCreateRequestSchema.parse({
      node: { type: "map_node", id: branchId, branchId, label: "忘川村" },
      controlLevel: "direct",
      validity: { fromChapter: 1, toChapter: 9, fromStoryTime: null, toStoryTime: null },
      evidence: [
        {
          kind: "chapter",
          sourceId: null,
          label: "第 1 章",
          quote: "村口插着太玄门的青旗。",
          locator: "第 1 章 · 第 2 段",
          confidence: 0.9,
        },
      ],
    });
    expect(territory.controlLevel).toBe("direct");

    const era = timelineEraCreateRequestSchema.parse({
      name: "大玄历",
      orderIndex: 1,
      startSortKey: 0,
      endSortKey: null,
      description: "大玄王朝纪年。",
    });
    expect(era.orderIndex).toBe(1);

    const event = timelineEventCreateRequestSchema.parse({
      name: "忘川村灭门",
      aliases: [],
      summary: "沈砚父母被杀。",
      description: "",
      tags: [],
      era: "大玄历",
      storyTime: { era: "大玄历", label: "十六年前", sortKey: 100 },
      durationMinutes: 720,
      durationLabel: "一夜",
      event: "仇家屠村后伪装成自尽。",
      validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
    });
    expect(event.storyTime.sortKey).toBe(100);

    const itinerary = characterItineraryCreateRequestSchema.parse({
      character: { type: "character", id: branchId, branchId, label: "沈砚" },
      fromNode: { type: "map_node", id: branchId, branchId, label: "忘川村" },
      toNode: { type: "map_node", id: branchId, branchId, label: "太玄门" },
      departure: { era: "大玄历", label: "第一日辰时", sortKey: 1000 },
      arrival: { era: "大玄历", label: "第一日午时", sortKey: 1120 },
      travelMinutes: 120,
      validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
      sourceChapterId: null,
      evidence: [],
    });
    expect(itinerary.travelMinutes).toBe(120);
    expect(() =>
      characterItineraryCreateRequestSchema.parse({
        ...itinerary,
        arrival: { ...itinerary.departure },
      }),
    ).toThrow("Itinerary arrival must follow departure");

    expect(worldSnapshotQuerySchema.parse({})).toEqual({});
    expect(worldSnapshotQuerySchema.parse({ versionNodeId: branchId }).versionNodeId).toBe(
      branchId,
    );
  });

  it("accepts the typed worker job consumed by the worker", () => {
    const job = generateChapterJobSchema.parse({
      jobId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11",
      jobType: GENERATE_CHAPTER_JOB,
      workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c12",
      branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c13",
      chapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c14",
      actorId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c15",
      modelConfigId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c16",
      idempotencyKey: "generate-chapter-1",
      budget: {
        maxCostCny: 2.5,
        maxTokens: 30_000,
        maxRevisionRounds: 2,
      },
      checkpoint: {
        step: "prepare",
        payload: {},
      },
    });

    expect(job.jobType).toBe("generate_chapter");
  });

  it("accepts generation jobs, context packs and replayable job events", () => {
    const job = generationJobSchema.parse({
      id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11",
      type: GENERATE_CHAPTER_JOB,
      workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c12",
      branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c13",
      chapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c14",
      status: "queued",
      progress: 0,
      currentStep: "prepare",
      budget: { maxCostCny: 2.5, maxTokens: 30_000, maxRevisionRounds: 2 },
      cost: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCny: 0 },
      checkpoint: { step: "prepare", payload: {} },
      error: null,
      contextPack: null,
      createdAt: "2026-11-05T08:00:00.000Z",
      startedAt: null,
      finishedAt: null,
    });
    const contextPack = contextPackVersionSchema.parse({
      id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c15",
      jobId: job.id,
      version: 1,
      compilerVersion: "m0-context-v1",
      tokenBudget: 30_000,
      tokenUsed: 7,
      selected: [
        {
          key: "brief:required-facts",
          label: "本章必用事实",
          priority: "required",
          content: "左臂骨折",
          tokenCount: 2,
          sourceRefs: [
            {
              sourceType: "chapter_brief",
              sourceId: job.chapterId,
              label: "章纲",
              citation: "第 1 章 · 必用事实",
            },
          ],
        },
      ],
      evicted: [
        {
          key: "setting:style",
          label: "文风样本",
          reason: "token_budget",
          tokenCount: 12,
        },
      ],
      sourceRefs: [
        {
          sourceType: "chapter_brief",
          sourceId: job.chapterId,
          label: "章纲",
          citation: "第 1 章 · 必用事实",
        },
      ],
      createdAt: "2026-11-05T08:00:01.000Z",
    });
    const event = jobEventSchema.parse({
      eventId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c16",
      type: "job.step.succeeded",
      occurredAt: "2026-11-05T08:00:02.000Z",
      data: { step: "compile_context", progress: 30 },
    });

    expect(job.status).toBe("queued");
    expect(contextPack.selected[0]?.sourceRefs[0]?.citation).toContain("必用事实");
    expect(event.type).toBe("job.step.succeeded");
    expect(generateChapterRequestSchema.parse({})).toEqual({
      budget: { maxCostCny: 2.5, maxTokens: 30_000, maxRevisionRounds: 2 },
    });
  });

  it("accepts a P0-P4 context manifest with budget accounting and eviction reasons", () => {
    const manifest = contextPackManifestSchema.parse({
      compilerVersion: "m1-context-v1",
      manifestHash: "a".repeat(64),
      task: "chapter_draft",
      chapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c14",
      chapterNumber: 5,
      povCharacterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c20",
      branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c13",
      tokenBudget: 30_000,
      tokenUsed: 7,
      effectiveTokenBudget: 30_000,
      selected: [
        {
          key: "brief:required-facts",
          label: "本章必用事实",
          layer: "P0",
          priority: "P0",
          content: "左臂骨折",
          tokenCount: 2,
          sourceRefs: [
            {
              sourceType: "chapter_brief",
              sourceId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c14",
              label: "章纲",
              citation: "第 5 章 · 必用事实",
            },
          ],
          reason: "p0_hard_constraint",
        },
      ],
      evicted: [
        {
          key: "recent:chapter-4",
          label: "第 4 章",
          layer: "P2",
          reason: "future_fact",
          tokenCount: 12,
          sourceRefs: [],
        },
      ],
      sourceRefs: [
        {
          sourceType: "chapter_brief",
          sourceId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c14",
          label: "章纲",
          citation: "第 5 章 · 必用事实",
        },
      ],
      budget: {
        requestedTokenBudget: 30_000,
        effectiveTokenBudget: 30_000,
        modelContextWindowTokens: 64_000,
        reservedOutputTokens: 2_000,
        tokenUsed: 7,
        tokenRemaining: 29_993,
        tokenEstimator: "cjk_chars_per_2",
        layers: {
          P0: { selectedCount: 1, selectedTokens: 2, evictedCount: 0, evictedTokens: 0 },
          P1: { selectedCount: 0, selectedTokens: 0, evictedCount: 0, evictedTokens: 0 },
          P2: { selectedCount: 0, selectedTokens: 0, evictedCount: 1, evictedTokens: 12 },
          P3: { selectedCount: 0, selectedTokens: 0, evictedCount: 0, evictedTokens: 0 },
          P4: { selectedCount: 0, selectedTokens: 0, evictedCount: 0, evictedTokens: 0 },
        },
      },
    });

    expect(manifest.selected[0]).toMatchObject({ layer: "P0", priority: "P0" });
    expect(manifest.evicted[0]?.reason).toBe("future_fact");
    expect(manifest.budget.layers.P2.evictedCount).toBe(1);
  });

  it("rejects a job without an idempotency key", () => {
    expect(() =>
      generateChapterJobSchema.parse({
        jobId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11",
        jobType: GENERATE_CHAPTER_JOB,
      }),
    ).toThrow();
  });

  it("rejects UUID v4 business identifiers and unknown checkpoint steps", () => {
    const baseJob = {
      jobId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      jobType: GENERATE_CHAPTER_JOB,
      workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c12",
      branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c13",
      chapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c14",
      actorId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c15",
      modelConfigId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c16",
      idempotencyKey: "generate-chapter-1",
      budget: {
        maxCostCny: 2.5,
        maxTokens: 30_000,
        maxRevisionRounds: 2,
      },
      checkpoint: {
        step: "prepare",
        payload: {},
      },
    };

    expect(() => generateChapterJobSchema.parse(baseJob)).toThrow();
    expect(() =>
      generateChapterJobSchema.parse({
        ...baseJob,
        jobId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11",
        checkpoint: { step: "unknown", payload: {} },
      }),
    ).toThrow();
  });

  it("validates the M0 auth request and response contracts", () => {
    expect(sendRegistrationCodeRequestSchema.parse({ email: "Author@Example.com" }).email).toBe(
      "author@example.com",
    );
    expect(
      registerRequestSchema.parse({
        email: "author@example.com",
        code: "123456",
        password: "StrongPassword123",
        displayName: "林见鹿",
      }),
    ).toMatchObject({ email: "author@example.com", displayName: "林见鹿" });
    expect(
      loginRequestSchema.parse({ email: "author@example.com", password: "StrongPassword123" }),
    ).toBeTruthy();
    expect(() => authPasswordSchema.parse("short")).toThrow();

    expect(
      csrfResponseSchema.parse({
        data: { token: "csrf-token-with-enough-length" },
        requestId: "req_csrf",
        meta: {},
      }),
    ).toBeTruthy();
    expect(
      sendRegistrationCodeResponseSchema.parse({
        data: { sent: true, expiresAt: "2026-11-04T08:10:00.000Z" },
        requestId: "req_send_code",
        meta: {},
      }),
    ).toBeTruthy();
    expect(
      logoutResponseSchema.parse({
        data: { loggedOut: true },
        requestId: "req_logout",
        meta: {},
      }),
    ).toBeTruthy();
    expect(
      authSessionResponseSchema.parse({
        data: {
          user: {
            id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11",
            emailMasked: "au***@example.com",
            displayName: "林见鹿",
            createdAt: "2026-11-04T08:00:00.000Z",
          },
          session: {
            id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c12",
            expiresAt: "2026-11-11T08:00:00.000Z",
            current: true,
            userAgent: "vitest",
            createdAt: "2026-11-04T08:00:00.000Z",
          },
        },
        requestId: "req_session",
        meta: {},
      }),
    ).toBeTruthy();
  });

  it("validates account recovery, profile, pen name and device session contracts", () => {
    expect(
      resetPasswordRequestSchema.parse({
        token: "t".repeat(32),
        password: "StrongPassword123",
      }),
    ).toBeTruthy();
    expect(() =>
      resetPasswordRequestSchema.parse({ token: "short", password: "StrongPassword123" }),
    ).toThrow();

    expect(profileUpdateRequestSchema.parse({ version: 1, displayName: "青舟" })).toBeTruthy();
    expect(() => profileUpdateRequestSchema.parse({ version: 1 })).toThrow();
    expect(() =>
      profileUpdateRequestSchema.parse({
        version: 1,
        avatarUrl: "javascript:alert(1)",
      }),
    ).toThrow();
    expect(profileUpdateRequestSchema.parse({ version: 1, avatarUrl: null })).toBeTruthy();

    expect(authorPenNameCreateRequestSchema.parse({ name: "青舟" })).toMatchObject({
      bio: "",
      isDefault: false,
    });
    expect(() => authorPenNameUpdateRequestSchema.parse({ version: 1 })).toThrow();
    expect(
      authorPenNameUpdateRequestSchema.parse({ version: 2, name: "砚秋", isDefault: true }),
    ).toBeTruthy();

    expect(
      authDeviceSessionsResponseSchema.parse({
        data: [
          {
            id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c12",
            expiresAt: "2026-11-11T08:00:00.000Z",
            current: true,
            userAgent: "Chrome",
            ip: "203.0.113.10",
            lastSeenAt: "2026-11-04T08:00:00.000Z",
            createdAt: "2026-11-04T08:00:00.000Z",
          },
        ],
        requestId: "req_sessions",
        meta: { nextCursor: null },
      }),
    ).toBeTruthy();
  });

  it("validates model configuration request and response contracts", () => {
    expect(
      modelConfigInputSchema.parse({
        provider: "deepseek",
        label: "DeepSeek 正文",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-secret-value-1234",
        isDefault: true,
      }),
    ).toBeTruthy();
    expect(
      modelConfigSchema.parse({
        id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11",
        provider: "deepseek",
        label: "DeepSeek 正文",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        purposes: ["writing"],
        keyMasked: "****1234",
        isDefault: true,
        version: 1,
        lastTestStatus: "success",
        lastTestedAt: "2026-11-04T08:00:00.000Z",
        createdAt: "2026-11-04T08:00:00.000Z",
        updatedAt: "2026-11-04T08:00:00.000Z",
      }),
    ).toBeTruthy();
    expect(modelConfigUpdateSchema.parse({ version: 1, label: "新名称" })).toBeTruthy();
    expect(
      modelConfigInputSchema.parse({
        provider: "deepseek",
        label: "默认用途",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-test-1234",
      }).purposes,
    ).toEqual(["writing"]);
    expect(
      modelProvidersResponseSchema.parse({
        data: [
          {
            key: "deepseek",
            label: "DeepSeek 官方 API",
            defaultBaseUrl: "https://api.deepseek.com",
            baseUrls: ["https://api.deepseek.com"],
            models: ["deepseek-chat"],
          },
        ],
        requestId: "req_providers",
        meta: {},
      }),
    ).toBeTruthy();
    expect(
      modelConnectionTestResponseSchema.parse({
        data: { status: "success", latencyMs: 1, message: "连接正常" },
        requestId: "req_test",
        meta: {},
      }),
    ).toBeTruthy();
    expect(
      modelConfigDeleteResponseSchema.parse({
        data: { deleted: true },
        requestId: "req_delete",
        meta: {},
      }),
    ).toBeTruthy();
  });

  it("validates work creation and branch contracts", () => {
    expect(
      workCreateRequestSchema.parse({
        mode: "idea",
        title: "忘川书",
        idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
      }),
    ).toMatchObject({
      genre: "xianxia",
      scaleTarget: "long",
      chapterLengthTarget: 3000,
    });
    expect(
      workCreateRequestSchema.parse({
        mode: "template",
        templateKey: "xianxia",
        title: "仙途模板",
      }),
    ).toMatchObject({ mode: "template", templateKey: "xianxia" });
    expect(
      workSchema.parse({
        id: "01a1a6f9-9d9b-71e1-98ed-ae21fe958ef4",
        title: "忘川书",
        penName: "林见鹿",
        genre: "xianxia",
        status: "draft",
        scaleTarget: "long",
        chapterLengthTarget: 3000,
        sourceMode: "idea",
        idea: "一个被宗门抛弃的杂役。",
        templatePack: null,
        settings: {},
        createdAt: "2026-11-04T08:00:00.000Z",
        updatedAt: "2026-11-04T08:00:00.000Z",
      }),
    ).toBeTruthy();
    expect(
      workBranchSchema.parse({
        id: "01a1a6f9-9d9b-71e1-98ed-ae21fe958ef4",
        workId: "01a1a6f9-9d9b-71e1-98ed-ae21fe958ef4",
        name: "main",
        headNodeId: "01a1a6f9-9d9b-71e1-98ed-ae21fe958ef4",
        status: "active",
      }),
    ).toBeTruthy();
  });

  it("validates settings import candidates, conflict decisions and confirmation contracts", () => {
    const report = importReportSchema.parse({
      accepted: [
        {
          id: "01a1a6f9-9d9b-71e1-98ed-ae21fe958ef4",
          type: "character",
          name: "沈砚",
          summary: "外门杂役",
          sourceExcerpt: "人物：沈砚，外门杂役。",
          confidence: 0.94,
          status: "accepted",
        },
      ],
      pending: [],
      conflicts: [],
      unparsed: [
        {
          sourceExcerpt: "无法归类的旧笔记",
          reason: "无法识别为人物、势力、地图、力量体系或金手指",
        },
      ],
    });

    expect(report.accepted[0]?.type).toBe("character");
    expect(settingsImportConflictDecisionRequestSchema.parse({ decision: "use_primary" })).toEqual({
      decision: "use_primary",
    });
    expect(settingsImportConfirmRequestSchema.parse({ title: "设定导入作品" })).toMatchObject({
      genre: "xianxia",
      scaleTarget: "long",
      chapterLengthTarget: 3000,
    });
    expect(workSourceModeSchema.parse("settings_import")).toBe("settings_import");
    expect(() =>
      workCreateRequestSchema.parse({
        mode: "settings_import",
        title: "不应直接创建",
      }),
    ).toThrow();
  });

  it("validates manuscript preview, edited chapter confirmation and work source contracts", () => {
    expect(
      manuscriptImportResponseSchema.parse({
        data: {
          id: "01a1a6f9-9d9b-71e1-98ed-ae21fe958ef4",
          status: "partial",
          sourceName: "old-draft.md",
          format: "markdown",
          chapters: [
            {
              order: 1,
              title: "第一章 断碑夜雨",
              content: "# 第一章 断碑夜雨\n\n雨落在断碑上。",
              wordCount: 11,
            },
          ],
          warnings: [
            {
              sourceExcerpt: "第一章",
              reason: "章节标题为空，已使用章节序号作为标题并保留原文",
            },
          ],
          canConfirm: true,
          confirmedWorkId: null,
          createdAt: "2026-11-04T08:00:00.000Z",
        },
        requestId: "req_manuscript",
        meta: {},
      }),
    ).toMatchObject({ data: { status: "partial", canConfirm: true } });
    expect(
      manuscriptImportConfirmRequestSchema.parse({
        title: "旧稿新书",
        chapters: [
          {
            title: "第一章 断碑夜雨",
            content: "# 第一章 断碑夜雨\n\n雨落在断碑上。",
          },
        ],
      }),
    ).toMatchObject({
      genre: "xianxia",
      scaleTarget: "long",
      chapterLengthTarget: 3000,
    });
    expect(workSourceModeSchema.parse("manuscript_import")).toBe("manuscript_import");
    expect(() =>
      manuscriptImportConfirmRequestSchema.parse({ title: "空章节", chapters: [] }),
    ).toThrow();
  });

  it("freezes the nine story bible cards and rejects duplicate or unknown card keys", () => {
    expect(STORY_BIBLE_CARD_KEYS).toEqual([
      "oneSentence",
      "sellingPoints",
      "protagonist",
      "goldenFinger",
      "worldLaws",
      "mainPlot",
      "subplots",
      "ending",
      "readerPromise",
    ]);
    expect(STORY_BIBLE_CARD_KEYS.map((key) => STORY_BIBLE_CARD_TITLES[key])).toEqual([
      "一句话故事",
      "核心卖点",
      "主角",
      "金手指",
      "世界铁律",
      "主线",
      "支线",
      "结局方向",
      "读者承诺",
    ]);
    expect(() =>
      storyBiblePatchRequestSchema.parse({
        version: 1,
        cards: [
          { key: "oneSentence", content: "第一份内容" },
          { key: "oneSentence", content: "重复内容" },
        ],
      }),
    ).toThrow();
    expect(() =>
      storyBiblePatchRequestSchema.parse({
        version: 1,
        cards: [{ key: "unknownCard", content: "未知卡片" }],
      }),
    ).toThrow();
  });

  it("requires structured world rules and edit reasons for story bible versions", () => {
    const worldRule = storyBibleWorldRuleSchema.parse({
      id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c60",
      name: "境界差距",
      constraint: "境界差距不能靠情绪直接抹平，越阶必须付出寿元、资源或关系代价。",
      scope: "所有战斗与冲突",
      exceptions: ["主角在付出寿元代价时可以短暂抗衡一位境界。"],
    });

    expect(
      storyBiblePatchRequestSchema.parse({
        version: 2,
        reason: "按开篇战斗规则收紧越阶条件。",
        cards: [
          {
            key: "worldLaws",
            content: "境界差距：境界差距不能靠情绪直接抹平，越阶必须付出寿元、资源或关系代价。",
            worldRules: [worldRule],
          },
        ],
      }),
    ).toMatchObject({ reason: "按开篇战斗规则收紧越阶条件。" });

    expect(() =>
      storyBiblePatchRequestSchema.parse({
        version: 2,
        reason: "缺少结构化世界铁律。",
        cards: [{ key: "worldLaws", content: "只有自然语言。" }],
      }),
    ).toThrow("worldLaws card requires structured world rules");
    expect(() =>
      storyBiblePatchRequestSchema.parse({
        version: 2,
        reason: "",
        cards: [{ key: "oneSentence", content: "修改原因不能为空。" }],
      }),
    ).toThrow();
    expect(() =>
      storyBiblePatchRequestSchema.parse({
        version: 2,
        reason: "世界铁律不能挂到其他卡片。",
        cards: [{ key: "oneSentence", content: "一句话故事", worldRules: [worldRule] }],
      }),
    ).toThrow("worldRules are only allowed on worldLaws");
  });

  it("exposes readiness issues, immutable version history and locked change requests", () => {
    const worldRule = storyBibleWorldRuleSchema.parse({
      id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c71",
      name: "越阶代价",
      constraint: "越阶必须付出寿元或关系代价。",
      scope: "战斗",
      exceptions: [],
    });
    const readiness = storyBibleReadinessSchema.parse({
      status: "partial",
      completed: 8,
      total: 9,
      canLock: false,
      missingCards: [{ key: "worldLaws", title: "世界铁律" }],
      issues: [
        {
          code: "missing_world_rule",
          key: "worldLaws",
          title: "世界铁律",
          message: "世界铁律卡片需要至少一条结构化规则。",
        },
      ],
    });
    expect(readiness.issues).toHaveLength(1);

    const version = storyBibleVersionSchema.parse({
      id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c61",
      storyBibleId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c62",
      workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c63",
      branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c64",
      version: 3,
      action: "edited",
      actorId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c65",
      reason: "补齐主角动机。",
      cards: STORY_BIBLE_CARD_KEYS.map((key) => ({
        key,
        title: STORY_BIBLE_CARD_TITLES[key],
        content: "",
        complete: false,
        worldRules: [],
      })),
      createdAt: "2026-11-05T08:00:00.000Z",
    });
    expect(version).not.toHaveProperty("order");

    expect(
      storyBibleUnlockRequestSchema.parse({ version: 4, reason: "开篇前需要调整设定。" }),
    ).toEqual({
      version: 4,
      reason: "开篇前需要调整设定。",
    });

    const request = storyBibleChangeRequestCreateRequestSchema.parse({
      version: 4,
      cardKey: "worldLaws",
      title: "调整越阶代价",
      reason: "第 3 章战斗需要更清晰的代价。",
      after: {
        key: "worldLaws",
        title: "世界铁律",
        content: "越阶必须付出寿元或关系代价。",
        complete: true,
        worldRules: [worldRule],
      },
    });
    expect(
      storyBibleChangeRequestSchema.parse({
        ...request,
        id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c66",
        storyBibleId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c67",
        workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c68",
        branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c69",
        before: {
          key: "worldLaws",
          title: "世界铁律",
          content: "越阶必须有代价。",
          complete: true,
          worldRules: [],
        },
        status: "pending",
        risk: "medium",
        source: "author",
        createdBy: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c70",
        createdAt: "2026-11-05T08:00:00.000Z",
      }),
    ).toMatchObject({ status: "pending", risk: "medium" });
    expect(() =>
      storyBibleChangeRequestCreateRequestSchema.parse({
        version: 4,
        cardKey: "worldLaws",
        title: "缺少结构化规则",
        reason: "世界铁律请求必须保留结构化规则。",
        after: {
          key: "worldLaws",
          title: "世界铁律",
          content: "只有自然语言。",
          complete: true,
          worldRules: [],
        },
      }),
    ).toThrow("Locked worldLaws change requests require structured world rules");
    expect(storyBibleSchema.shape.cards).toBeDefined();
  });

  it("requires a complete ordered chapter brief before a chapter can be planned", () => {
    const brief = chapterBriefSchema.parse({
      goal: "让沈砚在断臂后找到新的战斗方式，并让顾青第一次怀疑他。",
      pov: "沈砚",
      location: "荒寺外山道",
      sceneBeats: [
        "沈砚藏起断臂，被顾青撞见。",
        "血河宗追兵逼近，两人被迫联手。",
        "沈砚单手结印，忘川书短暂显形。",
      ],
      requiredFacts: ["左臂骨折，不能双手结印", "顾青不知道忘川书完整来历"],
    });

    expect(brief.sceneBeats).toEqual([
      "沈砚藏起断臂，被顾青撞见。",
      "血河宗追兵逼近，两人被迫联手。",
      "沈砚单手结印，忘川书短暂显形。",
    ]);
    for (const field of ["goal", "pov", "location", "sceneBeats", "requiredFacts"] as const) {
      expect(() =>
        chapterBriefSchema.parse({
          ...brief,
          [field]: "",
        }),
      ).toThrow();
    }
    expect(() =>
      chapterBriefSchema.parse({
        ...brief,
        sceneBeats: [],
      }),
    ).toThrow();
    expect(() =>
      chapterBriefSchema.parse({
        ...brief,
        requiredFacts: [],
      }),
    ).toThrow();
  });

  it("exposes chapter readiness and append-only manual-save contracts", () => {
    const readiness = chapterReadinessSchema.parse({
      status: "partial",
      completed: 2,
      total: 3,
      canStartWriting: false,
      items: [
        {
          key: "story_bible",
          label: "故事圣经",
          ready: true,
          missing: [],
        },
        {
          key: "settings",
          label: "已确认设定",
          ready: true,
          missing: [],
        },
        {
          key: "brief",
          label: "章纲",
          ready: false,
          missing: ["缺少场景节拍"],
        },
      ],
    });
    const chapter = chapterWorkspaceSchema.parse({
      id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11",
      workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c12",
      branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c13",
      number: 1,
      title: "一只手也能结印",
      status: "planned",
      version: 1,
      wordCount: 0,
      currentVersionId: null,
      currentVersion: null,
      brief: {
        goal: "让沈砚找到新的战斗方式。",
        pov: "沈砚",
        location: "荒寺外山道",
        sceneBeats: ["沈砚藏起断臂。"],
        requiredFacts: ["左臂骨折"],
      },
      readiness,
      createdAt: "2026-11-05T08:00:00.000Z",
      updatedAt: "2026-11-05T08:00:00.000Z",
    });
    const save = chapterVersionCreateRequestSchema.parse({
      version: 1,
      content: "血从袖口滴下来，落在青石板上。",
    });

    expect(chapter.readiness.items.map((item) => item.key)).toEqual([
      "story_bible",
      "settings",
      "brief",
    ]);
    expect(chapter.number).toBe(1);
    expect(chapter).not.toHaveProperty("order");
    expect(save).toEqual({
      version: 1,
      content: "血从袖口滴下来，落在青石板上。",
    });
    expect(
      chapterVersionCreateRequestSchema.parse({
        version: 1,
        content: "  第一段\n\n第二段  ",
      }).content,
    ).toBe("  第一段\n\n第二段  ");
    expect(() =>
      chapterVersionCreateRequestSchema.parse({
        version: 1,
        content: "",
      }),
    ).toThrow();
  });

  it("validates versioned readiness results, evidence and exact remediation targets", () => {
    const readiness = generationReadinessSchema.parse({
      workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d01",
      branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d02",
      chapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d03",
      ruleVersion: "readiness-v1",
      status: "not_ready",
      canProceed: false,
      completed: 0,
      total: 1,
      blockers: 1,
      warnings: 0,
      dependencyFingerprint: "a".repeat(64),
      dependencies: [
        {
          key: "branch",
          version: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d04",
        },
      ],
      items: [
        {
          key: "story_bible",
          label: "故事圣经",
          severity: "blocker",
          state: "unlocked",
          ready: false,
          reason: "故事圣经尚未锁定",
          resource: {
            type: "story_bible",
            id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d05",
            version: "3",
            label: "故事圣经",
          },
          evidence: [
            {
              kind: "resource_state",
              summary: "第 3 版仍为草稿",
              resource: {
                type: "story_bible",
                id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d05",
                version: "3",
                label: "故事圣经",
              },
            },
          ],
          remediation: {
            action: "lock",
            label: "去锁定故事圣经",
            href: "/workspace/0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d01/bible#story-bible-readiness",
          },
        },
      ],
    });

    expect(readiness.items[0]?.resource.id).toBe("0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d05");
    expect(readiness.items[0]?.remediation?.href).toContain("/bible#story-bible-readiness");
    expect(
      generationReadinessQuerySchema.parse({
        chapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d03",
        maxCostCny: "2.5",
        maxTokens: "30000",
        maxRevisionRounds: "2",
      }),
    ).toMatchObject({
      maxCostCny: 2.5,
      maxTokens: 30_000,
      maxRevisionRounds: 2,
    });
    expect(() =>
      generationReadinessSchema.parse({
        ...readiness,
        items: [
          {
            ...readiness.items[0],
            remediation: {
              action: "lock",
              label: "去锁定故事圣经",
              href: "javascript:alert(1)",
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("exposes validToChapter on confirmed facts", () => {
    const fact = confirmedSettingSchema.parse({
      kind: "fact",
      id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c51",
      type: "character",
      name: "沈砚",
      summary: "身体状态：左臂骨折",
      source: "canon",
      status: "locked",
      version: 1,
      lockedAt: "2026-11-05T08:00:00.000Z",
      sourceChapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c52",
      sourceFactId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c51",
      validFromChapter: 3,
      validToChapter: null,
      predicate: "身体状态",
      object: "左臂骨折",
    });

    expect(fact).toMatchObject({
      validFromChapter: 3,
      validToChapter: null,
    });
  });

  it("requires source and validity fields on confirmed facts", () => {
    expect(() =>
      confirmedSettingSchema.parse({
        kind: "fact",
        id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c53",
        type: "character",
        name: "沈砚",
        summary: "身体状态：左臂骨折",
        source: "canon",
        status: "locked",
        version: 1,
        lockedAt: "2026-11-05T08:00:00.000Z",
        validFromChapter: 3,
        predicate: "身体状态",
        object: "左臂骨折",
      }),
    ).toThrow();
  });

  it("validates seven-column setting entities, custom fields and proposal evidence", () => {
    expect(settingEntityListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(customFieldDefinitionListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(() =>
      settingEntityListResponseSchema.parse({
        data: [],
        requestId: "req_settings",
        meta: {},
      }),
    ).toThrow();
    expect(() =>
      customFieldDefinitionListResponseSchema.parse({
        data: [],
        requestId: "req_custom_fields",
        meta: {},
      }),
    ).toThrow();

    const item = settingEntityCreateRequestSchema.parse({
      type: "item",
      name: "听潮剑",
      aliases: ["潮生"],
      summary: "会记录持剑者杀意的法器。",
      description: "",
      tags: ["法器"],
      data: {
        category: "兵器",
        grade: "玄阶",
        effect: "剑身会记录杀意。",
        cost: "杀意过重会反噬。",
        ownership: "顾青",
        limits: "不能离开主人超过七日。",
      },
    });
    expect(item.type).toBe("item");

    const timelineEvent = settingEntityCreateRequestSchema.parse({
      type: "timeline_event",
      name: "忘川村灭门",
      aliases: [],
      summary: "改变沈砚命运的事件。",
      description: "",
      tags: [],
      data: {
        era: "大玄历",
        storyTime: "十六年前",
        duration: "一夜",
        event: "沈砚父母被杀。",
      },
    });
    expect(timelineEvent.type).toBe("timeline_event");
    expect(() =>
      settingEntityCreateRequestSchema.parse({
        ...item,
        data: { ...item.data, bodyState: "物品不能有身体状态。" },
      }),
    ).toThrow();

    expect(
      customFieldDefinitionCreateRequestSchema.parse({
        key: "fate",
        label: "命格",
        fieldType: "single_select",
        appliesTo: "character",
        required: true,
        options: ["剑骨", "凡骨"],
        relationTarget: null,
      }),
    ).toMatchObject({ key: "fate", required: true });
    expect(() =>
      customFieldDefinitionCreateRequestSchema.parse({
        key: "fate",
        label: "命格",
        fieldType: "single_select",
        appliesTo: "character",
        options: [],
      }),
    ).toThrow("Select fields require at least one option");
    expect(() =>
      customFieldDefinitionCreateRequestSchema.parse({
        key: "relic",
        label: "关联物品",
        fieldType: "relation_ref",
        appliesTo: "character",
        options: [],
        relationTarget: null,
      }),
    ).toThrow("Relation fields require a target type");
    expect(() =>
      customFieldDefinitionCreateRequestSchema.parse({
        key: "note",
        label: "备注",
        fieldType: "text",
        appliesTo: "character",
        options: ["不应有选项"],
      }),
    ).toThrow("Only select fields can define options");

    expect(() =>
      settingProposalCreateRequestSchema.parse({
        version: 1,
        reason: "缺少证据",
        conflictType: "none",
        evidence: [],
      }),
    ).toThrow();
    expect(() =>
      settingChangeRequestCreateRequestSchema.parse({
        version: 1,
        title: "缺少修改内容",
        reason: "必须至少包含一个字段",
        after: {},
        conflictType: "none",
        evidence: [
          {
            kind: "author_note",
            label: "作者说明",
            quote: "需要修改。",
          },
        ],
      }),
    ).toThrow("At least one setting field is required");

    const response = settingEntitySchema.parse({
      id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c81",
      workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c82",
      branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c83",
      type: "item",
      name: "听潮剑",
      aliases: [],
      summary: "会记录持剑者杀意的法器。",
      description: "",
      tags: [],
      customFields: { fate: "剑骨", charges: 3, hidden: false, marks: ["潮"] },
      status: "draft",
      source: "author",
      version: 1,
      data: {
        category: "兵器",
        grade: "玄阶",
        effect: "剑身会记录杀意。",
        cost: "",
        ownership: "顾青",
        limits: "",
      },
      lockedAt: null,
      lockedBy: null,
      createdAt: "2026-11-06T08:00:00.000Z",
      updatedAt: "2026-11-06T08:00:00.000Z",
    });
    expect(response.customFields).toEqual({
      fate: "剑骨",
      charges: 3,
      hidden: false,
      marks: ["潮"],
    });
  });

  it("keeps generic entity patches metadata-only for dedicated domains", () => {
    expect(
      settingEntityPatchRequestSchema.parse({
        version: 2,
        name: "更新后的设定",
        summary: "只更新公共元数据。",
        customFields: { fate: "剑骨" },
      }),
    ).toMatchObject({ name: "更新后的设定" });

    expect(
      settingEntityPatchRequestSchema.parse({
        version: 2,
        data: { rule: "世界规则仍可通过通用接口更新。" },
      }),
    ).toMatchObject({ data: { rule: "世界规则仍可通过通用接口更新。" } });

    for (const data of [
      { bodyState: "左臂已愈。" },
      { details: "势力总览。" },
      { details: "地图说明。" },
      { details: "力量体系总览。" },
      { rules: "吞噬记忆换取力量。", cost: "", limits: "", growth: "" },
      {
        category: "信物",
        grade: "玄阶",
        effect: "剑身会记录杀意。",
        cost: "",
        ownership: "",
        limits: "",
      },
      { era: "大玄历", storyTime: "十六年前", event: "忘川村灭门。" },
    ]) {
      expect(() =>
        settingEntityPatchRequestSchema.parse({
          version: 2,
          data,
        }),
      ).toThrow();
    }
  });

  it("validates append-only setting version restoration requests", () => {
    expect(
      settingEntityRestoreRequestSchema.parse({
        version: 3,
        targetVersion: 1,
        reason: "恢复被误改的天门规则。",
      }),
    ).toEqual({
      version: 3,
      targetVersion: 1,
      reason: "恢复被误改的天门规则。",
    });
    expect(() =>
      settingEntityRestoreRequestSchema.parse({
        version: 3,
        targetVersion: 1,
        reason: "",
      }),
    ).toThrow();
  });

  it("validates cursor metadata for setting history sublists", () => {
    const cursor = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1ca1";
    expect(settingEntityVersionListQuerySchema.parse({ limit: "2" })).toEqual({ limit: 2 });
    expect(settingProposalListQuerySchema.parse({ cursor })).toEqual({ cursor, limit: 20 });
    expect(settingChangeRequestListQuerySchema.parse({ limit: "1" })).toEqual({ limit: 1 });

    expect(
      settingEntityVersionListResponseSchema.parse({
        data: [
          {
            version: 2,
            node: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1ca2",
            createdAt: "2026-11-08T03:00:00.000Z",
            actor: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1ca3",
            reason: "修订天门规则",
            snapshot: {
              domain: "world_rule",
              payload: {
                type: "world_rule",
                name: "天门规则",
                summary: "历史摘要",
                status: "draft",
              },
            },
            summary: {
              name: "天门规则",
              summary: "历史摘要",
              status: "draft",
            },
          },
          {
            version: 1,
            node: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1ca4",
            createdAt: "2026-11-08T02:00:00.000Z",
            actor: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1ca3",
            reason: "创建人物档案",
            snapshot: {
              domain: "character",
              payload: {
                profile: {
                  desire: "找回记忆",
                  fear: "被吞噬",
                  goal: "进入天门",
                  voiceSample: "",
                  voiceGuide: "",
                  disguise: "",
                },
                relationships: [],
                stateTransitions: [],
                knowledgeStates: [],
              },
            },
            summary: {
              name: null,
              summary: null,
              status: null,
            },
          },
        ],
        requestId: "req_settings_versions",
        meta: { nextCursor: cursor },
      }).data[0]?.version,
    ).toBe(2);

    expect(
      settingProposalListResponseSchema.parse({
        data: [],
        requestId: "req_settings_proposals",
        meta: { nextCursor: null },
      }).meta.nextCursor,
    ).toBeNull();
    expect(
      settingChangeRequestListResponseSchema.parse({
        data: [],
        requestId: "req_settings_changes",
        meta: { nextCursor: cursor },
      }).meta.nextCursor,
    ).toBe(cursor);
  });
});

describe("outline planning contracts", () => {
  const branchId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11";
  const nodeId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c12";
  const chapterId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c13";
  const versionNodeId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c14";
  const characterRef = {
    type: "character" as const,
    id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c15",
    branchId,
    label: "沈砚",
    version: null,
  };
  const locationRef = {
    type: "map" as const,
    id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c16",
    branchId,
    label: "荒寺外山道",
    version: null,
  };

  it("requires exactly one chapter source for chapter outline nodes", () => {
    expect(
      outlineNodeCreateRequestSchema.safeParse({
        level: "chapter",
        parentId: nodeId,
        title: "一只手也能结印",
      }).success,
    ).toBe(false);
    expect(
      outlineNodeCreateRequestSchema.safeParse({
        level: "chapter",
        parentId: nodeId,
        chapterId,
      }).success,
    ).toBe(true);
    expect(
      outlineNodeCreateRequestSchema.safeParse({
        level: "chapter",
        parentId: nodeId,
        chapterId,
        chapterCreate: {
          number: 1,
          title: "一只手也能结印",
          brief: {
            goal: "目标",
            pov: "沈砚",
            location: "荒寺外山道",
            sceneBeats: ["节拍"],
            requiredFacts: ["左臂骨折"],
          },
        },
      }).success,
    ).toBe(false);
    expect(
      outlineNodeCreateRequestSchema.safeParse({
        level: "volume",
        parentId: nodeId,
        title: "第一卷",
        chapterId,
      }).success,
    ).toBe(false);
  });

  it("keeps scene cards ordered, versioned and strict", () => {
    const card = outlineSceneCardWriteRequestSchema.parse({
      title: "藏起断臂",
      pov: characterRef,
      location: locationRef,
      storyTime: { era: "大玄历", label: "雨夜", sortKey: 100 },
      beats: [{ description: "沈砚藏起断臂。" }, { description: "顾青撞见。" }],
      informationReleases: [
        { description: "顾青看见书页一角", constraint: "顾青不能知道完整来历" },
      ],
      tension: 72,
    });
    expect(card.beats.map((beat) => beat.description)).toEqual(["沈砚藏起断臂。", "顾青撞见。"]);
    expect(card.pov?.label).toBe("沈砚");
    expect(
      outlineSceneCardWriteRequestSchema.safeParse({
        ...card,
        ignored: true,
      }).success,
    ).toBe(false);
  });

  it("parses outline nodes, readiness and replan results as stable shapes", () => {
    const node = outlineNodeSchema.parse({
      id: nodeId,
      workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c17",
      branchId,
      level: "chapter",
      parentId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c18",
      sortOrder: 0,
      title: "一只手也能结印",
      summary: "",
      status: "planned",
      locked: false,
      version: 1,
      chapter: {
        id: chapterId,
        number: 48,
        title: "一只手也能结印",
        status: "planned",
        version: 1,
        wordCount: 0,
      },
      tension: 72,
      versionNodeId,
      createdAt: "2026-11-06T00:00:00.000Z",
      updatedAt: "2026-11-06T00:00:00.000Z",
    });
    expect(node.chapter?.number).toBe(48);

    const readiness = outlineReadinessSchema.parse({
      ruleVersion: "outline-readiness-v1",
      status: "partial",
      canProceed: true,
      completed: 2,
      total: 3,
      items: [
        {
          key: "scene_information:scene",
          label: "信息释放",
          severity: "warning",
          ready: false,
          resourceType: "outline_node",
          resourceId: nodeId,
          remediation: "补信息释放和知情边界",
        },
      ],
    });
    expect(readiness.ruleVersion).toBe("outline-readiness-v1");

    const replan = outlineReplanResultSchema.parse({
      ruleVersion: "outline-replan-v1",
      nodeId,
      canApply: true,
      impacted: {
        nodeIds: [nodeId],
        chapterIds: [chapterId],
        sceneNodeIds: [],
        lockedNodeIds: [],
      },
      blockers: [],
      warnings: [],
    });
    expect(replan.impacted.chapterIds).toEqual([chapterId]);
  });

  it("parses volume contracts and scene cards returned by the API", () => {
    expect(
      volumeContractSchema.parse({
        id: nodeId,
        nodeId,
        workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c17",
        branchId,
        objective: "进入天门",
        conflict: "血河宗追捕",
        turningPoints: ["断臂"],
        exitConditions: ["离开南境"],
        plotLines: [{ name: "天门将开", status: "active", note: "主线" }],
        version: 1,
        versionNodeId,
        createdAt: "2026-11-06T00:00:00.000Z",
        updatedAt: "2026-11-06T00:00:00.000Z",
      }).objective,
    ).toBe("进入天门");
    expect(
      sceneCardSchema.parse({
        id: nodeId,
        nodeId,
        workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c17",
        branchId,
        title: "藏起断臂",
        pov: characterRef,
        location: locationRef,
        storyTime: { era: "大玄历", label: "雨夜", sortKey: 100 },
        beats: [{ id: versionNodeId, order: 1, description: "沈砚藏起断臂。" }],
        informationReleases: [
          {
            id: versionNodeId,
            order: 1,
            description: "顾青看见书页一角",
            constraint: "顾青不能知道完整来历",
          },
        ],
        tension: 72,
        version: 1,
        versionNodeId,
        createdAt: "2026-11-06T00:00:00.000Z",
        updatedAt: "2026-11-06T00:00:00.000Z",
      }).beats[0]?.order,
    ).toBe(1);
  });
});

describe("character domain contracts", () => {
  const branchId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d01";
  const characterId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d02";
  const factId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d03";
  const versionNodeId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d04";

  it("freezes versioned domain references and story-time validity", () => {
    const version = versionRefSchema.parse({
      branchId,
      versionNodeId,
      objectVersion: 3,
    });
    const ref = domainRefSchema.parse({
      type: "character",
      id: characterId,
      branchId,
      label: "沈砚",
      version,
    });
    const validity = validityIntervalSchema.parse({
      fromChapter: 3,
      toChapter: 8,
      fromStoryTime: { era: "大玄历", label: "第三年秋", sortKey: 30 },
      toStoryTime: { era: "大玄历", label: "第三年冬", sortKey: 40 },
    });

    expect(ref.version).toEqual(version);
    expect(validity.toChapter).toBe(8);
    expect(
      storyTimePointSchema.parse({ era: "大玄历", label: "十六年前", sortKey: -16 }),
    ).toMatchObject({ sortKey: -16 });
    expect(() =>
      domainRefSchema.parse({ type: "character", id: characterId, branchId, extra: true }),
    ).toThrow();
    expect(() =>
      validityIntervalSchema.parse({
        fromChapter: 8,
        toChapter: 3,
        fromStoryTime: null,
        toStoryTime: null,
      }),
    ).toThrow();
    expect(() =>
      validityIntervalSchema.parse({
        fromChapter: 3,
        toChapter: 8,
        fromStoryTime: null,
        toStoryTime: { era: "大玄历", label: "第三年冬", sortKey: 40 },
      }),
    ).toThrow("Validity start story time is required");
  });

  it("keeps objective facts and character knowledge states separate", () => {
    const knowledge = characterKnowledgeStateCreateRequestSchema.parse({
      objectiveFactId: factId,
      state: "misbelief",
      claimedContent: "沈砚相信父母是自尽。",
      sourceKind: "told",
      validity: { fromChapter: 2, toChapter: null, fromStoryTime: null, toStoryTime: null },
      sourceChapterId: null,
    });
    expect(knowledge.objectiveFactId).toBe(factId);
    expect(knowledge.state).toBe("misbelief");
    expect(() =>
      characterKnowledgeStateCreateRequestSchema.parse({
        objectiveFactId: factId,
        state: "unknown",
        claimedContent: "不应附带主观内容",
        sourceKind: "assumed",
        validity: { fromChapter: 2, toChapter: null, fromStoryTime: null, toStoryTime: null },
        sourceChapterId: null,
      }),
    ).toThrow();
  });

  it("types profile, relationship, state and locked-content change requests", () => {
    expect(
      characterProfileUpdateRequestSchema.parse({
        version: 2,
        profile: {
          desire: "找回被抹去的记忆",
          fear: "成为忘川书的下一个祭品",
          goal: "进入天门",
          voiceSample: "“我记得，只是还没想起来。”",
          voiceGuide: "句子短，少用感叹。",
          disguise: "藏起左臂伤势",
        },
      }).profile.desire,
    ).toBe("找回被抹去的记忆");

    expect(
      characterRelationshipCreateRequestSchema.parse({
        target: { type: "character", id: versionNodeId, branchId, label: "顾青" },
        relationType: "enemy",
        validity: { fromChapter: 5, toChapter: null, fromStoryTime: null, toStoryTime: null },
        sourceChapterId: null,
      }).relationType,
    ).toBe("enemy");

    expect(
      characterStateTransitionCreateRequestSchema.parse({
        stateKind: "location",
        stateKey: "current_location",
        value: "太玄门山门",
        target: { type: "map", id: versionNodeId, branchId, label: "太玄门山门" },
        validity: { fromChapter: 5, toChapter: null, fromStoryTime: null, toStoryTime: null },
        sourceChapterId: null,
      }).stateKind,
    ).toBe("location");

    expect(
      characterChangeRequestCreateRequestSchema.parse({
        version: 3,
        kind: "knowledge_state",
        title: "补录顾青的误信",
        reason: "第 18 章揭示了顾青被告知的假消息。",
        after: {
          objectiveFactId: factId,
          state: "misbelief",
          claimedContent: "顾青相信沈砚已经死了。",
          sourceKind: "told",
          validity: { fromChapter: 18, toChapter: null, fromStoryTime: null, toStoryTime: null },
          sourceChapterId: null,
        },
        evidence: [
          {
            kind: "chapter",
            sourceId: null,
            label: "第 18 章",
            quote: "顾青亲手封死了那口空棺。",
            locator: "第 18 章 · 末段",
            confidence: 0.98,
          },
        ],
      }).kind,
    ).toBe("knowledge_state");
  });

  it("types structured retrieval queries and provenance-bearing results", () => {
    expect(characterKnowledgeProjectionQuerySchema.parse({ chapterNumber: "5" })).toEqual({
      chapterNumber: 5,
    });
    expect(() => characterKnowledgeProjectionQuerySchema.parse({})).toThrow();
    expect(() =>
      characterKnowledgeProjectionQuerySchema.parse({ chapterNumber: 5, extra: true }),
    ).toThrow();

    const query = retrievalQuerySchema.parse({
      query: "小砚",
      synonyms: ["师父"],
      sourceKinds: ["entity", "fact", "timeline_event", "map_node"],
      entityTypes: ["character", "faction", "map", "item"],
      chapterNumber: 5,
      versionNodeId: null,
      storyTime: { era: "大玄历", label: "第一年夏", sortKey: 20 },
      povCharacterId: versionNodeId,
      expandRelationships: true,
      relationshipDepth: 1,
      limit: 20,
    });
    expect(query).toMatchObject({
      query: "小砚",
      chapterNumber: 5,
      expandRelationships: true,
      relationshipDepth: 1,
    });

    const result = retrievalResultSchema.parse({
      id: versionNodeId,
      sourceKind: "entity",
      matchKind: "alias",
      score: 0.98,
      label: "沈砚",
      canonicalName: "沈砚",
      entityType: "character",
      summary: "被宗门抛弃的外门杂役。",
      source: {
        type: "character",
        id: versionNodeId,
        branchId,
        label: "沈砚",
        version: { branchId, versionNodeId: factId, objectVersion: 2 },
      },
      validity: {
        fromChapter: 1,
        toChapter: null,
        fromStoryTime: null,
        toStoryTime: null,
      },
      sourceChapter: null,
      matchedTerm: "小砚",
      matchedField: "aliases",
      relationshipPath: [],
      disambiguation: { sameNameCount: 2, key: "character:沈砚" },
    });
    expect(result.source.version).toMatchObject({ versionNodeId: factId, objectVersion: 2 });
    expect(() =>
      retrievalQuerySchema.parse({
        query: "沈砚",
        chapterNumber: 5,
        relationshipDepth: 3,
      }),
    ).toThrow();
    expect(() =>
      retrievalQuerySchema.parse({
        query: "沈砚",
        relationshipDepth: 1,
      }),
    ).toThrow();
  });
});
