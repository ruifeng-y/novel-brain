import { createHash } from "node:crypto";

export function sha256Json(value: unknown): string {
  return sha256Text(JSON.stringify(value));
}

export function sha256CanonicalJson(value: unknown): string {
  return sha256Json(canonicalizeJson(value));
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeJson(entry)]),
    );
  }
  return value;
}
