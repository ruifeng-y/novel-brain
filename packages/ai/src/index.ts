import { createHash } from "node:crypto";

import { requestPinnedHttps, validateProviderEndpoint } from "./provider-endpoint";

export { decryptApiKey, encryptApiKey, maskApiKey } from "./model-config-crypto";
export {
  isPublicProviderAddress,
  ProviderEndpointValidationError,
  requestPinnedHttps,
  validateProviderEndpoint,
} from "./provider-endpoint";
export {
  DEFAULT_CONTEXT_COMPILER_VERSION,
  DEFAULT_WRITING_PROMPT_VERSION,
  SUPPORTED_CONTEXT_COMPILER_VERSIONS,
  WRITING_PROMPT_BUNDLE_HASHES,
  WRITING_PROMPT_BUNDLES,
  assertReleaseRuntimePinMatchesModelConfig,
  releaseRuntimePinForSubject,
  resolveWritingRelease,
} from "./writing-release";

export interface GenerationRequest {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
  operation?: GenerationOperation;
}

export const WRITING_ACTION_OPERATIONS = [
  "continue",
  "rewrite",
  "expand",
  "condense",
  "change_pov",
  "add_hook",
  "generate_title",
  "generate_summary",
  "selection_rewrite",
  "targeted_revision",
] as const;
export type WritingActionOperation = (typeof WRITING_ACTION_OPERATIONS)[number];
export type GenerationOperation = "draft" | "verify" | "revise" | WritingActionOperation;

export interface GenerationUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerationResult {
  text: string;
  model: string;
  finishReason: "stop";
  usage: GenerationUsage;
  providerRequestId?: string;
}

export interface GenerationChunk {
  text: string;
  done: boolean;
}

export interface AiGateway {
  generateText(input: GenerationRequest): Promise<GenerationResult>;
  streamText(input: GenerationRequest): AsyncIterable<GenerationChunk>;
}

export const AI_FAILURE_CLASSES = [
  "provider",
  "timeout",
  "rate_limit",
  "schema",
  "policy",
  "budget",
  "cancelled",
  "unknown",
] as const;
export type AiFailureClass = (typeof AI_FAILURE_CLASSES)[number];

export class AiProviderError extends Error {
  readonly code = "MODEL_PROVIDER_ERROR";
  readonly failureClass: AiFailureClass;
  readonly retryable: boolean;
  readonly usage: GenerationUsage | undefined;
  readonly providerRequestId: string | undefined;

  constructor(
    message = "AI provider failed",
    options: {
      failureClass?: AiFailureClass;
      retryable?: boolean;
      usage?: GenerationUsage;
      providerRequestId?: string;
    } = {},
  ) {
    super(message);
    this.name = "AiProviderError";
    this.failureClass = options.failureClass ?? "provider";
    this.retryable = options.retryable ?? true;
    this.usage = options.usage;
    this.providerRequestId = options.providerRequestId;
  }
}

export function classifyAiFailure(error: unknown): AiFailureClass {
  if (error instanceof AiProviderError) {
    return error.failureClass;
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "timeout";
  }
  return "unknown";
}

export const M0_COST_PER_TOKEN_CNY = 0.000002;

interface DeepSeekProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  provider?: "deepseek" | "openai-compatible";
  openAiAllowlist?: readonly string[];
  endpointValidator?: typeof validateProviderEndpoint;
  pinnedRequest?: typeof requestPinnedEndpoint;
}

interface DeepSeekResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class DeepSeekProvider implements AiGateway {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly timeoutMs: number;
  private readonly provider: "deepseek" | "openai-compatible";
  private readonly openAiAllowlist: readonly string[];
  private readonly endpointValidator: typeof validateProviderEndpoint;
  private readonly pinnedRequest: typeof requestPinnedEndpoint;
  private lastResponseId: string | undefined;

  constructor(options: DeepSeekProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "");
    this.defaultModel = options.model ?? "deepseek-chat";
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.provider = options.provider ?? "deepseek";
    this.openAiAllowlist = options.openAiAllowlist ?? [];
    this.endpointValidator = options.endpointValidator ?? validateProviderEndpoint;
    this.pinnedRequest = options.pinnedRequest ?? requestPinnedEndpoint;
  }

  async generateText(input: GenerationRequest): Promise<GenerationResult> {
    const model = input.model ?? this.defaultModel;
    const endpoint = await this.endpointValidator({
      provider: this.provider,
      baseUrl: this.baseUrl,
      openAiAllowlist: this.openAiAllowlist,
    });
    const headers = {
      authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
    };
    const body = JSON.stringify({
      model,
      messages: [
        ...(input.system ? [{ role: "system", content: input.system }] : []),
        { role: "user", content: input.prompt },
      ],
      max_tokens: input.maxTokens ?? 2_000,
      stream: false,
    });
    const response = this.fetchImpl
      ? await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body,
          redirect: "error",
          signal: AbortSignal.timeout(this.timeoutMs),
        })
      : await this.pinnedRequest({
          baseUrl: this.baseUrl,
          address: endpoint.addresses[0] ?? "",
          headers,
          body,
          timeoutMs: this.timeoutMs,
        });
    const payload = (await response.json().catch(() => ({}))) as DeepSeekResponse;
    if (!response.ok) {
      throw new AiProviderError(`DeepSeek request failed with status ${response.status}`, {
        failureClass: providerFailureClass(response.status),
      });
    }
    const text = payload.choices?.[0]?.message?.content;
    const finishReason = payload.choices?.[0]?.finish_reason;
    const inputTokens = payload.usage?.prompt_tokens;
    const outputTokens = payload.usage?.completion_tokens;
    const usage =
      typeof inputTokens === "number" && typeof outputTokens === "number"
        ? { inputTokens, outputTokens }
        : undefined;
    if (payload.id) {
      this.lastResponseId = payload.id;
    }
    if (typeof text !== "string" || text.trim().length === 0 || usage === undefined) {
      throw new AiProviderError("DeepSeek returned an incomplete generation response", {
        failureClass: "schema",
        retryable: false,
        ...(usage ? { usage } : {}),
        ...(payload.id ? { providerRequestId: payload.id } : {}),
      });
    }
    if (finishReason !== "stop") {
      throw new AiProviderError(`DeepSeek generation finished with ${finishReason ?? "unknown"}`, {
        failureClass: "provider",
        retryable: false,
        usage,
        ...(payload.id ? { providerRequestId: payload.id } : {}),
      });
    }
    return {
      text,
      model: payload.model ?? model,
      finishReason: "stop",
      usage,
      ...(payload.id ? { providerRequestId: payload.id } : {}),
    };
  }

  async *streamText(input: GenerationRequest): AsyncIterable<GenerationChunk> {
    const result = await this.generateText(input);
    const middle = Math.ceil(result.text.length / 2);
    yield { text: result.text.slice(0, middle), done: false };
    yield { text: result.text.slice(middle), done: true };
  }

  getLastResponseId(): string | undefined {
    return this.lastResponseId;
  }
}

function providerFailureClass(status: number): AiFailureClass {
  if (status === 401 || status === 403) {
    return "policy";
  }
  if (status === 408) {
    return "timeout";
  }
  if (status === 429) {
    return "rate_limit";
  }
  if (status === 400 || status === 422) {
    return "schema";
  }
  return "provider";
}

interface DeepSeekSmokeOptions {
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  endpointValidator?: typeof validateProviderEndpoint;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}

export type DeepSeekSmokeEvidence =
  | {
      schemaVersion: 1;
      status: "skipped";
      reason: "DEEPSEEK_SMOKE_DISABLED" | "DEEPSEEK_API_KEY_MISSING";
      provider: "deepseek";
      checkedAt: string;
      networkCalls: 0;
    }
  | {
      schemaVersion: 1;
      runId: string;
      status: "succeeded";
      provider: "deepseek";
      baseUrl: string;
      model: string;
      promptVersion: string;
      contextCompilerVersion: string;
      agentContractVersion: string;
      configVersion: string;
      configHash: string;
      promptHash: string;
      startedAt: string;
      finishedAt: string;
      latencyMs: number;
      timeoutMs: number;
      maxBudgetCny: number;
      maxAttempts: number;
      attempts: number;
      generation: {
        textHash: string;
        textLength: number;
        finishReason: "stop";
      };
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
      cost: {
        estimatedCny: number;
        pricingBasis: "m0-usage-baseline";
      };
      costCny: number;
      providerRequestId?: string;
      providerResponseId?: string;
      networkCalls: number;
    }
  | {
      schemaVersion: 1;
      runId: string;
      status: "failed";
      provider: "deepseek";
      baseUrl: string;
      model: string;
      promptVersion: string;
      contextCompilerVersion: string;
      agentContractVersion: string;
      configVersion: string;
      configHash: string;
      promptHash: string;
      startedAt: string;
      finishedAt: string;
      latencyMs: number;
      timeoutMs: number;
      maxBudgetCny: number;
      maxAttempts: number;
      attempts: number;
      costCny: number;
      failureClass: AiFailureClass;
      reason: string;
      networkCalls: number;
    };

const DEEPSEEK_SMOKE_SYSTEM = "你是 NovelBrain M3 发布验收助手。只输出一句不超过三十字的仙侠正文。";
const DEEPSEEK_SMOKE_PROMPT = "写一句包含山门、雨和一个人物的测试正文。";
const DEEPSEEK_SMOKE_MAX_OUTPUT_TOKENS = 64;

export async function runDeepSeekSmoke(
  options: DeepSeekSmokeOptions,
): Promise<DeepSeekSmokeEvidence> {
  const now = options.now ?? (() => new Date());
  if (options.env.DEEPSEEK_SMOKE_ENABLED !== "1") {
    return {
      schemaVersion: 1,
      status: "skipped",
      reason: "DEEPSEEK_SMOKE_DISABLED",
      provider: "deepseek",
      checkedAt: now().toISOString(),
      networkCalls: 0,
    };
  }
  const apiKey = options.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    return {
      schemaVersion: 1,
      status: "skipped",
      reason: "DEEPSEEK_API_KEY_MISSING",
      provider: "deepseek",
      checkedAt: now().toISOString(),
      networkCalls: 0,
    };
  }

  const model = options.env.DEEPSEEK_SMOKE_MODEL?.trim() || "deepseek-chat";
  const baseUrl = options.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com";
  const promptVersion =
    options.env.DEEPSEEK_SMOKE_PROMPT_VERSION?.trim() || "m1-writing-prompts-v1";
  const contextCompilerVersion =
    options.env.DEEPSEEK_SMOKE_CONTEXT_VERSION?.trim() || "m1-context-v1";
  const agentContractVersion =
    options.env.DEEPSEEK_SMOKE_AGENT_VERSION?.trim() || "agent-m3-06b-v1";
  const configVersion = options.env.DEEPSEEK_SMOKE_CONFIG_VERSION?.trim() || "deepseek-default-v1";
  const timeoutMs = boundedNumber(options.env.DEEPSEEK_SMOKE_TIMEOUT_MS, 15_000, 1_000, 60_000);
  const maxAttempts = boundedInteger(options.env.DEEPSEEK_SMOKE_MAX_ATTEMPTS, 1, 1, 3);
  const maxBudgetCny = boundedNumber(options.env.DEEPSEEK_SMOKE_MAX_BUDGET_CNY, 0, 0, 1);
  const startedAt = now();
  const configHash = hashJson({
    provider: "deepseek",
    baseUrl,
    model,
    promptVersion,
    contextCompilerVersion,
    agentContractVersion,
    configVersion,
    timeoutMs,
  });
  const promptHash = createHash("sha256")
    .update(`${DEEPSEEK_SMOKE_SYSTEM}\n${DEEPSEEK_SMOKE_PROMPT}`)
    .digest("hex");
  const runId = `provider-smoke-${startedAt.toISOString()}-${configHash.slice(0, 12)}`;
  const estimatedTokens =
    Array.from(`${DEEPSEEK_SMOKE_SYSTEM}${DEEPSEEK_SMOKE_PROMPT}`).length +
    DEEPSEEK_SMOKE_MAX_OUTPUT_TOKENS;
  const estimatedMaxCostCny = Number((estimatedTokens * M0_COST_PER_TOKEN_CNY).toFixed(8));
  const endpointValidator = options.endpointValidator ?? validateProviderEndpoint;
  try {
    await endpointValidator({
      provider: "deepseek",
      baseUrl,
    });
  } catch {
    const finishedAt = now();
    return {
      schemaVersion: 1,
      runId,
      status: "failed",
      provider: "deepseek",
      baseUrl,
      model,
      promptVersion,
      contextCompilerVersion,
      agentContractVersion,
      configVersion,
      configHash,
      promptHash,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      latencyMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      timeoutMs,
      maxBudgetCny,
      maxAttempts,
      attempts: 0,
      costCny: 0,
      failureClass: "policy",
      reason: "DEEPSEEK_BASE_URL_INVALID",
      networkCalls: 0,
    };
  }
  if (maxBudgetCny <= 0 || estimatedMaxCostCny * maxAttempts > maxBudgetCny) {
    const finishedAt = now();
    return {
      schemaVersion: 1,
      runId,
      status: "failed",
      provider: "deepseek",
      baseUrl,
      model,
      promptVersion,
      contextCompilerVersion,
      agentContractVersion,
      configVersion,
      configHash,
      promptHash,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      latencyMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      timeoutMs,
      maxBudgetCny,
      maxAttempts,
      attempts: 0,
      costCny: 0,
      failureClass: "budget",
      reason: "DEEPSEEK_SMOKE_BUDGET_EXCEEDED",
      networkCalls: 0,
    };
  }

  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      }));
  let attempts = 0;
  let lastFailureClass: AiFailureClass = "unknown";
  let lastReason = "DEEPSEEK_PROVIDER_ERROR";
  let totalCostCny = 0;
  let lastProviderRequestId: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    const provider = new DeepSeekProvider({
      apiKey,
      baseUrl,
      model,
      timeoutMs,
      endpointValidator,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    try {
      const result = await provider.generateText({
        system: DEEPSEEK_SMOKE_SYSTEM,
        prompt: DEEPSEEK_SMOKE_PROMPT,
        model,
        maxTokens: DEEPSEEK_SMOKE_MAX_OUTPUT_TOKENS,
        operation: "draft",
      });
      const finishedAt = now();
      const totalTokens = result.usage.inputTokens + result.usage.outputTokens;
      const attemptCostCny = Number((totalTokens * M0_COST_PER_TOKEN_CNY).toFixed(8));
      totalCostCny = Number((totalCostCny + attemptCostCny).toFixed(8));
      const providerResponseId = result.providerRequestId ?? provider.getLastResponseId();
      if (totalCostCny > maxBudgetCny) {
        return {
          schemaVersion: 1,
          runId,
          status: "failed",
          provider: "deepseek",
          baseUrl,
          model: result.model,
          promptVersion,
          contextCompilerVersion,
          agentContractVersion,
          configVersion,
          configHash,
          promptHash,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          latencyMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
          timeoutMs,
          maxBudgetCny,
          maxAttempts,
          attempts,
          costCny: totalCostCny,
          failureClass: "budget",
          reason: "DEEPSEEK_SMOKE_BUDGET_EXCEEDED",
          networkCalls: attempts,
        };
      }
      return {
        schemaVersion: 1,
        runId,
        status: "succeeded",
        provider: "deepseek",
        baseUrl,
        model: result.model,
        promptVersion,
        contextCompilerVersion,
        agentContractVersion,
        configVersion,
        configHash,
        promptHash,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        latencyMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        timeoutMs,
        maxBudgetCny,
        maxAttempts,
        attempts,
        generation: {
          textHash: createHash("sha256").update(result.text).digest("hex"),
          textLength: Array.from(result.text).length,
          finishReason: result.finishReason,
        },
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens,
        },
        cost: {
          estimatedCny: totalCostCny,
          pricingBasis: "m0-usage-baseline",
        },
        costCny: totalCostCny,
        ...(providerResponseId ? { providerRequestId: providerResponseId } : {}),
        ...(providerResponseId ? { providerResponseId } : {}),
        networkCalls: attempts,
      };
    } catch (error) {
      lastFailureClass = classifyAiFailure(error);
      lastReason = smokeFailureReason(lastFailureClass);
      if (error instanceof AiProviderError) {
        lastProviderRequestId = error.providerRequestId ?? lastProviderRequestId;
        if (error.usage) {
          const attemptCostCny = Number(
            ((error.usage.inputTokens + error.usage.outputTokens) * M0_COST_PER_TOKEN_CNY).toFixed(
              8,
            ),
          );
          totalCostCny = Number((totalCostCny + attemptCostCny).toFixed(8));
        }
      }
      const retryable =
        (lastFailureClass === "rate_limit" || lastFailureClass === "provider") &&
        (!(error instanceof AiProviderError) || error.retryable);
      if (!retryable || attempt >= maxAttempts) {
        break;
      }
      await sleep(Math.min(1_000, 100 * 2 ** (attempt - 1)));
    }
  }
  const finishedAt = now();
  return {
    schemaVersion: 1,
    runId,
    status: "failed",
    provider: "deepseek",
    baseUrl,
    model,
    promptVersion,
    contextCompilerVersion,
    agentContractVersion,
    configVersion,
    configHash,
    promptHash,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    latencyMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    timeoutMs,
    maxBudgetCny,
    maxAttempts,
    attempts,
    costCny: totalCostCny,
    failureClass: lastFailureClass,
    reason: lastReason,
    networkCalls: attempts,
    ...(lastProviderRequestId ? { providerRequestId: lastProviderRequestId } : {}),
  };
}

async function requestPinnedEndpoint(input: {
  baseUrl: string;
  address: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}): Promise<Response> {
  const target = new URL(input.baseUrl);
  target.pathname = `${target.pathname.replace(/\/$/, "")}/chat/completions`;
  const response = await requestPinnedHttps({
    target,
    address: input.address,
    method: "POST",
    headers: input.headers,
    body: input.body,
    timeoutMs: input.timeoutMs,
  });
  return new Response(response.body, { status: response.status });
}

function boundedNumber(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, parsed));
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Math.round(boundedNumber(value, fallback, minimum, maximum));
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function smokeFailureReason(failureClass: AiFailureClass): string {
  if (failureClass === "rate_limit") {
    return "DEEPSEEK_RATE_LIMITED";
  }
  if (failureClass === "timeout") {
    return "DEEPSEEK_TIMEOUT";
  }
  if (failureClass === "policy") {
    return "DEEPSEEK_POLICY_BLOCKED";
  }
  if (failureClass === "schema") {
    return "DEEPSEEK_SCHEMA_INVALID";
  }
  return "DEEPSEEK_PROVIDER_ERROR";
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

export class FakeAiProvider implements AiGateway {
  private calls = 0;

  constructor(
    private readonly options: {
      failOperations?: GenerationOperation[];
      failOnCall?: number;
      usageMultiplier?: number;
      delayMs?: number;
      emptyOnCall?: number;
    } = {},
  ) {}

  async generateText(input: GenerationRequest): Promise<GenerationResult> {
    this.calls += 1;
    if (
      input.operation &&
      this.options.failOperations?.includes(input.operation) &&
      (this.options.failOnCall === undefined || this.calls === this.options.failOnCall)
    ) {
      throw new AiProviderError(`Fake provider failed during ${input.operation}`);
    }
    if (this.options.delayMs && this.options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
    }
    const model = input.model ?? "fake-deterministic";
    const fingerprint = stableHash(`${input.system ?? ""}\n${input.prompt}`);
    const text =
      this.calls === this.options.emptyOnCall
        ? ""
        : input.operation
          ? operationText(input.operation, fingerprint, input.prompt)
          : `fake:${fingerprint}:${input.prompt}`;

    const usageMultiplier = this.options.usageMultiplier ?? 1;
    return {
      text,
      model,
      finishReason: "stop",
      usage: {
        inputTokens: estimateTokens(`${input.system ?? ""}${input.prompt}`) * usageMultiplier,
        outputTokens: estimateTokens(text) * usageMultiplier,
      },
    };
  }

  async *streamText(input: GenerationRequest): AsyncIterable<GenerationChunk> {
    const result = await this.generateText(input);
    const middle = Math.ceil(result.text.length / 2);

    yield { text: result.text.slice(0, middle), done: false };
    yield { text: result.text.slice(middle), done: true };
  }
}

function operationText(
  operation: GenerationOperation,
  fingerprint: string,
  prompt: string,
): string {
  if (operation === "verify") {
    return `审校通过：章纲、已确认设定和必用事实一致。指纹 ${fingerprint}`;
  }
  if (operation === "revise") {
    return [
      `修订稿 ${fingerprint}`,
      "血从袖口滴下来，落在荒寺外的青石板上。沈砚把断臂藏进衣袍，只用右手结印。",
      "顾青看见书页一角，却没有点破，只把追兵引向山道另一侧。",
      "风穿过残钟，沈砚记住这次代价，也记住了顾青没有说出口的疑问。",
    ].join("\n\n");
  }
  if (operation === "continue") {
    return [
      `续写片段 ${fingerprint}`,
      "山门外传来第三声钟响时，沈砚终于看见雪地里那串不属于人的脚印。",
    ].join("\n\n");
  }
  if (operation === "rewrite") {
    return [
      `改写稿 ${fingerprint}`,
      "血顺着袖口滴在青石板上。沈砚收拢断臂，只用右手扣住印诀。",
      "追兵逼近，忘川书在暮色里短暂显形，顾青看见了那一角书页。",
    ].join("\n\n");
  }
  if (operation === "expand") {
    return [
      `扩写稿 ${fingerprint}`,
      "风从荒寺残破的檐角灌下来，卷起满地枯叶，也卷起血腥气。",
      "沈砚把断臂藏进衣袍，右手按住袖中那本发烫的古书，听见追兵的脚步一近再近。",
    ].join("\n\n");
  }
  if (operation === "condense") {
    return `缩写稿 ${fingerprint}：沈砚藏起断臂，单手结印，顾青看见忘川书的一角。`;
  }
  if (operation === "change_pov") {
    return [
      `改视角稿 ${fingerprint}`,
      "顾青先看见的是雪里的血，然后才看见沈砚藏在身后的左手。",
      "他没有点破，只把追兵引向山道另一侧。",
    ].join("\n\n");
  }
  if (operation === "add_hook") {
    return [
      `残钟无风自鸣，碑上浮出了沈砚自己的名字。${fingerprint}`,
      "顾青没有回头，却把一枚染血的铜牌放进了沈砚掌心。",
      "沈砚终于想起，这一夜他并不是第一次杀死自己。",
    ].join("\n");
  }
  if (operation === "generate_title") {
    return [`断臂之后 ${fingerprint}`, "一只手也能结印", "忘川初现"].join("\n");
  }
  if (operation === "generate_summary") {
    return `沈砚断臂后仍以单手结印脱身，顾青看见了忘川书的一角却没有点破。${fingerprint}`;
  }
  if (operation === "selection_rewrite") {
    return `改写片段 ${fingerprint}：他收紧呼吸，把疼痛压回袖中。`;
  }
  if (operation === "targeted_revision") {
    const blockIds = [
      ...new Set(
        [...prompt.matchAll(/"blockId"\s*:\s*"([A-Za-z0-9_-]+)"/gu)].map((match) => match[1]!),
      ),
    ];
    if (blockIds.length === 0) {
      return `修订片段 ${fingerprint}：他收紧呼吸，把疼痛压回袖中。`;
    }
    return JSON.stringify({
      replacements: blockIds.map((blockId) => ({
        blockId,
        text: `修订块 ${blockId}：他收紧呼吸，把疼痛压回袖中。`,
      })),
    });
  }
  return [
    `生成草稿 ${fingerprint}`,
    "血从袖口滴下来，落在荒寺外的青石板上。沈砚把断臂藏进衣袍，只用右手结印。",
    "追兵逼近时，忘川书在暮色里短暂显形。顾青看见书页一角，却没有点破。",
    "风穿过残钟，沈砚记住了这一夜的代价。",
  ].join("\n\n");
}
