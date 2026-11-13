import type { ErrorCode } from "@novel-brain/contracts";

export class ApiError extends Error {
  // Message stays server-authored. User-controlled diagnostics belong in details or logs.
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}
