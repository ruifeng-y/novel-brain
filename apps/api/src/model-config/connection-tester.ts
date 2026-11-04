import { Injectable } from "@nestjs/common";
import type { ModelConfig } from "@novel-brain/contracts";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";

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
      const addresses = await validateProviderConfig(config);
      const target = new URL(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`);
      const pinnedAddress = addresses[0];
      if (!pinnedAddress) {
        return { status: "error", latencyMs: 0, message: "Provider 地址无法解析" };
      }
      const response = await requestPinned(target, pinnedAddress, config.model, apiKey);
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
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return { status: "error", latencyMs, message: `Provider 返回 ${response.statusCode}` };
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

function requestPinned(
  target: URL,
  address: string,
  model: string,
  apiKey: string,
): Promise<{ status: number; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    });
    const request = httpsRequest(
      target,
      {
        method: "POST",
        timeout: 8_000,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, address, isIP(address));
        },
        servername: target.hostname,
      },
      (response) => {
        response.resume();
        const status = response.statusCode ?? 0;
        resolve({ status, statusCode: status });
      },
    );
    request.on("timeout", () =>
      request.destroy(Object.assign(new Error("timeout"), { name: "TimeoutError" })),
    );
    request.on("error", reject);
    request.end(body);
  });
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
