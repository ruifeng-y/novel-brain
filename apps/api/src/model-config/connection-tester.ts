import { Injectable } from "@nestjs/common";
import type { ModelConfig } from "@novel-brain/contracts";

import { validateProviderConfig } from "./provider-registry";

export const MODEL_CONNECTION_TESTER = Symbol("MODEL_CONNECTION_TESTER");

export interface ConnectionTestInput {
  config: ModelConfig;
  apiKey: string;
}

export interface ConnectionTestResult {
  status: "success" | "key_invalid" | "rate_limited" | "timeout" | "error";
  latencyMs: number;
  message: string;
}

export interface ModelConnectionTester {
  test(input: ConnectionTestInput): Promise<ConnectionTestResult>;
}

@Injectable()
export class HttpModelConnectionTester implements ModelConnectionTester {
  async test({ config, apiKey }: ConnectionTestInput): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      await validateProviderConfig(config);
      const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
      });
      const latencyMs = Date.now() - startedAt;
      if (response.status === 401 || response.status === 403) {
        return { status: "key_invalid", latencyMs, message: "API Key 无效或无权限" };
      }
      if (response.status === 429) {
        return { status: "rate_limited", latencyMs, message: "Provider 已限流，请稍后重试" };
      }
      if (response.status >= 300 && response.status < 400) {
        return { status: "error", latencyMs, message: "Provider 返回了不受信任的重定向" };
      }
      if (!response.ok) {
        return { status: "error", latencyMs, message: `Provider 返回 ${response.status}` };
      }
      return { status: "success", latencyMs, message: "连接正常" };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      if (error instanceof Error && error.name === "TimeoutError") {
        return { status: "timeout", latencyMs, message: "连接超时" };
      }
      return { status: "error", latencyMs, message: "连接失败" };
    }
  }
}

@Injectable()
export class FakeModelConnectionTester implements ModelConnectionTester {
  async test({ apiKey }: ConnectionTestInput): Promise<ConnectionTestResult> {
    if (apiKey.includes("invalid")) {
      return { status: "key_invalid", latencyMs: 1, message: "API Key 无效" };
    }
    if (apiKey.includes("rate")) {
      return { status: "rate_limited", latencyMs: 1, message: "Provider 已限流" };
    }
    if (apiKey.includes("timeout")) {
      return { status: "timeout", latencyMs: 1, message: "连接超时" };
    }
    return { status: "success", latencyMs: 1, message: "连接正常" };
  }
}
