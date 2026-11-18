import { createHash } from "node:crypto";

import type {
  CharacterKnowledgeState,
  ContinuityDefect,
  ContinuityFact,
  ContinuityFixture,
} from "./fixture";
import {
  continuityScenarioMetadata,
  type ContinuityScenarioFamily,
  type ContinuitySeverity,
} from "./plan";
import {
  reviewStrata,
  volumeNumberForChapter,
  volumePositionFor,
  type VolumePosition,
} from "./strata";

export type ReviewStratum = VolumePosition;

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
  for (const stratum of reviewStrata) {
    const candidates = fixture.defects
      .filter(
        (defect) =>
          volumePositionFor(
            fixture.plan.volumeCount,
            volumeNumberForChapter(fixture.plan.chaptersPerVolume, defect.chapterNumber),
          ) === stratum,
      )
      .sort((left, right) =>
        deterministicOrder(fixture, left).localeCompare(deterministicOrder(fixture, right)),
      );
    if (candidates.length < samplesPerStratum) {
      throw new Error("INSUFFICIENT_STRATIFIED_SAMPLES");
    }
    const orderedCandidates = [...candidates].sort(
      (left, right) =>
        samplingPriority(right.family) - samplingPriority(left.family) ||
        deterministicOrder(fixture, left).localeCompare(deterministicOrder(fixture, right)),
    );
    const selected: ContinuityDefect[] = [];
    for (const candidate of orderedCandidates) {
      if (selected.length >= samplesPerStratum) {
        break;
      }
      if (
        !selected.some((selectedDefect) => selectedDefect.chapterNumber === candidate.chapterNumber)
      ) {
        selected.push(candidate);
      }
    }
    if (selected.length < samplesPerStratum) {
      throw new Error("INSUFFICIENT_UNIQUE_STRATIFIED_CHAPTERS");
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
  for (const stratum of reviewStrata) {
    for (const defect of defectsByStratum.get(stratum) ?? []) {
      const chapter = fixture.chapters.find(
        (candidate) => candidate.number === defect.chapterNumber,
      );
      if (!chapter) {
        throw new Error("DEFECT_CHAPTER_MISSING");
      }
      const branch = fixture.branches.find((candidate) => candidate.id === defect.branchId);
      if (!branch) {
        throw new Error("DEFECT_BRANCH_MISSING");
      }
      const reviewId = `review-${defect.id}`;
      const visibleFacts = fixture.facts.filter((fact) =>
        isVisibleAtChapter(fixture, fact, chapter.number, chapter.povCharacterId, branch.id),
      );
      const approvedFacts = visibleFacts
        .filter(
          (fact) =>
            fact.visibility === "public" &&
            fact.objectiveCanon &&
            (fact.decisionState === "confirmed" || fact.decisionState === "locked"),
        )
        .map(toReviewFact);
      const knownStates = fixture.knowledgeStates
        .filter(
          (state) =>
            state.characterId === chapter.povCharacterId &&
            isSharedOrSameBranch(fixture, state.branchId, branch.id, chapter.number) &&
            state.validFromChapter <= chapter.number &&
            (state.validToChapter === null || state.validToChapter >= chapter.number) &&
            (state.allowedDisclosureFromChapter === null ||
              state.allowedDisclosureFromChapter <= chapter.number),
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
              isSharedOrSameBranch(fixture, fact.branchId, branch.id, chapter.number) &&
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

export function verifyBlindReviewPacket(packet: BlindReviewPacket): boolean {
  const { packetSha256, ...packetWithoutHash } = packet;
  return packetSha256 === sha256(packetWithoutHash);
}

export function verifyBlindReviewOracle(oracle: BlindReviewOracle): boolean {
  const { oracleSha256, ...oracleWithoutHash } = oracle;
  return oracleSha256 === sha256(oracleWithoutHash);
}

function isVisibleAtChapter(
  fixture: ContinuityFixture,
  fact: ContinuityFact,
  chapterNumber: number,
  povCharacterId: string,
  branchId: string,
): boolean {
  if (
    fact.validFromChapter > chapterNumber ||
    (fact.validToChapter !== null && fact.validToChapter < chapterNumber)
  ) {
    return false;
  }
  if (!isSharedOrSameBranch(fixture, fact.branchId, branchId, chapterNumber)) {
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

function isSharedOrSameBranch(
  fixture: ContinuityFixture,
  objectBranchId: string,
  targetBranchId: string,
  chapterNumber: number,
): boolean {
  if (objectBranchId === targetBranchId) {
    return true;
  }
  const mainBranchId = fixture.branches[0]?.id;
  const targetBranch = fixture.branches.find((branch) => branch.id === targetBranchId);
  return (
    objectBranchId === mainBranchId &&
    targetBranch?.divergenceChapter !== null &&
    targetBranch?.divergenceChapter !== undefined &&
    chapterNumber <= targetBranch.divergenceChapter
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

function samplingPriority(family: ContinuityScenarioFamily): number {
  if (family === "false_alarm" || family === "incomplete_context") {
    return 0;
  }
  return continuityScenarioMetadata[family].samplingPriority;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
