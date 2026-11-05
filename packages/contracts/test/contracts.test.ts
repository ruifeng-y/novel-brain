import { describe, expect, it } from "vitest";

import {
  authPasswordSchema,
  authSessionResponseSchema,
  csrfResponseSchema,
  GENERATE_CHAPTER_JOB,
  generateChapterJobSchema,
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
  workBranchSchema,
  workCreateRequestSchema,
  workSchema,
  workSourceModeSchema,
} from "../src";

describe("shared contracts", () => {
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
});
