import { expect, test } from "@playwright/test";

import {
  expectAuthorFacingLanguage,
  expectNoPrototypeOnlyLeakage,
  productionScreenshotOptions,
} from "../helpers/ui";

const viewports = [390, 900, 1180, 1440] as const;

test("opens without work context and covers empty search at four viewports", async ({ page }) => {
  await page.goto("/help");

  await expect(page).toHaveURL(/\/help$/u);
  await expect(page.getByRole("heading", { name: "先看这几件事" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "常用快捷键" })).toBeVisible();
  await expect(page.getByRole("link", { name: "AI 生成内容说明" })).toHaveAttribute(
    "href",
    "/legal/ai-disclosure",
  );
  await expect(page.getByLabel("当前作品与创作线")).toHaveCount(0);

  const search = page.getByRole("searchbox", { name: "搜索常见问题" });
  await search.fill("没有这个帮助主题");
  await expect(page.getByText("没有找到帮助内容")).toBeVisible();
  await search.fill("");
  await expect(page.getByText("为什么不能直接在正文里改设定？")).toBeVisible();

  await expectAuthorFacingLanguage(page);
  await expectNoPrototypeOnlyLeakage(page);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/help");
    await expect(page.getByRole("heading", { name: "先看这几件事" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
    await expect(page).toHaveScreenshot(["help", `help-${width}.png`], productionScreenshotOptions);
  }
});
