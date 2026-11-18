import { createHash } from "node:crypto";

import { providerReleaseRuntimeSchema, type ProviderReleaseRuntime } from "@novel-brain/contracts";

export const DEFAULT_CONTEXT_COMPILER_VERSION = "m1-context-v0" as const;
export const DEFAULT_WRITING_PROMPT_VERSION = "m1-writing-prompts-v0" as const;
export const SUPPORTED_CONTEXT_COMPILER_VERSIONS = ["m1-context-v0", "m1-context-v1"] as const;

const LEGACY_PROMPTS = {
  draft: {
    instruction: "根据本章章纲起草完整章节。",
    system: "你是长篇仙侠小说写作助手。只输出本章正文。",
  },
  verify: {
    instruction: "检查草稿与章纲、已确认设定和必用事实是否一致。",
    system: "你是连续性与知识边界审校员。输出简短、确定的审校结论。",
  },
  revise: {
    instruction: "根据审校结论定向修订草稿，保留已满足的章纲和必用事实。",
    system: "你是定向修订编辑。只输出修订后的完整本章正文。",
  },
} as const;

const STRICT_PROMPTS = {
  draft: {
    instruction: "严格遵守已确认设定，根据本章章纲起草完整章节。",
    system: "你是长篇仙侠小说写作助手。遵守已确认设定，只输出本章正文。",
  },
  verify: {
    instruction: "只依据给定正史、章纲和必用事实检查草稿是否一致。",
    system: "你是连续性与知识边界审校员。只依据给定证据输出结论。",
  },
  revise: {
    instruction: "根据审校结论定向修订，保留正确内容且不得引入未确认正史。",
    system: "你是定向修订编辑。不得引入未确认正史，只输出修订后的完整正文。",
  },
} as const;

export const WRITING_PROMPT_BUNDLES = {
  "m1-writing-prompts-v0": LEGACY_PROMPTS,
  "m1-writing-prompts-v1": STRICT_PROMPTS,
} as const;

export const WRITING_PROMPT_BUNDLE_HASHES = {
  "m1-writing-prompts-v0": promptBundleHash(LEGACY_PROMPTS),
  "m1-writing-prompts-v1": promptBundleHash(STRICT_PROMPTS),
} as const;

export function resolveWritingRelease(input?: {
  promptVersion: string;
  promptHash: string;
  contextCompilerVersion: string;
}): {
  promptVersion: keyof typeof WRITING_PROMPT_BUNDLES;
  promptHash: string;
  contextCompilerVersion: (typeof SUPPORTED_CONTEXT_COMPILER_VERSIONS)[number];
  templates: (typeof WRITING_PROMPT_BUNDLES)[keyof typeof WRITING_PROMPT_BUNDLES];
} {
  const promptVersion = input?.promptVersion ?? DEFAULT_WRITING_PROMPT_VERSION;
  const contextCompilerVersion = input?.contextCompilerVersion ?? DEFAULT_CONTEXT_COMPILER_VERSION;
  if (
    !(promptVersion in WRITING_PROMPT_BUNDLES) ||
    !SUPPORTED_CONTEXT_COMPILER_VERSIONS.includes(
      contextCompilerVersion as (typeof SUPPORTED_CONTEXT_COMPILER_VERSIONS)[number],
    )
  ) {
    throw new Error("RELEASE_PROMPT_VERSION_UNSUPPORTED");
  }
  const version = promptVersion as keyof typeof WRITING_PROMPT_BUNDLES;
  const promptHash = WRITING_PROMPT_BUNDLE_HASHES[version];
  if (input && input.promptHash !== promptHash) {
    throw new Error("RELEASE_PROMPT_HASH_MISMATCH");
  }
  return {
    promptVersion: version,
    promptHash,
    contextCompilerVersion:
      contextCompilerVersion as (typeof SUPPORTED_CONTEXT_COMPILER_VERSIONS)[number],
    templates: WRITING_PROMPT_BUNDLES[version],
  };
}

export function releaseRuntimePinForSubject(
  evidence: Record<string, unknown>,
  subjectId: string,
): ProviderReleaseRuntime | undefined {
  if (evidence.action !== "canary" && evidence.action !== "rollback") {
    return undefined;
  }
  const cohort = evidence.cohort;
  if (
    !cohort ||
    typeof cohort !== "object" ||
    !("subjectIds" in cohort) ||
    !Array.isArray(cohort.subjectIds)
  ) {
    throw new Error("RELEASE_COHORT_INVALID");
  }
  if (!cohort.subjectIds.includes(subjectId)) {
    return undefined;
  }
  const parsed = providerReleaseRuntimeSchema.safeParse(evidence);
  if (!parsed.success) {
    throw new Error("RELEASE_PIN_INVALID");
  }
  const { pin, limits, releaseVersion } = parsed.data;
  if (
    !(pin.promptVersion in WRITING_PROMPT_BUNDLES) ||
    !SUPPORTED_CONTEXT_COMPILER_VERSIONS.includes(
      pin.contextCompilerVersion as (typeof SUPPORTED_CONTEXT_COMPILER_VERSIONS)[number],
    ) ||
    pin.promptHash !==
      WRITING_PROMPT_BUNDLE_HASHES[pin.promptVersion as keyof typeof WRITING_PROMPT_BUNDLE_HASHES]
  ) {
    throw new Error("RELEASE_PIN_INVALID");
  }
  return {
    releaseVersion,
    ...pin,
    ...limits,
  };
}

export function assertReleaseRuntimePinMatchesModelConfig(
  pin: ProviderReleaseRuntime | undefined,
  config: {
    provider: string;
    baseUrl: string;
  },
): void {
  if (!pin) {
    return;
  }
  if (
    config.provider !== pin.provider ||
    config.baseUrl.replace(/\/$/, "") !== pin.baseUrl.replace(/\/$/, "")
  ) {
    throw new Error("RELEASE_PIN_KEY_MISMATCH");
  }
}

function promptBundleHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
