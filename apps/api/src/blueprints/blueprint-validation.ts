import {
  blueprintAcknowledgementSchema,
  blueprintDraftSchema,
  type BlueprintAcknowledgement,
  type BlueprintConflict,
  type BlueprintDraft,
  type BlueprintMissingField,
} from "@novel-brain/contracts";
import { validateBlueprintCandidates } from "@novel-brain/core";

type ValidationFailureCode =
  "p0_conflict" | "required_field_missing" | "acknowledgement_mismatch" | "invalid_draft";

export type BlueprintConfirmationValidation =
  | {
      ok: true;
      draft: BlueprintDraft;
      acknowledgements: BlueprintAcknowledgement[];
      missingFields: BlueprintMissingField[];
      conflicts: BlueprintConflict[];
    }
  | {
      ok: false;
      code: ValidationFailureCode;
      details: Record<string, unknown>;
    };

export function validateBlueprintForConfirmation(input: {
  storyBibleDraft: unknown;
  coreSettingsDraft: unknown;
  outlineDraft: unknown;
  storedAcknowledgements: unknown;
  submittedAcknowledgements: BlueprintAcknowledgement[];
  generationGuidance: Record<string, unknown>;
  genrePackFields: Record<string, unknown>;
  optionalGenrePackFields?: Record<string, unknown>;
  genre: string;
  scaleTarget: string;
}): BlueprintConfirmationValidation {
  const draft = blueprintDraftSchema.safeParse({
    storyBible: input.storyBibleDraft,
    coreSettings: input.coreSettingsDraft,
    outline: input.outlineDraft,
  });
  const storedAcknowledgements = blueprintAcknowledgementSchema
    .array()
    .safeParse(input.storedAcknowledgements);
  if (!draft.success || !storedAcknowledgements.success) {
    return {
      ok: false,
      code: "invalid_draft",
      details: { reason: "Blueprint confirmation data is malformed" },
    };
  }
  const { missingFields, conflicts } = validateBlueprintCandidates({
    ...draft.data,
    generationGuidance: input.generationGuidance,
    genrePackFields: input.genrePackFields,
    optionalGenrePackFields: input.optionalGenrePackFields ?? {},
    genre: input.genre,
    scaleTarget: input.scaleTarget,
  });

  const p0 = unresolvedP0(conflicts);
  if (p0.length > 0) {
    return { ok: false, code: "p0_conflict", details: { conflicts: p0 } };
  }

  const acknowledgements = normalizedAcknowledgements(input.submittedAcknowledgements);
  if (!acknowledgements) {
    return {
      ok: false,
      code: "acknowledgement_mismatch",
      details: { reason: "Acknowledgement field keys must be unique" },
    };
  }
  if (
    acknowledgementSignature(acknowledgements) !==
    acknowledgementSignature(storedAcknowledgements.data)
  ) {
    return {
      ok: false,
      code: "acknowledgement_mismatch",
      details: { reason: "Submitted acknowledgements do not match the reviewed draft" },
    };
  }

  const missingRequired = unresolvedRequiredFields(
    missingFields,
    storedAcknowledgements.data,
    input.genre,
  );
  if (missingRequired.length > 0) {
    return {
      ok: false,
      code: "required_field_missing",
      details: { fields: missingRequired },
    };
  }

  const draftIssue = invalidConfirmedDraft(draft.data);
  if (draftIssue) {
    return { ok: false, code: "invalid_draft", details: { reason: draftIssue } };
  }

  return {
    ok: true,
    draft: draft.data,
    acknowledgements: storedAcknowledgements.data,
    missingFields,
    conflicts,
  };
}

function unresolvedP0(conflicts: BlueprintConflict[]): BlueprintConflict[] {
  return conflicts.filter(
    (conflict) => conflict.severity === "P0" && conflict.status !== "resolved",
  );
}

function unresolvedRequiredFields(
  missingFields: BlueprintMissingField[],
  acknowledgements: BlueprintAcknowledgement[],
  genre: string,
): BlueprintMissingField[] {
  const acknowledged = new Set(
    acknowledgements
      .filter((acknowledgement) => acknowledgement.reason.trim().length >= 2)
      .map((acknowledgement) => acknowledgement.fieldKey),
  );
  return missingFields.filter((field) => {
    if (!field.required) {
      return false;
    }
    const waivable =
      field.key.startsWith("genre_pack:") ||
      (field.key === "core_setting:golden_finger" && genre !== "xianxia");
    return !waivable || !acknowledged.has(field.key);
  });
}

function normalizedAcknowledgements(
  acknowledgements: BlueprintAcknowledgement[],
): BlueprintAcknowledgement[] | null {
  const keys = acknowledgements.map((acknowledgement) => acknowledgement.fieldKey);
  if (new Set(keys).size !== keys.length) {
    return null;
  }
  return [...acknowledgements].sort((left, right) => left.fieldKey.localeCompare(right.fieldKey));
}

export function acknowledgementSignature(acknowledgements: BlueprintAcknowledgement[]): string {
  return JSON.stringify(
    [...acknowledgements]
      .sort((left, right) => left.fieldKey.localeCompare(right.fieldKey))
      .map((acknowledgement) => [
        acknowledgement.fieldKey,
        acknowledgement.decision,
        acknowledgement.reason,
      ]),
  );
}

function invalidConfirmedDraft(draft: BlueprintDraft): string | null {
  if (draft.storyBible.cards.some((card) => !card.complete || card.content.trim().length === 0)) {
    return "All nine story-bible cards must be complete and non-empty";
  }
  const settingTypes = new Set(draft.coreSettings.map((candidate) => candidate.type));
  const requiredTypes = [
    "world_rule",
    "character",
    "faction",
    "map",
    "power_system",
    "item",
    "timeline_event",
  ] as const;
  const missingTypes = requiredTypes.filter((type) => !settingTypes.has(type));
  if (missingTypes.length > 0) {
    return `Missing required core settings: ${missingTypes.join(", ")}`;
  }

  const nodes = draft.outline.nodes;
  const roots = nodes.filter((node) => node.level === "book");
  if (roots.length !== 1 || roots[0]?.parentId !== null) {
    return "Outline must have exactly one book root";
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const expectedParents: Record<string, string | null> = {
    book: null,
    volume: "book",
    act: "volume",
    chapter: "act",
    scene: "chapter",
  };
  for (const node of nodes) {
    const expectedParentLevel = expectedParents[node.level];
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (
      (expectedParentLevel === null && node.parentId !== null) ||
      (expectedParentLevel !== null && parent?.level !== expectedParentLevel)
    ) {
      return `Outline node ${node.title} has an invalid parent`;
    }
  }
  if (nodes.some((node) => node.status !== "planned")) {
    return "Confirmed blueprint outline nodes must remain planned";
  }

  const chapters = nodes.filter((node) => node.level === "chapter");
  const scenes = nodes.filter((node) => node.level === "scene");
  const chapterNumbers = chapters
    .map((chapter) => chapter.chapterNumber)
    .sort((left, right) => (left ?? 0) - (right ?? 0));
  if (
    chapters.some((chapter) => chapter.chapterNumber === null || chapter.brief === null) ||
    chapterNumbers.some((number, index) => number !== index + 1)
  ) {
    return "Chapters need continuous numbers and complete briefs";
  }
  if (
    chapters.some((chapter) => scenes.filter((scene) => scene.parentId === chapter.id).length < 2)
  ) {
    return "Each chapter requires at least two scenes";
  }
  const openingChapters = chapters.filter((chapter) => (chapter.chapterNumber ?? 0) <= 12);
  if (!openingChapters.some((chapter) => Boolean(chapter.hook))) {
    return "The opening chapters need a hook";
  }
  if (!openingChapters.some((chapter) => Boolean(chapter.foreshadow))) {
    return "The opening chapters need a foreshadow";
  }

  const contractNodeIds = new Set(draft.outline.volumeContracts.map((contract) => contract.nodeId));
  if (
    nodes
      .filter((node) => node.level === "volume")
      .some((volume) => !contractNodeIds.has(volume.id))
  ) {
    return "Every volume requires a volume contract";
  }
  const sceneCardNodeIds = new Set(draft.outline.sceneCards.map((card) => card.nodeId));
  if (scenes.some((scene) => !sceneCardNodeIds.has(scene.id))) {
    return "Every scene requires a scene card";
  }
  return null;
}
