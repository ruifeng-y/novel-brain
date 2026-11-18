import { createHash } from "node:crypto";

export function sha256Json(value: unknown): string {
  return sha256Text(JSON.stringify(value));
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
