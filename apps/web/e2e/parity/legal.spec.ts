import { expect, test } from "@playwright/test";

import {
  expectAuthorFacingLanguage,
  expectNoPrototypeOnlyLeakage,
  productionScreenshotOptions,
} from "../helpers/ui";

const viewports = [390, 900, 1180, 1440] as const;

test("publishes static legal documents without work context at four viewports", async ({
  page,
}) => {
  await page.goto("/legal");

  await expect(page).toHaveURL(/\/legal$/u);
  await expect(page.getByRole("heading", { name: "使用前需要知道的边界" })).toBeVisible();
  await expect(page.getByRole("link", { name: /用户协议/u })).toHaveAttribute(
    "href",
    "/legal/terms",
  );
  await expect(page.getByRole("link", { name: /隐私政策/u })).toHaveAttribute(
    "href",
    "/legal/privacy",
  );
  await expect(page.getByRole("link", { name: /AI 生成内容说明/u })).toHaveAttribute(
    "href",
    "/legal/ai-disclosure",
  );
  await expect(page.getByText("当前版本为运营前草案")).toBeVisible();
  await expect(page.getByLabel("当前作品与创作线")).toHaveCount(0);

  await page.getByRole("link", { name: /隐私政策/u }).click();
  await expect(page).toHaveURL(/\/legal\/privacy$/u);
  await expect(page.getByRole("heading", { name: "隐私政策" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "模型供应商" })).toBeVisible();
  await expect(page.getByText("保留、导出与删除")).toBeVisible();

  await expectAuthorFacingLanguage(page);
  await expectNoPrototypeOnlyLeakage(page);

  await page.goto("/legal/not-a-document");
  await expect(page.getByRole("heading", { name: "没有找到这份条款" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回全部条款" })).toBeVisible();

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/legal");
    await expect(page.getByRole("heading", { name: "使用前需要知道的边界" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
    await expect
      .soft(page)
      .toHaveScreenshot(["legal", `legal-${width}.png`], productionScreenshotOptions);
  }
});
