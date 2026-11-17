import { createHash } from "node:crypto";

export interface BenchmarkFixtureIds {
  userId: string;
  penNameId: string;
  modelConfigId: string;
  sessionId: string;
  workId: string;
  mainBranchId: string;
  branchIds: string[];
}

export function createBenchmarkFixtureIds(
  seed: number,
  parallelBranchCount: number,
): BenchmarkFixtureIds {
  return {
    userId: deterministicUuid(seed, "user"),
    penNameId: deterministicUuid(seed, "pen-name"),
    modelConfigId: deterministicUuid(seed, "model-config"),
    sessionId: deterministicUuid(seed, "session"),
    workId: deterministicUuid(seed, "work"),
    mainBranchId: deterministicUuid(seed, "branch:main"),
    branchIds: Array.from({ length: parallelBranchCount }, (_, index) =>
      deterministicUuid(seed, `branch:${index + 1}`),
    ),
  };
}

export function benchmarkSessionToken(seed: number): string {
  return createHash("sha256").update(`capacity-session:${seed}`).digest("hex");
}

export function benchmarkCsrfToken(seed: number): string {
  return createHash("sha256").update(`capacity-csrf:${seed}`).digest("hex");
}

export function deterministicUuid(seed: number, namespace: string): string {
  const hash = createHash("sha256").update(`${seed}:${namespace}`).digest("hex");
  const chars = hash.slice(0, 32).split("");
  chars[12] = "7";
  const variant = Number.parseInt(chars[16]!, 16);
  chars[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(
    16,
    20,
  )}-${value.slice(20)}`;
}
