import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { expectAuthorFacingLanguage, productionScreenshotOptions } from "../helpers/ui";

async function authenticatedWorkPage(page: Page, context: BrowserContext) {
  const email = uniqueEmail("work-settings");
  const session = await registerUser(page.request, email, "StrongPassword123", "作品设置作者");
  await context.addCookies([
    {
      name: "nb_session",
      value: session,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "仙途：忘川书",
    genre: "xianxia",
    scaleTarget: "long",
  });
  await page.goto(`/workspace/${work.id}/work-settings`);
  await expect(page.getByRole("heading", { name: "把这本书的边界定清楚" })).toBeVisible();
  return work;
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("saves work metadata and archives/restores it from the dashboard", async ({
  page,
  context,
}) => {
  await authenticatedWorkPage(page, context);
  await expectAuthorFacingLanguage(page);

  await page.getByLabel("书名").fill("仙途：忘川书 · 修订");
  await page.getByLabel("笔名").fill("青舟");
  await page.getByLabel("题材").selectOption("history");
  await page.getByLabel("目标平台").fill("起点中文网");
  await page.getByLabel("目标读者").fill("偏好长线伏笔的读者");
  await page.getByLabel("读者承诺").fill("每次变强都要付出记忆代价");
  await page.getByLabel("章节字数").fill("3200");
  await page.getByLabel("更新节奏").selectOption("every_other_day");
  await page.getByLabel("连载状态").selectOption("serializing");
  await page.getByLabel("标签").fill("记忆代价, 长线伏笔");
  await page.locator('input[type="file"]').setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAACAAAAAwCAIAAAD/zu84AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAS0lEQVRYhe3YwQkAMAxC0W7kRq7g/rdOUejhQe6BkKg/J+vTOhrMiGqL4tBKKkJNx3DCMidVVPCa6FjpOgCkECooc0A8Xgn7+NtyAd3p6ExZ1H3MAAAAAElFTkSuQmCC",
      "base64",
    ),
  });
  await expect(page.getByText("作品封面已更新。")).toBeVisible();
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByText("作品设置已保存。")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("书名")).toHaveValue("仙途：忘川书 · 修订");
  await expect(page.getByLabel("标签")).toHaveValue("记忆代价, 长线伏笔");

  await page.getByRole("button", { name: "归档作品" }).click();
  await expect(page.getByRole("dialog")).toContainText("归档不会删除分支、版本或正文");
  await page.getByRole("button", { name: "确认归档" }).click();
  await expect(page.getByText("作品已归档，可在工作台筛选“已归档”后恢复。")).toBeVisible();

  await page.goto("/workspace");
  await page.getByLabel("状态筛选").selectOption("archived");
  await expect(page.getByRole("heading", { name: "仙途：忘川书 · 修订" })).toBeVisible();
  await page.getByRole("button", { name: "恢复" }).click();
  await expect(page.getByRole("heading", { name: "仙途：忘川书 · 修订" })).toHaveCount(0);
});

test("duplicates with conservative defaults", async ({ page, context }) => {
  await authenticatedWorkPage(page, context);

  await page.getByRole("button", { name: "复制作品" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "默认不会复制正文、章节版本、章节派生事实、人物认知状态与黄金三章候选",
  );
  await expect(dialog.getByLabel("正文（默认不复制）")).not.toBeChecked();
  await expect(dialog.getByLabel("章节历史版本（需先选择正文）")).toBeDisabled();
  await dialog.getByRole("button", { name: "创建副本" }).click();

  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole("heading", { name: "仙途：忘川书（副本）" })).toBeVisible();
});

test("moves a work to trash and restores it from the dashboard", async ({ page, context }) => {
  await authenticatedWorkPage(page, context);

  await page.getByRole("button", { name: "移入回收站" }).click();
  await expect(page.getByRole("dialog")).toContainText("30 天内仍可在工作台恢复");
  await page.getByRole("button", { name: "确认移入" }).click();

  await expect(page).toHaveURL(/\/workspace\?trash=true$/);
  await expect(page.getByRole("heading", { name: "仙途：忘川书" })).toBeVisible();
  await expect(page.getByRole("button", { name: "永久删除" })).toBeDisabled();
  await page.getByRole("button", { name: "恢复" }).click();
  await expect(page.getByRole("heading", { name: "仙途：忘川书" })).toHaveCount(0);
});

test("shows loading, permission and error states and holds four viewports", async ({
  page,
  context,
}, testInfo) => {
  const work = await authenticatedWorkPage(page, context);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/v1/works/${work.id}`, async (route) => {
    await gate;
    await route.continue();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("正在加载作品设置")).toBeVisible();
  release?.();
  await page.unroute(`**/api/v1/works/${work.id}`);

  await page.route(`**/api/v1/works/${work.id}`, (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "FORBIDDEN_TENANT_ACCESS",
          message: "作品不存在或无权访问",
          details: {},
          requestId: "req_work_settings_permission",
        },
      }),
    }),
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "无权修改这本作品" })).toBeVisible();
  await page.unroute(`**/api/v1/works/${work.id}`);

  await page.route(`**/api/v1/works/${work.id}`, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "作品设置加载失败。",
          details: {},
          requestId: "req_work_settings_error",
        },
      }),
    }),
  );
  await page.reload();
  await expect(page.getByText("作品设置加载失败。")).toBeVisible();
  await page.unroute(`**/api/v1/works/${work.id}`);

  const details = await page.request.get(`/api/v1/works/${work.id}`);
  const current = (await details.json()).data as { version: number };
  const token = await getCsrf(page.request);
  const completed = await page.request.patch(`/api/v1/works/${work.id}`, {
    headers: { Origin: "http://localhost:3000", "X-CSRF-Token": token },
    data: { version: current.version, status: "completed" },
  });
  expect(completed.status()).toBe(200);
  const completedVersion = (await completed.json()).data.version as number;
  await page.goto(`/workspace/${work.id}/work-settings`);
  await expect(page.getByText("作品已完本，默认只读。")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存设置" })).toBeDisabled();

  const reopenToken = await getCsrf(page.request);
  const reopened = await page.request.patch(`/api/v1/works/${work.id}`, {
    headers: { Origin: "http://localhost:3000", "X-CSRF-Token": reopenToken },
    data: { version: completedVersion, status: "serializing" },
  });
  expect(reopened.status()).toBe(200);

  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/work-settings`);
    await expect(page.getByRole("heading", { name: "把这本书的边界定清楚" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await testInfo.attach(`work-settings-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide" }),
      contentType: "image/png",
    });
    await expect(page).toHaveScreenshot(
      ["work-settings", `work-settings-${width}.png`],
      productionScreenshotOptions,
    );
  }
});
