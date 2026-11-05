import { describe, expect, it } from "vitest";

import {
  authPasswordSchema,
  authSessionResponseSchema,
  chapterBriefSchema,
  chapterReadinessSchema,
  chapterVersionCreateRequestSchema,
  chapterWorkspaceSchema,
  contextPackVersionSchema,
  csrfResponseSchema,
  factProposalDecisionRequestSchema,
  factProposalSchema,
  generateChapterRequestSchema,
  generationJobSchema,
  GENERATE_CHAPTER_JOB,
  generateChapterJobSchema,
  jobEventSchema,
  importReportSchema,
  loginRequestSchema,
  manuscriptImportConfirmRequestSchema,
  manuscriptImportResponseSchema,
  modelConfigInputSchema,
  modelConfigSchema,
  modelConfigDeleteResponseSchema,
  modelConfigUpdateSchema,
  modelConnectionTestResponseSchema,
  modelProvidersResponseSchema,
  readinessResponseSchema,
  registerRequestSchema,
  sendRegistrationCodeRequestSchema,
  sendRegistrationCodeResponseSchema,
  settingsImportConfirmRequestSchema,
  settingsImportConflictDecisionRequestSchema,
  logoutResponseSchema,
  STORY_BIBLE_CARD_KEYS,
  STORY_BIBLE_CARD_TITLES,
  storyBiblePatchRequestSchema,
  workBranchSchema,
  workCreateRequestSchema,
  workSchema,
  workSourceModeSchema,
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
      order: 1,
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
});
