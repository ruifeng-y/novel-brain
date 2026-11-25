import { sha256Json, sha256Text } from "./digest";
import type {
  CharacterKnowledgeState,
  ContinuityControl,
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
  expectedDisposition: "defect" | "no_defect" | "escalate";
  expectedDefectIds: readonly string[];
  controlIds: readonly string[];
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

const ORACLE_CONTENT_MARKERS = [
  /与已确认事实“[^”]+”冲突。/u,
  /【连续性证据】/u,
  /\bseeded defect\b/iu,
] as const;
const EXPLICIT_CONFIRMED_FACT_CONFLICT = /\s*与已确认事实“[^”]+”冲突。\s*$/u;

export function sanitizeBlindReviewText(text: string): string {
  return text.replace(EXPLICIT_CONFIRMED_FACT_CONFLICT, "").trimEnd();
}

export function blindReviewOracleContentMarkers(text: string): readonly string[] {
  return ORACLE_CONTENT_MARKERS.filter((pattern) => pattern.test(text)).map(
    (pattern) => pattern.source,
  );
}

export function buildContinuityBlindReviewPacket(input: {
  fixture: ContinuityFixture;
  samplesPerStratum: number;
}): { packet: BlindReviewPacket; oracle: BlindReviewOracle } {
  const { fixture, samplesPerStratum } = input;
  if (!Number.isSafeInteger(samplesPerStratum) || samplesPerStratum < 2) {
    throw new Error("BLIND_SAMPLE_COUNT_INVALID");
  }

  const defectsByStratum = new Map<ReviewStratum, ContinuityDefect[]>();
  const controlsByStratum = new Map<ReviewStratum, ContinuityControl[]>();
  const controlCount = Math.max(1, Math.floor(samplesPerStratum / 2));
  const defectCount = samplesPerStratum - controlCount;
  const usedChapterNumbers = new Set<number>();
  const seededDefectChapters = new Set(fixture.defects.map((defect) => defect.chapterNumber));
  for (const stratum of reviewStrata) {
    const defectCandidates = fixture.defects
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
    if (defectCandidates.length < defectCount) {
      throw new Error("INSUFFICIENT_STRATIFIED_SAMPLES");
    }
    const orderedDefects = [...defectCandidates].sort(
      (left, right) =>
        samplingPriority(right.family) - samplingPriority(left.family) ||
        deterministicOrder(fixture, left).localeCompare(deterministicOrder(fixture, right)),
    );
    const selectedDefects: ContinuityDefect[] = [];
    for (const candidate of orderedDefects) {
      if (selectedDefects.length >= defectCount) {
        break;
      }
      if (!usedChapterNumbers.has(candidate.chapterNumber)) {
        selectedDefects.push(candidate);
        usedChapterNumbers.add(candidate.chapterNumber);
      }
    }
    if (selectedDefects.length < defectCount) {
      throw new Error("INSUFFICIENT_UNIQUE_STRATIFIED_CHAPTERS");
    }
    defectsByStratum.set(
      stratum,
      selectedDefects.sort((left, right) =>
        deterministicOrder(fixture, left).localeCompare(deterministicOrder(fixture, right)),
      ),
    );

    const controlCandidates = fixture.controls
      .filter(
        (control) =>
          volumePositionFor(
            fixture.plan.volumeCount,
            volumeNumberForChapter(fixture.plan.chaptersPerVolume, control.chapterNumber),
          ) === stratum &&
          !usedChapterNumbers.has(control.chapterNumber) &&
          !seededDefectChapters.has(control.chapterNumber),
      )
      .sort((left, right) => {
        const preferredMode = stratum === "middle" ? "incomplete_context" : "false_alarm";
        return (
          Number(right.mode === preferredMode) - Number(left.mode === preferredMode) ||
          left.id.localeCompare(right.id)
        );
      });
    if (controlCandidates.length < controlCount) {
      throw new Error("INSUFFICIENT_STRATIFIED_CONTROLS");
    }
    const selectedControls = controlCandidates.slice(0, controlCount);
    for (const control of selectedControls) {
      usedChapterNumbers.add(control.chapterNumber);
    }
    controlsByStratum.set(stratum, selectedControls);
  }

  const packetItems: BlindReviewItem[] = [];
  const oracleItems: BlindReviewOracleItem[] = [];
  const appendItem = (inputItem: {
    reviewId: string;
    stratum: ReviewStratum;
    branchId: string;
    chapterNumber: number;
    volumeNumber: number;
    povCharacterId: string;
    candidateText: string;
    expectedDisposition: BlindReviewOracleItem["expectedDisposition"];
    expectedDefectIds: readonly string[];
    controlIds: readonly string[];
    expectedFamilies: readonly ContinuityScenarioFamily[];
    expectedSeverities: readonly ContinuitySeverity[];
  }): void => {
    const visibleFacts = fixture.facts.filter((fact) =>
      isVisibleAtChapter(
        fixture,
        fact,
        inputItem.chapterNumber,
        inputItem.povCharacterId,
        inputItem.branchId,
      ),
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
          state.characterId === inputItem.povCharacterId &&
          isSharedOrSameBranch(
            fixture,
            state.branchId,
            inputItem.branchId,
            inputItem.chapterNumber,
          ) &&
          state.validFromChapter <= inputItem.chapterNumber &&
          (state.validToChapter === null || state.validToChapter >= inputItem.chapterNumber) &&
          isKnowledgeStateDisclosable(fixture, state, inputItem.chapterNumber),
      )
      .map(toReviewKnowledgeState);
    packetItems.push({
      reviewId: inputItem.reviewId,
      stratum: inputItem.stratum,
      volumeNumber: inputItem.volumeNumber,
      chapterNumber: inputItem.chapterNumber,
      branchId: inputItem.branchId,
      povCharacterId: inputItem.povCharacterId,
      candidateText: sanitizeBlindReviewText(inputItem.candidateText),
      rubricVersion: fixture.plan.rubricVersion,
      reviewPrompt:
        "只依据给出的已确认设定与 POV 信息，判断候选片段是否出现连续性或知识边界问题；信息不足时必须选择升级复核。",
      povContext: {
        approvedFacts,
        knownStates,
      },
    });
    oracleItems.push({
      reviewId: inputItem.reviewId,
      expectedDisposition: inputItem.expectedDisposition,
      expectedDefectIds: inputItem.expectedDefectIds,
      controlIds: inputItem.controlIds,
      expectedFamilies: inputItem.expectedFamilies,
      expectedSeverities: inputItem.expectedSeverities,
      hiddenFactIds: fixture.facts
        .filter(
          (fact) =>
            fact.visibility === "hidden" &&
            isSharedOrSameBranch(
              fixture,
              fact.branchId,
              inputItem.branchId,
              inputItem.chapterNumber,
            ) &&
            !visibleFacts.some((visible) => visible.id === fact.id),
        )
        .map((fact) => fact.id),
    });
  };

  for (const stratum of reviewStrata) {
    for (const defect of defectsByStratum.get(stratum) ?? []) {
      const branch = fixture.branches.find((candidate) => candidate.id === defect.branchId);
      if (!branch) {
        throw new Error("DEFECT_BRANCH_MISSING");
      }
      const chapter =
        branch.id === fixture.branches[0]?.id
          ? fixture.chapters.find((candidate) => candidate.number === defect.chapterNumber)
          : fixture.branchChapters.find(
              (candidate) =>
                candidate.branchId === branch.id &&
                candidate.chapterNumber === defect.chapterNumber,
            );
      if (!chapter) {
        throw new Error("DEFECT_CHAPTER_MISSING");
      }
      appendItem({
        reviewId: `review-${defect.id}`,
        stratum,
        branchId: defect.branchId,
        chapterNumber: defect.chapterNumber,
        volumeNumber: chapter.volumeNumber,
        povCharacterId: chapter.povCharacterId,
        candidateText: chapter.content,
        expectedDisposition: "defect",
        expectedDefectIds: [defect.id],
        controlIds: [],
        expectedFamilies: [defect.family],
        expectedSeverities: [defect.severity],
      });
    }
    for (const control of controlsByStratum.get(stratum) ?? []) {
      const chapter = fixture.chapters.find(
        (candidate) => candidate.number === control.chapterNumber,
      );
      if (!chapter) {
        throw new Error("CONTROL_CHAPTER_MISSING");
      }
      appendItem({
        reviewId: `review-${control.id}`,
        stratum,
        branchId: control.branchId,
        chapterNumber: chapter.number,
        volumeNumber: chapter.volumeNumber,
        povCharacterId: chapter.povCharacterId,
        candidateText: chapter.content,
        expectedDisposition: control.mode === "incomplete_context" ? "escalate" : "no_defect",
        expectedDefectIds: [],
        controlIds: [control.id],
        expectedFamilies: [],
        expectedSeverities: [],
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

function isKnowledgeStateDisclosable(
  fixture: ContinuityFixture,
  state: CharacterKnowledgeState,
  chapterNumber: number,
): boolean {
  if (state.allowedDisclosureFromChapter !== null) {
    return state.allowedDisclosureFromChapter <= chapterNumber;
  }
  if (state.state === "unknown") {
    return true;
  }
  const fact = fixture.facts.find((candidate) => candidate.id === state.objectiveFactId);
  return fact?.visibility === "public";
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
      (state.validToChapter === null || state.validToChapter >= chapterNumber) &&
      isKnowledgeStateDisclosable(fixture, state, chapterNumber),
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
  return sha256Text(`${fixture.plan.seed}:${defect.id}`);
}

function samplingPriority(family: ContinuityScenarioFamily): number {
  if (family === "false_alarm" || family === "incomplete_context") {
    return 0;
  }
  return continuityScenarioMetadata[family].samplingPriority;
}

function sha256(value: unknown): string {
  return sha256Json(value);
}
