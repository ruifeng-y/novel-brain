import { describe, expect, it } from "vitest";

import {
  VOLUME_AUDIT_RULE_VERSION,
  volumeAuditReportSchema,
  volumeAuditSignoffRequestSchema,
  volumeAuditWorkspaceSchema,
} from "../src";

const workId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a3a01";
const branchId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a3a02";
const volumeNodeId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a3a03";
const chapterId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a3a04";
const chapterVersionId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a3a05";
const auditId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a3a06";
const findingId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a3a07";
const userId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a3a08";

const evidence = {
  kind: "text",
  sourceId: chapterId,
  sourceVersionId: chapterVersionId,
  chapterId,
  chapterVersionId,
  quote: "他刚踏入筑基，又在一炷香内踏入金丹。",
  startOffset: 0,
  endOffset: 20,
  locator: "第 8 章 · 第 2 段",
  explanation: "同一章出现两次境界跃升。",
} as const;

describe("volume audit contracts", () => {
  it("freezes the audit rule version and accepts a full report", () => {
    expect(VOLUME_AUDIT_RULE_VERSION).toBe("m1-volume-audit-v1");
    const report = volumeAuditReportSchema.parse({
      id: auditId,
      workId,
      branchId,
      volumeNodeId,
      volumeTitle: "第一卷 · 忘川",
      chapterFrom: 1,
      chapterTo: 40,
      ruleVersion: VOLUME_AUDIT_RULE_VERSION,
      sourceHash: "a".repeat(64),
      status: "blocked",
      findings: [
        {
          id: findingId,
          workId,
          branchId,
          chapterId,
          chapterVersionId,
          chapterNumber: 8,
          dimension: "reader_experience",
          qualityDimension: "continuity",
          severity: "P1",
          structural: false,
          code: "POWER_INFLATION",
          evidence: [evidence],
          sourceRefs: [
            { type: "chapter", id: chapterId, versionId: chapterVersionId, label: "第 8 章" },
          ],
          affectedObjects: [{ type: "chapter", id: chapterId, label: "第 8 章 金丹" }],
          recommendation: "补上突破代价与冷却，或删去同章连续越级。",
          upstreamFindingId: null,
          createdAt: "2026-11-06T08:00:00.000Z",
        },
      ],
      coverage: [
        {
          chapterId,
          chapterNumber: 8,
          title: "金丹",
          chapterVersionId,
          wordCount: 3000,
          qualityReportId: null,
          qualityFindingCount: 0,
        },
      ],
      summary: {
        total: 1,
        blockers: 1,
        warnings: 0,
        unresolvedLedger: 0,
        motivation: 0,
        antagonist: 0,
        powerInflation: 1,
        mapTime: 0,
        knowledgeLeak: 0,
        other: 0,
      },
      signoff: null,
      version: 1,
      createdAt: "2026-11-06T08:00:00.000Z",
    });
    expect(report.findings[0]?.code).toBe("POWER_INFLATION");
    expect(report.summary.powerInflation).toBe(1);
  });

  it("requires an author rationale and optimistic version for signoff", () => {
    expect(
      volumeAuditSignoffRequestSchema.parse({
        version: 3,
        decision: "changes_requested",
        rationale: "第 8 章连续越级需要补足代价与冷却，暂不通过卷末验收。",
      }).decision,
    ).toBe("changes_requested");
    expect(() =>
      volumeAuditSignoffRequestSchema.parse({
        version: 3,
        decision: "accepted",
        rationale: "通过",
      }),
    ).toThrow();
  });

  it("exposes volume choices and the latest report in the workspace", () => {
    const workspace = volumeAuditWorkspaceSchema.parse({
      workId,
      branchId,
      goldenThreeLocked: true,
      volumes: [
        {
          nodeId: volumeNodeId,
          title: "第一卷 · 忘川",
          chapterFrom: 1,
          chapterTo: 40,
          chapterCount: 40,
          writtenChapters: 40,
          latestReportId: auditId,
        },
      ],
      latestReport: null,
      signoffUser: null,
    });
    expect(workspace.volumes[0]?.chapterCount).toBe(40);
    expect(workspace.goldenThreeLocked).toBe(true);
    expect(workspace.signoffUser).toBeNull();
  });

  it("keeps unknown finding codes out of the shared read model", () => {
    const report = {
      id: auditId,
      workId,
      branchId,
      volumeNodeId,
      volumeTitle: "第一卷 · 忘川",
      chapterFrom: 1,
      chapterTo: 40,
      ruleVersion: VOLUME_AUDIT_RULE_VERSION,
      sourceHash: "a".repeat(64),
      status: "passed",
      findings: [],
      coverage: [],
      summary: {
        total: 0,
        blockers: 0,
        warnings: 0,
        unresolvedLedger: 0,
        motivation: 0,
        antagonist: 0,
        powerInflation: 0,
        mapTime: 0,
        knowledgeLeak: 0,
        other: 0,
      },
      signoff: {
        decision: "accepted",
        rationale: "作者已逐章核对卷末剧情线、伏笔与连续性证据。",
        signedOffBy: userId,
        signedOffAt: "2026-11-06T08:00:00.000Z",
      },
      version: 2,
      createdAt: "2026-11-06T08:00:00.000Z",
    };
    expect(volumeAuditReportSchema.parse(report).signoff?.decision).toBe("accepted");
    expect(() =>
      volumeAuditReportSchema.parse({
        ...report,
        findings: [{ ...report.findings, code: "UNKNOWN" }],
      }),
    ).toThrow();
  });
});
