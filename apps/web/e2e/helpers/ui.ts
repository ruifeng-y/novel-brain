import { expect, type Page } from "@playwright/test";

export async function expectAuthorFacingLanguage(page: Page): Promise<void> {
  const text = await page.locator("body").innerText();
  for (const term of ["main", "版本节点", "版本头", "Provider", "Canon", "Agent"]) {
    expect(text).not.toContain(term);
  }
}
