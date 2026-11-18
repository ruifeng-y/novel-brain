import { createHash } from "node:crypto";

import type {
  CharacterKnowledgeState,
  ContinuityDefect,
  ContinuityFact,
  ContinuityFixture,
} from "./fixture";
import type { ContinuityScenarioFamily, ContinuitySeverity } from "./plan";

export type ReviewStratum = "early" | "middle" | "late";

export interface BlindReviewPacket {
  schemaVersion: 1;
  fixtureSha256: string;
  rubricVersion: string;
  instructions: readonly string[];
  items: readonly BlindReviewItem[];
  packetSha256: string;
}

export interface BlindReviewItem {
  reviewId: string;
  stratum: ReviewStratum;
  volumeNumber: number;
  chapterNumber: number;
  branchId: string;
  povCharacterId: string;
  candidateText: string;
  rubricVersion: string;
  reviewPrompt: string;
  povContext: {
    approvedFacts: readonly ReviewFact[];
    knownStates: readonly ReviewKnowledgeState[];
  };
}

export interface BlindReviewOracle {
  schemaVersion: 1;
  fixtureSha256: string;
  items: readonly BlindReviewOracleItem[];
  oracleSha256: string;
}

export interface BlindReviewOracleItem {
  reviewId: string;
  expectedDefectIds: readonly string[];
  expectedFamilies: readonly ContinuityScenarioFamily[];
  expectedSeverities: readonly ContinuitySeverity[];
  hiddenFactIds: readonly string[];
}

interface ReviewFact {
  id: string;
  relation: string;
  object: string;
  validFromChapter: number;
}

interface ReviewKnowledgeState {
  objectiveFactId: string;
  state: CharacterKnowledgeState["state"];
  claimedContent: string | null;
  validFromChapter: number;
}

export function buildContinuityBlindReviewPacket(input: {
  fixture: ContinuityFixture;
  samplesPerStratum: number;
}): { packet: BlindReviewPacket; oracle: BlindReviewOracle } {
  const { fixture, samplesPerStratum } = input;
  if (!Number.isSafeInteger(samplesPerStratum) || samplesPerStratum <= 0) {
    throw new Error("BLIND_SAMPLE_COUNT_INVALID");
  }

  const defectsByStratum = new Map<ReviewStratum, ContinuityDefect[]>();
  for (const stratum of ["early", "middle", "late"] as const) {
    const candidates = fixture.defects
      .filter((defect) => stratumFor(fixture, defect.chapterNumber) === stratum)
      .sort((left, right) =>
        deterministicOrder(fixture, left).localeCompare(deterministicOrder(fixture, right)),
      );
    if (candidates.length < samplesPerStratum) {
      throw new Error("INSUFFICIENT_STRATIFIED_SAMPLES");
    }
    const priority = candidates.find((defect) =>
      [
        "knowledge_boundary",
        "identity_transition",
        "branch_divergence",
        "foreshadow_payoff",
      ].includes(defect.family),
    );
    const selected = priority ? [priority] : [];
    for (const candidate of candidates) {
      if (selected.length >= samplesPerStratum) {
        break;
      }
      if (!selected.includes(candidate)) {
        selected.push(candidate);
      }
    }
    defectsByStratum.set(
      stratum,
      selected.sort((left, right) =>
        deterministicOrder(fixture, left).localeCompare(deterministicOrder(fixture, right)),
      ),
    );
  }

  const packetItems: BlindReviewItem[] = [];
  const oracleItems: BlindReviewOracleItem[] = [];
  for (const stratum of ["early", "middle", "late"] as const) {
    for (const defect of defectsByStratum.get(stratum) ?? []) {
      const chapter = fixture.chapters.find(
        (candidate) => candidate.number === defect.chapterNumber,
      );
      if (!chapter) {
        throw new Error("DEFECT_CHAPTER_MISSING");
      }
      const reviewId = `review-${defect.id}`;
      const visibleFacts = fixture.facts.filter((fact) =>
        isVisibleAtChapter(fixture, fact, chapter.number, chapter.povCharacterId),
      );
      const approvedFacts = visibleFacts
        .filter((fact) => fact.visibility === "public")
        .map(toReviewFact);
      const knownStates = fixture.knowledgeStates
        .filter(
          (state) =>
            state.characterId === chapter.povCharacterId &&
            state.validFromChapter <= chapter.number &&
            (state.validToChapter === null || state.validToChapter >= chapter.number),
        )
        .map(toReviewKnowledgeState);
      packetItems.push({
        reviewId,
        stratum,
        volumeNumber: chapter.volumeNumber,
        chapterNumber: chapter.number,
        branchId: defect.branchId,
        povCharacterId: chapter.povCharacterId,
        candidateText: chapter.content,
        rubricVersion: fixture.plan.rubricVersion,
        reviewPrompt:
          "只依据给出的已确认设定与 POV 信息，判断候选片段是否出现连续性或知识边界问题；信息不足时必须选择升级复核。",
        povContext: {
          approvedFacts,
          knownStates,
        },
      });
      oracleItems.push({
        reviewId,
        expectedDefectIds: [defect.id],
        expectedFamilies: [defect.family],
        expectedSeverities: [defect.severity],
        hiddenFactIds: fixture.facts
          .filter(
            (fact) =>
              fact.visibility === "hidden" &&
              !visibleFacts.some((visible) => visible.id === fact.id),
          )
          .map((fact) => fact.id),
      });
    }
  }

  const packetWithoutHash = {
    schemaVersion: 1 as const,
    fixtureSha256: fixture.digest.sha256,
    rubricVersion: fixture.plan.rubricVersion,
    instructions: [
      "评分者不得查看 oracle、模型身份或未批准的作者隐藏真相。",
      "每个样本必须记录 rubric 分数、置信度与证据。",
      "跨评分者分歧由第三方按版本化规则裁决。",
    ],
    items: packetItems,
  };
  const oracleWithoutHash = {
    schemaVersion: 1 as const,
    fixtureSha256: fixture.digest.sha256,
    items: oracleItems,
  };
  return {
    packet: {
      ...packetWithoutHash,
      packetSha256: sha256(packetWithoutHash),
    },
    oracle: {
      ...oracleWithoutHash,
      oracleSha256: sha256(oracleWithoutHash),
    },
  };
}

function isVisibleAtChapter(
  fixture: ContinuityFixture,
  fact: ContinuityFact,
  chapterNumber: number,
  povCharacterId: string,
): boolean {
  if (
    fact.validFromChapter > chapterNumber ||
    (fact.validToChapter !== null && fact.validToChapter < chapterNumber)
  ) {
    return false;
  }
  if (fact.visibility === "public") {
    return true;
  }
  return fixture.knowledgeStates.some(
    (state) =>
      state.characterId === povCharacterId &&
      state.objectiveFactId === fact.id &&
      state.state !== "unknown" &&
      state.validFromChapter <= chapterNumber &&
      (state.validToChapter === null || state.validToChapter >= chapterNumber),
  );
}

function toReviewFact(fact: ContinuityFact): ReviewFact {
  return {
    id: fact.id,
    relation: fact.relation,
    object: fact.object,
    validFromChapter: fact.validFromChapter,
  };
}

function toReviewKnowledgeState(state: CharacterKnowledgeState): ReviewKnowledgeState {
  return {
    objectiveFactId: state.objectiveFactId,
    state: state.state,
    claimedContent: state.claimedContent,
    validFromChapter: state.validFromChapter,
  };
}

function deterministicOrder(fixture: ContinuityFixture, defect: ContinuityDefect): string {
  return createHash("sha256").update(`${fixture.plan.seed}:${defect.id}`).digest("hex");
}

function stratumFor(fixture: ContinuityFixture, chapterNumber: number): ReviewStratum {
  const ratio = chapterNumber / fixture.plan.chapterCount;
  if (ratio <= 1 / 3) {
    return "early";
  }
  if (ratio <= 2 / 3) {
    return "middle";
  }
  return "late";
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
