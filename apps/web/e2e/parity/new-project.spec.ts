import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { expectAuthorFacingLanguage } from "../helpers/ui";

async function authenticatedPage(page: Page, context: BrowserContext) {
  const email = uniqueEmail("new-project");
  const session = await registerUser(page.request, email, "StrongPassword123", "新建作品作者");
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
  await page.goto("/workspace/new-project");
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("creates a work from an idea and opens its overview", async ({ page, context }) => {
  await authenticatedPage(page, context);
  await expect(page.getByRole("heading", { name: "把一个想法，长成一本书" })).toBeVisible();
  await expectAuthorFacingLanguage(page);

  await page.getByLabel("书名").fill("忘川书");
  await page.getByLabel("故事灵感").fill("一个被宗门抛弃的杂役，意外得到一本会吞噬记忆的古书。");
  await page.getByRole("button", { name: "创建作品并进入总览" }).click();

  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole("heading", { name: "忘川书" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "主创作线" })).toBeVisible();
  await expect(page.getByText("草稿", { exact: true })).toBeVisible();
});

test("creates a blank work without an idea", async ({ page, context }) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "空白作品", exact: true }).click();
  await expect(page.getByLabel("故事灵感")).toHaveCount(0);

  await page.getByLabel("书名").fill("空白长篇");
  await page.getByRole("button", { name: "创建作品并进入总览" }).click();

  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole("heading", { name: "空白长篇" })).toBeVisible();
  await expect(page.getByText("还没有故事灵感", { exact: true })).toBeVisible();
});

test("creates a xianxia template work", async ({ page, context }) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "题材模板", exact: true }).click();
  await page.getByLabel("书名").fill("仙途模板");
  await page.getByLabel("题材模板").selectOption("xianxia");
  await page.getByRole("button", { name: "创建作品并进入总览" }).click();

  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole("heading", { name: "仙途模板" })).toBeVisible();
  await expect(page.getByText("仙侠模板 · 修真文明", { exact: true })).toBeVisible();
});

test("shows loading, disabled, error and long-content states", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const longTitle = "一部标题很长很长但仍然需要在创建预览里完整换行且不能撑破页面的仙侠作品";
  await page.getByLabel("书名").fill(longTitle);
  await page
    .getByLabel("故事灵感")
    .fill("一个被宗门抛弃的杂役，意外得到一本会吞噬记忆的古书，并决定追查自己的身世。");
  await expect(page.getByRole("heading", { name: longTitle })).toBeVisible();

  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/works", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await gate;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "作品创建失败。",
          details: {},
          requestId: "req_new_project_error",
        },
      }),
    });
  });

  const submit = page.getByRole("button", { name: "创建作品并进入总览" });
  await submit.click();
  await expect(submit).toBeDisabled();
  release?.();
  await expect(page.getByText("作品创建失败。")).toBeVisible();
  await expect(submit).toBeEnabled();
});

test("imports partial settings from a small fixture file and creates the work", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "导入设定", exact: true }).click();
  await expect(page.getByRole("heading", { name: "把人物、势力、地图和体系带进来" })).toBeVisible();

  await page.getByLabel("上传设定文件").setInputFiles({
    name: "settings-partial.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      ["人物：沈砚，外门杂役，左臂骨折。", "这是一段暂时无法归类的旧笔记。"].join("\n"),
      "utf8",
    ),
  });
  await page.getByRole("button", { name: "开始识别" }).click();

  await expect(page.getByRole("heading", { name: "识别结果" })).toBeVisible();
  await expect(page.getByText("已接受 1")).toBeVisible();
  await expect(page.getByText("无法解析 1")).toBeVisible();
  await expect(
    page
      .locator(".settings-import-report")
      .getByText("人物：沈砚，外门杂役，左臂骨折。", { exact: true }),
  ).toBeVisible();
  await expectAuthorFacingLanguage(page);

  await page.getByLabel("书名").fill("部分设定开书");
  await page.getByRole("button", { name: "确认并创建作品" }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole("heading", { name: "部分设定开书" })).toBeVisible();
});

test("imports complete settings and reports pending candidates before creation", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "导入设定", exact: true }).click();
  await page
    .getByLabel("粘贴设定")
    .fill(
      [
        "人物：沈砚，外门杂役。",
        "人物：顾青，太玄门弟子。",
        "势力：太玄门、血河宗。",
        "地图：人界 → 东境 → 忘川渡。",
        "力量体系：练气 → 筑基 → 金丹。",
        "金手指：忘川书，以记忆换取前人经验。",
      ].join("\n"),
    );
  await page.getByRole("button", { name: "开始识别" }).click();

  await expect(page.getByText("已接受 6")).toBeVisible();
  await expect(page.getByText("待确认 1")).toBeVisible();
  await expect(page.getByText("冲突 0")).toBeVisible();
  await expect(page.getByText("无法解析 0")).toBeVisible();

  await page.getByLabel("书名").fill("完整设定开书");
  await page.getByRole("button", { name: "确认并创建作品" }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole("heading", { name: "完整设定开书" })).toBeVisible();
});

test("imports an old manuscript after editing a title and splitting a chapter", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "导入旧稿", exact: true }).click();
  await expect(page.getByRole("heading", { name: "把已经写下的部分带进来" })).toBeVisible();

  await page.getByLabel("上传旧稿文件").setInputFiles({
    name: "old-draft.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      [
        "# 第一章 断碑夜雨",
        "",
        "雨落在断碑上。",
        "",
        "# 第二章 夜船",
        "",
        "夜船顺流而下。",
        "",
        "# 第三章 断臂之后",
        "",
        "沈砚按住左臂。",
      ].join("\n"),
      "utf8",
    ),
  });
  await page.getByRole("button", { name: "识别章节" }).click();
  await expect(page.getByText("识别到 3 章")).toBeVisible();

  const rows = page.getByTestId("manuscript-chapter-row");
  await expect(rows).toHaveCount(3);
  await rows.nth(0).getByLabel("第 1 章标题").fill("第一章 断碑夜雨");
  await rows.nth(0).getByRole("button", { name: "拆分第 1 章" }).click();
  await expect(page.getByLabel("拆分位置")).toBeVisible();
  await page.getByRole("button", { name: "确认拆分" }).click();
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(1).getByLabel("第 2 章标题")).toHaveValue("拆分章节");
  await rows.nth(1).getByLabel("第 2 章标题").fill("雨落断碑");
  await rows.nth(1).getByRole("button", { name: "合并第 2 章与下一章" }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1).getByLabel("第 2 章标题")).toHaveValue("雨落断碑");

  await page.getByLabel("书名").fill("旧稿新书");
  for (const width of [1440, 1180, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "把已经写下的部分带进来" })).toBeVisible();
    await expect(page.getByRole("button", { name: "确认并创建作品" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
  await page.getByRole("button", { name: "确认并创建作品" }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole("heading", { name: "旧稿新书" })).toBeVisible();
  await expectAuthorFacingLanguage(page);
});

test("shows empty, partial, unsupported and unreadable manuscript states", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "导入旧稿", exact: true }).click();

  await page.getByLabel("上传旧稿文件").setInputFiles({
    name: "old-draft.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("not supported", "utf8"),
  });
  await expect(page.getByText("请选择 TXT 或 Markdown 旧稿文件")).toBeVisible();

  await page.getByLabel("上传旧稿文件").setInputFiles({
    name: "empty.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(" \n\n ", "utf8"),
  });
  await page.getByRole("button", { name: "识别章节" }).click();
  await expect(page.getByRole("heading", { name: "旧稿里没有可导入的正文" })).toBeVisible();

  await page.getByLabel("上传旧稿文件").setInputFiles({
    name: "partial.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("只有正文，没有章节标题。\n第二段仍然保留。", "utf8"),
  });
  await page.getByRole("button", { name: "识别章节" }).click();
  await expect(page.getByText("部分内容未识别到章节标题")).toBeVisible();
  await expect(page.getByTestId("manuscript-chapter-row")).toHaveCount(1);

  await page.getByLabel("上传旧稿文件").setInputFiles({
    name: "broken.txt",
    mimeType: "text/plain",
    buffer: Buffer.from([0xff, 0xfe, 0xfd]),
  });
  await page.getByRole("button", { name: "识别章节" }).click();
  await expect(page.getByText("旧稿编码无法解析，请使用 UTF-8 编码")).toBeVisible();
});

test("blocks settings import confirmation until the conflict is decided", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "导入设定", exact: true }).click();
  await page
    .getByLabel("粘贴设定")
    .fill(
      [
        "人物：沈砚，外门杂役，左臂骨折。",
        "人物：沈砚，外门杂役，左臂完好。",
        "势力：太玄门，正道魁首。",
      ].join("\n"),
    );
  await page.getByRole("button", { name: "开始识别" }).click();

  const blocked = page.getByRole("button", { name: "先裁决 1 条冲突" });
  await expect(blocked).toBeDisabled();
  await expect(
    page.locator(".settings-conflict-card").getByText("外门杂役，左臂骨折。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".settings-conflict-card").getByText("外门杂役，左臂完好。", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "采用第一条" }).click();
  await expect(page.getByText("已裁决 · 采用第一条")).toBeVisible();
  await page.getByLabel("书名").fill("冲突裁决后开书");
  await expect(page.getByRole("button", { name: "确认并创建作品" })).toBeEnabled();
});

test("shows a recoverable settings-import error state", async ({ page, context }) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "导入设定", exact: true }).click();
  await page.getByLabel("粘贴设定").fill("人物：沈砚，外门杂役。");
  await page.route("**/api/v1/imports", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "设定识别服务暂时不可用。",
          details: {},
          requestId: "req_settings_import_error",
        },
      }),
    });
  });

  await page.getByRole("button", { name: "开始识别" }).click();
  await expect(page.locator(".settings-import-panel .model-notice")).toContainText(
    "设定识别服务暂时不可用。",
  );
  await expect(page.getByRole("button", { name: "开始识别" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "确认并创建作品" })).toBeDisabled();
});

test("keeps the settings-import flow usable at all required viewports", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "导入设定", exact: true }).click();
  await page
    .getByLabel("粘贴设定")
    .fill(["人物：沈砚，外门杂役。", "势力：太玄门，正道魁首。"].join("\n"));
  await page.getByRole("button", { name: "开始识别" }).click();
  await expect(page.getByRole("heading", { name: "识别结果" })).toBeVisible();

  for (const width of [1440, 1180, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("heading", { name: "把人物、势力、地图和体系带进来" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "确认并创建作品" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
