import {
  createContinuityPlan,
  generateContinuityFixture,
  sha256Json,
  type ContinuitySeverity,
  type ContinuityTier,
} from "@novel-brain/continuity-benchmark";

export const QUALITY_BENCHMARK_GENERATOR_VERSION = "quality-benchmark-v1" as const;
export const RELEASE_QUALITY_RUBRIC_VERSION = "adr-0022-v1" as const;
export const APPROVED_QUALITY_BENCHMARK_DATASET_SHA256 =
  "c6c22e8922df49a9dbff52321e09ae463163e99726db5530eb08cf5f8f7d76ef" as const;
export const APPROVED_QUALITY_BENCHMARK_INPUT = {
  seed: 20261118,
  sourceCommit: "38a85cb3f45bc9d1a6f8bcf66f5b5d50c16132ca",
  continuityTier: "full",
} as const;

export const QUALITY_BENCHMARK_GENRES = ["仙侠", "历史", "都市"] as const;
export type QualityBenchmarkGenre = (typeof QUALITY_BENCHMARK_GENRES)[number];
export type QualityDifficulty = "easy" | "medium" | "hard";
export type QualitySampleKind = "chapter" | "long_horizon_case";

export interface QualityKnownIssue {
  code: string;
  severity: ContinuitySeverity;
  description: string;
}

export interface QualitySampleSource {
  type: "synthetic" | "continuity_fixture";
  version: string;
  hash: string;
}

export interface QualityChapterSample {
  id: string;
  kind: "chapter";
  genre: QualityBenchmarkGenre;
  difficulty: QualityDifficulty;
  title: string;
  text: string;
  sourceVersion: string;
  sourceHash: string;
  knownIssues: readonly QualityKnownIssue[];
}

export interface QualityAdversarialCase {
  id: string;
  kind: "long_horizon_case";
  genre: QualityBenchmarkGenre;
  difficulty: QualityDifficulty;
  title: string;
  text: string;
  sourceVersion: string;
  sourceHash: string;
  knownIssues: readonly QualityKnownIssue[];
  family: string;
  chapterNumber: number;
  branchId: string;
  sourceFactId: string;
  versionNodeId: string;
}

export interface QualityDatasetManifestEntry {
  id: string;
  kind: QualitySampleKind;
  genre: QualityBenchmarkGenre;
  difficulty: QualityDifficulty;
  sourceVersion: string;
  sourceHash: string;
  knownIssues: readonly QualityKnownIssue[];
}

export interface QualityBenchmarkManifest {
  schemaVersion: 1;
  datasetVersion: typeof QUALITY_BENCHMARK_GENERATOR_VERSION;
  rubricVersion: typeof RELEASE_QUALITY_RUBRIC_VERSION;
  seed: number;
  sourceCommit: string;
  continuityTier: Exclude<ContinuityTier, "smoke">;
  continuityFixtureSha256: string;
  chapterCount: number;
  volumeCount: number;
  chapterSampleCount: number;
  adversarialCaseCount: number;
  genres: readonly QualityBenchmarkGenre[];
  entries: readonly QualityDatasetManifestEntry[];
  decisionRequired: readonly string[];
  datasetSha256: string;
}

export interface QualityBenchmarkDataset {
  schemaVersion: 1;
  chapterSamples: readonly QualityChapterSample[];
  adversarialCases: readonly QualityAdversarialCase[];
  manifest: QualityBenchmarkManifest;
}

export function createQualityBenchmarkDataset(input: {
  seed: number;
  sourceCommit: string;
  continuityTier: Exclude<ContinuityTier, "smoke">;
}): QualityBenchmarkDataset {
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) {
    throw new Error("SEED_INVALID");
  }
  if (!/^[a-f0-9]{7,64}$/u.test(input.sourceCommit)) {
    throw new Error("SOURCE_COMMIT_INVALID");
  }

  const continuityPlan = createContinuityPlan({
    seed: input.seed,
    tier: input.continuityTier,
  });
  const continuityFixture = generateContinuityFixture({
    plan: continuityPlan,
    sourceCommit: input.sourceCommit,
  });
  const chapterSamples = createChapterSamples(input.seed, input.sourceCommit);
  const adversarialCases = continuityFixture.defects.map((defect, index) =>
    toAdversarialCase(continuityFixture.digest.sha256, defect, index),
  );
  const manifestWithoutDigest = {
    schemaVersion: 1 as const,
    datasetVersion: QUALITY_BENCHMARK_GENERATOR_VERSION,
    rubricVersion: RELEASE_QUALITY_RUBRIC_VERSION,
    seed: input.seed,
    sourceCommit: input.sourceCommit,
    continuityTier: input.continuityTier,
    continuityFixtureSha256: continuityFixture.digest.sha256,
    chapterCount: continuityFixture.digest.chapterCount,
    volumeCount: continuityFixture.digest.volumeCount,
    chapterSampleCount: chapterSamples.length,
    adversarialCaseCount: adversarialCases.length,
    genres: QUALITY_BENCHMARK_GENRES,
    entries: [...chapterSamples, ...adversarialCases].map(toManifestEntry),
    decisionRequired: ["interRaterVarianceThreshold"],
  };
  const datasetSha256 = sha256Json({
    schemaVersion: 1,
    chapterSamples,
    adversarialCases,
    manifest: manifestWithoutDigest,
  });
  return {
    schemaVersion: 1,
    chapterSamples,
    adversarialCases,
    manifest: {
      ...manifestWithoutDigest,
      datasetSha256,
    },
  };
}

export function createApprovedQualityBenchmarkDataset(): QualityBenchmarkDataset {
  return createQualityBenchmarkDataset(APPROVED_QUALITY_BENCHMARK_INPUT);
}

export function verifyQualityBenchmarkDataset(dataset: QualityBenchmarkDataset): boolean {
  const { datasetSha256, ...manifestWithoutDigest } = dataset.manifest;
  return (
    datasetSha256 ===
    sha256Json({
      schemaVersion: dataset.schemaVersion,
      chapterSamples: dataset.chapterSamples,
      adversarialCases: dataset.adversarialCases,
      manifest: manifestWithoutDigest,
    })
  );
}

function createChapterSamples(seed: number, sourceCommit: string): QualityChapterSample[] {
  return QUALITY_BENCHMARK_GENRES.flatMap((genre, genreIndex) =>
    Array.from({ length: 60 }, (_, index) => {
      const difficulty = (["easy", "medium", "hard"] as const)[index % 3]!;
      const text = createChapterText(seed ^ Math.imul(genreIndex + 1, 0x9e3779b1), genre, index);
      const sourceVersion = "quality-chapter-sample-v1";
      const sourceHash = sha256Json({
        sourceCommit,
        sourceVersion,
        genre,
        difficulty,
        index,
        text,
      });
      return {
        id: `chapter:${genre}:${String(index + 1).padStart(3, "0")}`,
        kind: "chapter" as const,
        genre,
        difficulty,
        title: `${genre}基准样本 ${String(index + 1).padStart(3, "0")}`,
        text,
        sourceVersion,
        sourceHash,
        knownIssues: knownIssuesForDifficulty(difficulty, index),
      };
    }),
  );
}

function createChapterText(seed: number, genre: QualityBenchmarkGenre, index: number): string {
  const random = mulberry32(seed);
  const sceneByGenre: Record<QualityBenchmarkGenre, readonly string[]> = {
    仙侠: [
      "山门钟声响过三遍，沈砚仍没有等到师兄的回信。",
      "剑阵在雨后显出暗纹，守山弟子却发现少了一枚阵眼。",
      "藏经阁的灯忽明忽暗，旧卷上多出一行陌生批注。",
    ],
    历史: [
      "驿马在雨后泥道上减速，军报比约定的时刻晚了半日。",
      "封地的粮册与官仓记录对不上，主簿却没有当场声张。",
      "城门将要落锁时，一名信使带着没有火漆的密函抵达。",
    ],
    都市: [
      "会议室的投影停在最后一页，持股比例与公开资料不一致。",
      "调查组刚结束访谈，楼下的人却已经知道了问话内容。",
      "旧手机里留着一段录音，时间戳早于公司与项目立项。",
    ],
  };
  const phrases = sceneByGenre[genre];
  const paragraphs = [phrases[index % phrases.length]!, phrases[(index + 1) % phrases.length]!];
  while (paragraphs.join("").length < 180) {
    paragraphs.push(phrases[Math.floor(random() * phrases.length)]!);
  }
  return paragraphs.join("");
}

function knownIssuesForDifficulty(
  difficulty: QualityDifficulty,
  index: number,
): readonly QualityKnownIssue[] {
  if (difficulty === "easy") {
    return [];
  }
  if (difficulty === "medium") {
    return [
      {
        code: "WEAK_CHAPTER_END_HOOK",
        severity: "P2",
        description: `medium sample ${index + 1} ends without a decisive hook`,
      },
    ];
  }
  return [
    {
      code: "MOTIVATION_BREAK",
      severity: "P1",
      description: `hard sample ${index + 1} contains a motivation discontinuity`,
    },
  ];
}

function toAdversarialCase(
  fixtureSha256: string,
  defect: {
    id: string;
    family: string;
    severity: ContinuitySeverity;
    chapterNumber: number;
    branchId: string;
    description: string;
    evidence: string;
    sourceFactId: string;
    versionNodeId: string;
  },
  index: number,
): QualityAdversarialCase {
  const difficulty: QualityDifficulty =
    defect.severity === "P0" ? "hard" : defect.severity === "P1" ? "medium" : "easy";
  return {
    id: `long-horizon:${defect.id}`,
    kind: "long_horizon_case",
    genre: "仙侠",
    difficulty,
    title: `长线连续性对抗样本 ${index + 1}`,
    text: defect.evidence,
    sourceVersion: "continuity-benchmark-v1",
    sourceHash: fixtureSha256,
    knownIssues: [
      {
        code: defect.family,
        severity: defect.severity,
        description: defect.description,
      },
    ],
    family: defect.family,
    chapterNumber: defect.chapterNumber,
    branchId: defect.branchId,
    sourceFactId: defect.sourceFactId,
    versionNodeId: defect.versionNodeId,
  };
}

function toManifestEntry(
  sample: QualityChapterSample | QualityAdversarialCase,
): QualityDatasetManifestEntry {
  return {
    id: sample.id,
    kind: sample.kind,
    genre: sample.genre,
    difficulty: sample.difficulty,
    sourceVersion: sample.sourceVersion,
    sourceHash: sample.sourceHash,
    knownIssues: sample.knownIssues,
  };
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}
