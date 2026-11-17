import { createHash } from "node:crypto";

export type BenchmarkTier = "smoke" | "growth" | "full" | "boundary" | "recovery";
export type BenchmarkTopology = "mid" | "boundary";

export interface BenchmarkTopologySummary {
  chapterCount: number;
  volumeCount: number;
  chaptersPerVolume: number;
  logicalCharacters: number;
  minChapterCharacters: number;
  maxChapterCharacters: number;
}

export interface BenchmarkPlan {
  generatorVersion: "capacity-benchmark-v1";
  seed: number;
  tier: BenchmarkTier;
  topologyName: BenchmarkTopology;
  topology: BenchmarkTopologySummary;
  branchCount: number | null;
  growthPercent: number | null;
  certificationEligible: boolean;
  chapterLengths: readonly number[];
  decisionRequired: readonly string[];
}

export interface BenchmarkPlanOptions {
  seed: number;
  tier: BenchmarkTier;
  topology: BenchmarkTopology;
  branchCount?: number;
  growthPercent?: number;
  chapterCount?: number;
  volumeCount?: number;
  logicalCharacters?: number;
  minChapterCharacters?: number;
  maxChapterCharacters?: number;
}

export interface ManuscriptDigest {
  logicalCharacters: number;
  utf8Bytes: number;
  chapterCount: number;
  sha256: string;
}

const FULL_TOPOLOGY = {
  chapterCount: 3_500,
  volumeCount: 35,
  logicalCharacters: 10_000_000,
} as const;

const BOUNDARY_TOPOLOGY = {
  chapterCount: 4_000,
  volumeCount: 40,
  logicalCharacters: 10_000_000,
} as const;

const SMOKE_TOPOLOGY = {
  chapterCount: 12,
  volumeCount: 3,
  logicalCharacters: 30_000,
} as const;

const PHRASES = [
  "山雨落在旧城的青瓦上，沈砚沿着石阶向北走。",
  "顾青握着剑，听见风里传来遥远的钟声。",
  "灯笼在长街尽头摇晃，纸上的字迹被雨慢慢晕开。",
  "他们走进荒寺，门后的灰尘像雪一样落下来。",
  "旧信里藏着一条被涂改的时间线，没有人敢先开口。",
  "河面浮着薄雾，岸边的石碑刻着陌生的年号。",
  "沈砚停住脚步，看见自己的影子比夜色更长。",
  "远处有人低声念经，声音像从很深的水底传来。",
  "铜环敲在剑鞘上，一下又一下，像是在替谁数着时辰。",
  "城门还没有开，守夜人却已经换了第三班。",
] as const;

export function createBenchmarkPlan(options: BenchmarkPlanOptions): BenchmarkPlan {
  if (!Number.isSafeInteger(options.seed)) {
    throw new Error("SEED_INVALID");
  }
  const base = baseTopology(options);
  const growthPercent = options.tier === "growth" ? (options.growthPercent ?? 10) : null;
  const scale = growthPercent === null ? 1 : growthPercent / 100;
  const chapterCount = options.chapterCount ?? scaledCount(base.chapterCount, scale);
  const volumeCount =
    options.volumeCount ?? (scale === 1 ? base.volumeCount : scaledCount(base.volumeCount, scale));
  const logicalCharacters =
    options.logicalCharacters ??
    (scale === 1 ? base.logicalCharacters : Math.round(base.logicalCharacters * scale));
  const minChapterCharacters = options.minChapterCharacters ?? 2_500;
  const maxChapterCharacters = options.maxChapterCharacters ?? 3_500;

  if (
    !Number.isSafeInteger(chapterCount) ||
    chapterCount <= 0 ||
    !Number.isSafeInteger(volumeCount) ||
    volumeCount <= 0 ||
    !Number.isSafeInteger(logicalCharacters) ||
    logicalCharacters <= 0
  ) {
    throw new Error("TOPOLOGY_INVALID");
  }
  if (minChapterCharacters <= 0 || maxChapterCharacters < minChapterCharacters) {
    throw new Error("CHAPTER_CHARACTER_RANGE_INVALID");
  }
  if (logicalCharacters > chapterCount * maxChapterCharacters) {
    throw new Error("CHAPTER_CHARACTER_CAPACITY_EXCEEDED");
  }
  if (logicalCharacters < chapterCount * minChapterCharacters) {
    throw new Error("CHAPTER_CHARACTER_CAPACITY_UNDERFLOW");
  }
  if (chapterCount < volumeCount) {
    throw new Error("VOLUME_TOPOLOGY_INVALID");
  }

  const canonical =
    options.tier === "full" || options.tier === "boundary" || options.tier === "recovery";
  if (canonical && typeof options.branchCount !== "number") {
    throw new Error("BRANCH_COUNT_DECISION_REQUIRED");
  }
  if (
    options.branchCount !== undefined &&
    (!Number.isSafeInteger(options.branchCount) || options.branchCount < 0)
  ) {
    throw new Error("BRANCH_COUNT_INVALID");
  }

  const chaptersPerVolume = chapterCount / volumeCount;
  if (
    canonical &&
    (chaptersPerVolume < 80 || chaptersPerVolume > 120 || !Number.isInteger(chaptersPerVolume))
  ) {
    throw new Error("VOLUME_TOPOLOGY_INVALID");
  }

  const decisionRequired: string[] = [];
  if (options.branchCount === undefined) {
    decisionRequired.push("branchCount");
  }

  return {
    generatorVersion: "capacity-benchmark-v1",
    seed: options.seed,
    tier: options.tier,
    topologyName: options.topology,
    topology: {
      chapterCount,
      volumeCount,
      chaptersPerVolume,
      logicalCharacters,
      minChapterCharacters,
      maxChapterCharacters,
    },
    branchCount: options.branchCount ?? null,
    growthPercent,
    certificationEligible:
      options.tier === "full" || options.tier === "boundary" || options.tier === "recovery",
    chapterLengths: distributeChapterLengths(options.seed, {
      chapterCount,
      logicalCharacters,
      minChapterCharacters,
      maxChapterCharacters,
    }),
    decisionRequired,
  };
}

export function benchmarkChapterContent(plan: BenchmarkPlan, chapterNumber: number): string {
  if (
    !Number.isSafeInteger(chapterNumber) ||
    chapterNumber < 1 ||
    chapterNumber > plan.topology.chapterCount
  ) {
    throw new Error("CHAPTER_NUMBER_OUT_OF_RANGE");
  }
  const targetLength = plan.chapterLengths[chapterNumber - 1];
  if (targetLength === undefined) {
    throw new Error("CHAPTER_LENGTH_MISSING");
  }
  const random = mulberry32(plan.seed ^ Math.imul(chapterNumber, 0x9e3779b1));
  let content = "";
  let phraseIndex = Math.floor(random() * PHRASES.length);
  while (content.length < targetLength) {
    const phrase = PHRASES[phraseIndex % PHRASES.length]!;
    const remaining = targetLength - content.length;
    content += phrase.length <= remaining ? phrase : phrase.slice(0, remaining);
    phraseIndex += 1 + Math.floor(random() * 3);
  }
  return content;
}

export function digestBenchmarkManuscript(plan: BenchmarkPlan): ManuscriptDigest {
  const hash = createHash("sha256");
  let logicalCharacters = 0;
  let utf8Bytes = 0;
  for (let chapterNumber = 1; chapterNumber <= plan.topology.chapterCount; chapterNumber += 1) {
    const content = benchmarkChapterContent(plan, chapterNumber);
    const codePoints = Array.from(content).length;
    logicalCharacters += codePoints;
    utf8Bytes += Buffer.byteLength(content, "utf8");
    hash.update(chapterNumber.toString());
    hash.update("\0");
    hash.update(content);
    hash.update("\u0001");
  }
  return {
    logicalCharacters,
    utf8Bytes,
    chapterCount: plan.topology.chapterCount,
    sha256: hash.digest("hex"),
  };
}

function baseTopology(options: BenchmarkPlanOptions): {
  chapterCount: number;
  volumeCount: number;
  logicalCharacters: number;
} {
  if (options.tier === "full" || options.tier === "growth" || options.tier === "recovery") {
    return options.topology === "boundary" ? BOUNDARY_TOPOLOGY : FULL_TOPOLOGY;
  }
  if (options.tier === "boundary") {
    return BOUNDARY_TOPOLOGY;
  }
  return SMOKE_TOPOLOGY;
}

function scaledCount(value: number, scale: number): number {
  return Math.max(1, Math.ceil(value * scale));
}

function distributeChapterLengths(
  seed: number,
  input: {
    chapterCount: number;
    logicalCharacters: number;
    minChapterCharacters: number;
    maxChapterCharacters: number;
  },
): number[] {
  const minimumTotal = input.chapterCount * input.minChapterCharacters;
  const extraTotal = input.logicalCharacters - minimumTotal;
  const baseExtra = Math.floor(extraTotal / input.chapterCount);
  const remainder = extraTotal % input.chapterCount;
  const lengths = Array.from(
    { length: input.chapterCount },
    (_, index) => input.minChapterCharacters + baseExtra + (index < remainder ? 1 : 0),
  );
  if (lengths.some((length) => length > input.maxChapterCharacters)) {
    throw new Error("CHAPTER_CHARACTER_CAPACITY_EXCEEDED");
  }

  // Rotate the remainder so chapter boundaries differ across seeds without changing totals.
  const rotation = seed % input.chapterCount;
  return lengths.map((_, index) => lengths[(index + rotation) % lengths.length]!);
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
