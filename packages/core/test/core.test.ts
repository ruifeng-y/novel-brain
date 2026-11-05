import { describe, expect, it } from "vitest";

import {
  compileContextPack,
  createRequestId,
  elapsedMilliseconds,
  extractFactCandidates,
  resolveProxyIpSecret,
  signClientIp,
  verifyClientIp,
} from "../src";

describe("core request helpers", () => {
  it("creates protocol-compatible request identifiers", () => {
    expect(createRequestId(() => "fixed-id")).toBe("req_fixed-id");
  });

  it("reports non-negative elapsed milliseconds", () => {
    expect(elapsedMilliseconds(process.hrtime.bigint())).toBeGreaterThanOrEqual(0);
  });

  it("signs and verifies client IP values", () => {
    const signed = signClientIp("203.0.113.8", "secret");
    expect(verifyClientIp(signed, "secret")).toBe("203.0.113.8");
    expect(verifyClientIp(`${signed}x`, "secret")).toBeNull();
    expect(verifyClientIp(signed, "wrong-secret")).toBeNull();
  });

  it("fails closed for a default proxy IP secret", () => {
    expect(resolveProxyIpSecret("production-secret", undefined)).toBe("production-secret");
    expect(() => resolveProxyIpSecret(undefined, undefined)).toThrow();
    expect(() => resolveProxyIpSecret("change-me-in-production", undefined)).toThrow();
    expect(resolveProxyIpSecret("local-development-proxy-ip-secret", "true")).toBe(
      "local-development-proxy-ip-secret",
    );
  });
});

describe("context compiler", () => {
  it("keeps required sources, evicts optional sources and records citations", () => {
    const requiredRef = {
      sourceType: "chapter_brief" as const,
      sourceId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11",
      label: "章纲",
      citation: "第 1 章 · 必用事实",
    };
    const settingRef = {
      sourceType: "setting" as const,
      sourceId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c12",
      label: "沈砚",
      citation: "已确认设定 · 沈砚",
    };

    const pack = compileContextPack({
      tokenBudget: 8,
      compilerVersion: "m0-context-v1",
      sources: [
        {
          key: "brief:required",
          label: "必用事实",
          priority: "required",
          content: "断臂",
          sourceRefs: [requiredRef],
        },
        {
          key: "setting:character",
          label: "沈砚",
          priority: "high",
          content: "左臂骨折，不能双手结印。",
          sourceRefs: [settingRef],
        },
        {
          key: "recent:chapter-0",
          label: "上一章",
          priority: "normal",
          content: "追兵已经逼近荒寺。",
          sourceRefs: [
            {
              sourceType: "chapter_version",
              sourceId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c13",
              label: "上一章",
              citation: "上一章版本",
            },
          ],
        },
      ],
    });

    expect(pack.selected.map((source) => source.key)).toEqual([
      "brief:required",
      "setting:character",
    ]);
    expect(pack.tokenUsed).toBe(7);
    expect(pack.evicted).toEqual([
      {
        key: "recent:chapter-0",
        label: "上一章",
        reason: "token_budget",
        tokenCount: 5,
      },
    ]);
    expect(pack.sourceRefs).toEqual([requiredRef, settingRef]);
  });
});

describe("fact extraction", () => {
  it("keeps exact source sentences and assigns risk by fact type", () => {
    const content = [
      "血从袖口滴下来，落在荒寺外的青石板上。",
      "沈砚把断臂藏进衣袍，只用右手结印。",
      "顾青看见书页一角，却没有点破，只把追兵引向山道另一侧。",
    ].join("\n\n");

    const candidates = extractFactCandidates(content);

    expect(candidates).toEqual(
      expect.arrayContaining([
        {
          subject: "沈砚",
          predicate: "身体状态",
          object: "沈砚把断臂藏进衣袍，只用右手结印",
          sourceSentence: "沈砚把断臂藏进衣袍，只用右手结印。",
          risk: "high",
          confidence: 0.95,
          required: true,
        },
        {
          subject: "顾青",
          predicate: "角色认知",
          object: "顾青看见书页一角，却没有点破，只把追兵引向山道另一侧",
          sourceSentence: "顾青看见书页一角，却没有点破，只把追兵引向山道另一侧。",
          risk: "medium",
          confidence: 0.82,
          required: true,
        },
      ]),
    );
  });
});
