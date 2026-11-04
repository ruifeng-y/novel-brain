import { csrfResponseSchema } from "@novel-brain/contracts";

let csrfPromise: Promise<string> | undefined;

export function getCsrfToken(): Promise<string> {
  csrfPromise ??= fetch("/api/v1/auth/csrf", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error("csrf_request_failed");
      }
      return csrfResponseSchema.parse(await response.json()).data.token;
    })
    .catch((error: unknown) => {
      csrfPromise = undefined;
      throw error;
    });
  return csrfPromise;
}

export function clearCsrfCache(): void {
  csrfPromise = undefined;
}
