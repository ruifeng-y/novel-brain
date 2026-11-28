import { createHash } from "node:crypto";

import {
  blueprintAcknowledgementSchema,
  blueprintDraftSchema,
  type BlueprintAcknowledgement,
  type BlueprintCoreSettingDraft,
  type BlueprintDraft,
  type BlueprintDraftPatchOperation,
  type BlueprintOutlineDraft,
  type BlueprintStoryBibleDraft,
} from "@novel-brain/contracts";

export interface EditableBlueprintDraft {
  storyBible: BlueprintStoryBibleDraft;
  coreSettings: BlueprintCoreSettingDraft[];
  outline: BlueprintOutlineDraft;
  acknowledgements: BlueprintAcknowledgement[];
}

export type DraftPatchResult =
  | {
      ok: true;
      draft: BlueprintDraft;
      acknowledgements: BlueprintAcknowledgement[];
      draftHash: string;
    }
  | { ok: false; reason: "invalid_patch" | "required_removal" };

export function applyDraftPatch(
  draft: BlueprintDraft,
  acknowledgements: BlueprintAcknowledgement[],
  operations: BlueprintDraftPatchOperation[],
): DraftPatchResult {
  const root: Record<string, unknown> = {
    ...structuredClone(draft),
    acknowledgements: structuredClone(acknowledgements),
  };
  for (const operation of operations) {
    if (isForbiddenPatch(operation)) {
      return { ok: false, reason: "invalid_patch" };
    }
    if (isRequiredCoreSettingRemoval(root, operation)) {
      return { ok: false, reason: "required_removal" };
    }
    if (!applyOperation(root, operation)) {
      return { ok: false, reason: "invalid_patch" };
    }
  }
  const parsedDraft = blueprintDraftSchema.safeParse({
    storyBible: root.storyBible,
    coreSettings: root.coreSettings,
    outline: root.outline,
  });
  const parsedAcknowledgements = blueprintAcknowledgementSchema
    .array()
    .max(500)
    .safeParse(root.acknowledgements);
  if (!parsedDraft.success || !parsedAcknowledgements.success) {
    return { ok: false, reason: "invalid_patch" };
  }
  return {
    ok: true,
    draft: parsedDraft.data,
    acknowledgements: parsedAcknowledgements.data,
    draftHash: blueprintDraftHash(parsedDraft.data, parsedAcknowledgements.data),
  };
}

export function blueprintDraftHash(
  draft: BlueprintDraft,
  acknowledgements: BlueprintAcknowledgement[],
): string {
  return createHash("sha256").update(stableStringify({ draft, acknowledgements })).digest("hex");
}

function isForbiddenPatch(operation: BlueprintDraftPatchOperation): boolean {
  const segments = parsePointer(operation.path);
  if (!segments) {
    return true;
  }
  if (segments.length === 1 && ["storyBible", "coreSettings", "outline"].includes(segments[0]!)) {
    return true;
  }
  if (
    (segments[0] === "storyBible" && segments[1] === "cards" && segments.length === 2) ||
    (segments[0] === "outline" &&
      ["nodes", "volumeContracts", "sceneCards"].includes(segments[1] ?? "") &&
      segments.length === 2)
  ) {
    return true;
  }
  if (
    operation.op === "replace" &&
    ((segments[0] === "storyBible" && segments[1] === "cards" && segments.length === 3) ||
      (segments[0] === "coreSettings" && segments.length === 2) ||
      (segments[0] === "outline" &&
        ["nodes", "volumeContracts", "sceneCards"].includes(segments[1] ?? "") &&
        segments.length === 3))
  ) {
    return true;
  }
  if (operation.op === "remove" && segments[0] === "storyBible" && segments[1] === "cards") {
    return true;
  }
  if (
    segments[0] === "storyBible" &&
    segments[1] === "cards" &&
    segments.length >= 4 &&
    segments[3] === "key"
  ) {
    return true;
  }
  if (
    segments[0] === "coreSettings" &&
    segments.length >= 3 &&
    ["candidateId", "type", "source", "required"].includes(segments[2] ?? "")
  ) {
    return true;
  }
  if (
    segments[0] === "outline" &&
    segments[1] === "nodes" &&
    segments.length >= 4 &&
    ["id", "parentId", "level"].includes(segments[3] ?? "")
  ) {
    return true;
  }
  return (
    segments[0] === "outline" &&
    ["volumeContracts", "sceneCards"].includes(segments[1] ?? "") &&
    segments.length >= 4 &&
    segments[3] === "nodeId"
  );
}

function isRequiredCoreSettingRemoval(
  root: Record<string, unknown>,
  operation: BlueprintDraftPatchOperation,
): boolean {
  if (operation.op !== "remove") {
    return false;
  }
  const segments = parsePointer(operation.path);
  if (segments?.length !== 2 || segments[0] !== "coreSettings") {
    return false;
  }
  const index = Number(segments[1]);
  const settings = root.coreSettings;
  return (
    Number.isInteger(index) &&
    Array.isArray(settings) &&
    Boolean((settings[index] as { required?: unknown } | undefined)?.required)
  );
}

function applyOperation(
  root: Record<string, unknown>,
  operation: BlueprintDraftPatchOperation,
): boolean {
  const segments = parsePointer(operation.path);
  if (!segments || segments.length === 0) {
    return false;
  }
  let parent: unknown = root;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(parent)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
        return false;
      }
      parent = parent[index];
      continue;
    }
    if (!parent || typeof parent !== "object") {
      return false;
    }
    const record = parent as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, segment)) {
      return false;
    }
    parent = record[segment];
  }
  const key = segments.at(-1)!;
  if (Array.isArray(parent)) {
    return applyArrayOperation(parent, key, operation);
  }
  if (!parent || typeof parent !== "object") {
    return false;
  }
  const record = parent as Record<string, unknown>;
  if (operation.op === "remove") {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      return false;
    }
    delete record[key];
    return true;
  }
  if (operation.op === "replace" && !Object.prototype.hasOwnProperty.call(record, key)) {
    return false;
  }
  record[key] = structuredClone(operation.value);
  return true;
}

function applyArrayOperation(
  parent: unknown[],
  key: string,
  operation: BlueprintDraftPatchOperation,
): boolean {
  if (key === "-" && operation.op === "add") {
    parent.push(structuredClone(operation.value));
    return true;
  }
  const index = Number(key);
  if (!Number.isInteger(index) || index < 0) {
    return false;
  }
  if (operation.op === "add") {
    if (index > parent.length) {
      return false;
    }
    parent.splice(index, 0, structuredClone(operation.value));
    return true;
  }
  if (index >= parent.length) {
    return false;
  }
  if (operation.op === "remove") {
    parent.splice(index, 1);
    return true;
  }
  parent[index] = structuredClone(operation.value);
  return true;
}

function parsePointer(path: string): string[] | null {
  if (!path.startsWith("/")) {
    return null;
  }
  const segments = path
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  return segments.some((segment) => ["__proto__", "prototype", "constructor"].includes(segment))
    ? null
    : segments;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}
