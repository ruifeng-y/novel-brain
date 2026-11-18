import type { ProviderReleaseRuntime } from "@novel-brain/contracts";

export {
  DEFAULT_CONTEXT_COMPILER_VERSION,
  DEFAULT_WRITING_PROMPT_VERSION,
  SUPPORTED_CONTEXT_COMPILER_VERSIONS,
  WRITING_PROMPT_BUNDLE_HASHES,
  WRITING_PROMPT_BUNDLES,
  resolveWritingRelease,
} from "@novel-brain/ai";

export function releaseProviderRuntime(releasePin: ProviderReleaseRuntime | undefined): {
  timeoutMs?: number;
} {
  return releasePin
    ? {
        timeoutMs: Math.max(1, Math.floor(Math.min(releasePin.timeoutMs, releasePin.maxLatencyMs))),
      }
    : {};
}
