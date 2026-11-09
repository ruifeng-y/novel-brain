import { expect, type Page } from "@playwright/test";

const frozenTimestamp = "2026-11-05T08:50:00.000Z";

export async function freezeApiTimestamps(page: Page): Promise<void> {
  await page.route("**/api/v1/**", async (route) => {
    const response = await route.fetch();
    const contentType = response.headers()["content-type"] ?? "";
    if (!contentType.includes("application/json")) {
      await route.fulfill({ response });
      return;
    }

    const text = await response.text();
    if (!text) {
      await route.fulfill({ response });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      await route.fulfill({ response, body: text });
      return;
    }

    await route.fulfill({ response, json: freezeTimestamps(payload) });
  });
}

export async function expectAuthorFacingLanguage(page: Page): Promise<void> {
  const text = await page.locator("body").innerText();
  for (const term of [
    "Agent",
    "Canon",
    "Context Pack",
    "Provider",
    "P0",
    "P1",
    "P2",
    "P3",
    "P4",
    "正史",
    "故事事实",
    "版本节点",
    "版本头",
    "model_config",
    "agent_run",
  ]) {
    expect(text, `author-facing page exposed internal term: ${term}`).not.toContain(term);
  }
  expect(text).not.toMatch(/\bmain\b/i);
}

function freezeTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(freezeTimestamps);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      /(At|timestamp)$/u.test(key) && typeof entry === "string"
        ? frozenTimestamp
        : freezeTimestamps(entry),
    ]),
  );
}
