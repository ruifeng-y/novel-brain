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
    await expect
      .soft(page)
      .toHaveScreenshot(["help", `help-${width}.png`], productionScreenshotOptions);
  }
});

test("recovers from a production help navigation error at four viewports", async ({ page }) => {
  await page.addInitScript(() => {
    const original = String.prototype.toLocaleLowerCase;
    const browserWindow = window as typeof window & { restoreHelpRuntime?: () => void };
    browserWindow.restoreHelpRuntime = () => {
      String.prototype.toLocaleLowerCase = original;
      delete browserWindow.restoreHelpRuntime;
    };
    String.prototype.toLocaleLowerCase = function helpRuntimeFailure(locales?: string | string[]) {
      if (locales === "zh-CN") {
        throw new Error("模拟真实浏览器运行时故障。");
      }
      return original.call(this, locales);
    };
  });

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/help");
    await expect(page.getByRole("heading", { name: "内容暂时不可用" })).toBeVisible();
    await expect(page.locator(".static-content-error")).toContainText(
      "帮助或条款内容没有成功加载，请稍后重试。",
    );
    await expectAuthorFacingLanguage(page);
    await expectNoPrototypeOnlyLeakage(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `error state horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);

    await page.evaluate(() => {
      const browserWindow = window as typeof window & { restoreHelpRuntime?: () => void };
      browserWindow.restoreHelpRuntime?.();
    });
    await page.getByRole("button", { name: "重新加载" }).click();
    await expect(page.getByRole("heading", { name: "先看这几件事" })).toBeVisible();
  }
});
