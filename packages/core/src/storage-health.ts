export async function checkStorageHealth(healthUrl: string, timeoutMs = 2_000): Promise<void> {
  const response = await fetch(healthUrl, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Object storage health check failed with HTTP ${response.status}`);
  }
}
