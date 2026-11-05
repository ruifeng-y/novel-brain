import { expect, type Page } from "@playwright/test";

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
