import { sha256Json } from "@novel-brain/continuity-benchmark";

import { RELEASE_QUALITY_RUBRIC_VERSION } from "./dataset";

export const APPROVED_QUALITY_RUBRIC_SHA256 =
  "4a3bd567da67c0340a3efa07c78e0efc50190793ba7f22cdade3e72bf6bb7e35" as const;

export type QualityBenchmarkDimensionId =
  | "p0_fact_loss"
  | "knowledge_boundary_violation"
  | "outline_adherence"
  | "hook_prose_score"
  | "continuity_conflicts_per_50k";

export type QualityScorerType = "deterministic" | "human_blind" | "model_assisted";
export type ThresholdOperator = "min" | "max";

export interface QualityDimensionThreshold {
  operator: ThresholdOperator;
  value: number;
}

export interface QualityDimensionVariance {
  requiredForScorers: readonly QualityScorerType[];
  maxVariance: number | null;
  decisionId: "interRaterVarianceThreshold" | null;
}

export interface QualityDimensionDefinition {
  id: QualityBenchmarkDimensionId;
  label: string;
  unit: "count" | "ratio" | "score" | "per_50k_characters";
  threshold: QualityDimensionThreshold;
  scoreRange: { min: number; max: number } | null;
  evidenceRequirements: readonly string[];
  scorerType: QualityScorerType;
  variance: QualityDimensionVariance;
  waiverOwner: "release-owner";
}

export interface ReleaseQualityRubric {
  schemaVersion: 1;
  rubricVersion: typeof RELEASE_QUALITY_RUBRIC_VERSION;
  sourceAdr: "docs/adr/0022-quality-measurement-and-release-gate.md";
  dimensions: readonly QualityDimensionDefinition[];
  decisionRequired: readonly ["interRaterVarianceThreshold"];
  sha256: string;
}

export function createReleaseQualityRubric(): ReleaseQualityRubric {
  const rubricWithoutHash: Omit<ReleaseQualityRubric, "sha256"> = {
    schemaVersion: 1,
    rubricVersion: RELEASE_QUALITY_RUBRIC_VERSION,
    sourceAdr: "docs/adr/0022-quality-measurement-and-release-gate.md",
    dimensions: [
      {
        id: "p0_fact_loss",
        label: "P0 事实丢失",
        unit: "count",
        threshold: { operator: "max", value: 0 },
        scoreRange: null,
        evidenceRequirements: [
          "每个 P0 finding 必须引用章节、源事实、角色和 version node",
          "聚合计数不得隐藏任一 P0 失败",
        ],
        scorerType: "deterministic",
        variance: {
          requiredForScorers: [],
          maxVariance: null,
          decisionId: null,
        },
        waiverOwner: "release-owner",
      },
      {
        id: "knowledge_boundary_violation",
        label: "知识边界违规",
        unit: "count",
        threshold: { operator: "max", value: 0 },
        scoreRange: null,
        evidenceRequirements: [
          "必须给出 POV 角色、披露事件、章节和 version node",
          "objective canon 与角色 belief/suspicion 必须分开",
        ],
        scorerType: "deterministic",
        variance: {
          requiredForScorers: [],
          maxVariance: null,
          decisionId: null,
        },
        waiverOwner: "release-owner",
      },
      {
        id: "outline_adherence",
        label: "大纲贴合",
        unit: "ratio",
        threshold: { operator: "min", value: 0.9 },
        scoreRange: { min: 0, max: 1 },
        evidenceRequirements: [
          "每个必需节拍需要实际出现证据",
          "人工评分必须记录 reviewer、confidence 和 adjudication",
        ],
        scorerType: "human_blind",
        variance: {
          requiredForScorers: ["human_blind"],
          maxVariance: null,
          decisionId: "interRaterVarianceThreshold",
        },
        waiverOwner: "release-owner",
      },
      {
        id: "hook_prose_score",
        label: "钩子/文笔",
        unit: "score",
        threshold: { operator: "min", value: 4 },
        scoreRange: { min: 1, max: 5 },
        evidenceRequirements: ["每个分数必须附带正文证据句", "盲评不得暴露模型身份或生成状态"],
        scorerType: "human_blind",
        variance: {
          requiredForScorers: ["human_blind"],
          maxVariance: null,
          decisionId: "interRaterVarianceThreshold",
        },
        waiverOwner: "release-owner",
      },
      {
        id: "continuity_conflicts_per_50k",
        label: "每 5 万字连续性冲突",
        unit: "per_50k_characters",
        threshold: { operator: "max", value: 1 },
        scoreRange: null,
        evidenceRequirements: [
          "冲突计数必须链接来源事实、章节和受影响对象",
          "正文长度分母必须来自同一冻结样本集",
        ],
        scorerType: "deterministic",
        variance: {
          requiredForScorers: [],
          maxVariance: null,
          decisionId: null,
        },
        waiverOwner: "release-owner",
      },
    ],
    decisionRequired: ["interRaterVarianceThreshold"],
  };
  return {
    ...rubricWithoutHash,
    sha256: sha256Json(rubricWithoutHash),
  };
}

export function verifyReleaseQualityRubric(rubric: ReleaseQualityRubric): boolean {
  const { sha256, ...rubricWithoutHash } = rubric;
  return sha256 === sha256Json(rubricWithoutHash);
}
