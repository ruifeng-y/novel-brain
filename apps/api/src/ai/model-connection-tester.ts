export type ModelConnectionTestStatus = 'success' | 'invalid_key' | 'network_error';

export type ModelConnectionTestInput = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type ModelConnectionTestResult = {
  status: ModelConnectionTestStatus;
  message: string;
  latencyMs?: number;
};

export interface ModelConnectionTester {
  test(input: ModelConnectionTestInput): Promise<ModelConnectionTestResult>;
}

export const MODEL_CONNECTION_TESTER = 'MODEL_CONNECTION_TESTER';

export class DeepSeekConnectionTester implements ModelConnectionTester {
  async test(input: ModelConnectionTestInput): Promise<ModelConnectionTestResult> {
    const startedAt = Date.now();
    const baseUrl = input.baseUrl.replace(/\/+$/, '');

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return {
        status: 'network_error',
        message: 'Could not reach the model provider',
      };
    }

    const latencyMs = Date.now() - startedAt;
    if (response.ok) {
      return {
        status: 'success',
        message: 'Connection successful',
        latencyMs,
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        status: 'invalid_key',
        message: 'API key is invalid',
        latencyMs,
      };
    }

    return {
      status: 'network_error',
      message: 'The model provider returned an unexpected response',
      latencyMs,
    };
  }
}
