import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import {
  expectAuthorFacingLanguage,
  expectNoPrototypeOnlyLeakage,
  productionScreenshotOptions,
} from "../helpers/ui";
import { startWorker } from "../helpers/worker";

const origin = "http://localhost:3000";
const viewports = [390, 900, 1180, 1440] as const;

test.describe.configure({ timeout: 180_000 });

test.beforeEach(async () => {
  await resetRateLimits();
});

test("runs export, publish check and reader preview, then covers four viewports", async ({
  page,
  context,
  playwright,
}, testInfo) => {
  await authenticatedPage(page, context, "导出发布作者");
  const work = await createWork(page.request, {
    mode: "idea",
    title: "山海照夜",
    idea: "一盏山灯在万妖夜行时熄灭，守灯人必须用自己的旧名重新点燃它。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 2500,
  });
  const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  const chapters = await createChapters(page.request, branchPath, 18);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          window.localStorage.setItem("export-publish-copied", value);
        },
      },
    });
  });
  const unfreezeTimestamps = await freezePublishTimestamps(page);
  const worker = await startWorker();
  try {
    await page.goto(`/workspace/${work.id}/export`);
    await expect(page.getByRole("heading", { name: "把故事带出去" })).toBeVisible();
    await expect(page.getByRole("button", { name: "全本" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "TXT" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "开始导出" }).click();
    await expect(page.getByText("导出完成，已写入导出历史。")).toBeVisible({
      timeout: 30_000,
    });
    const historyRow = page.locator(".export-history-row").first();
    await expect(historyRow).toContainText(".txt");
    await expect(historyRow.getByRole("button", { name: "下载" })).toBeEnabled();

    await page.getByRole("button", { name: "重新检查" }).click();
    await expect(page.getByText("发布检查完成，可以继续核对发布文案。")).toBeVisible();
    await expect(page.locator(".publish-check")).toHaveCount(13);
    await expect(page.locator(".publish-check.blocked")).toHaveCount(0);
    await expect(page.locator(".publish-check.warning").first()).toBeVisible();

    const readerTrigger = page.getByRole("button", { name: "读者预览" });
    await readerTrigger.click();
    const readerDialog = page.getByRole("dialog", { name: "山海照夜" });
    await expect(readerDialog).toBeVisible();
    await expect(readerDialog.getByText("第 1 章", { exact: true })).toBeVisible();
    await expect(readerDialog.getByRole("button", { name: "关闭读者预览" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(readerDialog).toHaveCount(0);
    await expect(readerTrigger).toBeFocused();
    await readerTrigger.click();
    await readerDialog.getByRole("button", { name: "返回编辑" }).click();
    await expect(readerDialog).toHaveCount(0);

    await page.getByRole("button", { name: "生成发布文案" }).click();
    await expect(page.locator(".publish-copy-card")).toContainText("山海照夜");
    await page.getByRole("button", { name: "复制文案" }).click();
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("export-publish-copied")))
      .toContain("书名备选");

    await page.getByText("编辑书名、简介、标签与封面元数据").click();
    await expect(page.getByLabel("作品简介")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "标签" })).toBeVisible();
    await page.getByLabel("发布页需要保留 AI 生成内容说明").check();
    await page.getByLabel("已阅读原创与版权提醒，作品版权归作者所有").check();
    await page.getByRole("button", { name: "应用并重新检查" }).click();
    await expect(page.getByText("发布检查完成，可以继续核对发布文案。")).toBeVisible();

    const chapterResponse = await page.request.get(`${branchPath}/chapters/${chapters[0]!.id}`);
    expect(chapterResponse.ok()).toBe(true);
    const chapter = (await chapterResponse.json()).data as { version: number };
    const chapterToken = await getCsrf(page.request);
    const changedChapter = await page.request.post(
      `${branchPath}/chapters/${chapters[0]!.id}/versions`,
      {
        headers: { Origin: origin, "X-CSRF-Token": chapterToken },
        data: {
          version: chapter.version,
          content: `${"山灯换了新的旧名。".repeat(260)}这是第 1 章的后续修订。`,
        },
      },
    );
    expect(changedChapter.status()).toBe(201);
    await page.reload();
    await expect(page.getByText("作品版本已变化，请重新运行发布检查。")).toBeVisible();

    await page.getByRole("button", { name: "开始导出" }).click();
    await expect(page.getByText("导出完成，已写入导出历史。")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "重新检查" }).click();
    await expect(page.getByText("发布检查完成，可以继续核对发布文案。")).toBeVisible();
    await expect(page.getByText("作品版本已变化，请重新运行发布检查。")).toHaveCount(0);

    const otherRequest = await playwright.request.newContext({ baseURL: origin });
    try {
      await registerUser(
        otherRequest,
        uniqueEmail("export-publish-other"),
        "StrongPassword123",
        "其他租户",
      );
      const exportListResponse = await page.request.get(`${branchPath}/exports`);
      expect(exportListResponse.ok()).toBe(true);
      const exportList = (await exportListResponse.json()) as {
        data: Array<{ id: string }>;
      };
      const otherToken = await getCsrf(otherRequest);
      const forbidden = await otherRequest.post(`${branchPath}/publish-check`, {
        headers: {
          Origin: origin,
          "Idempotency-Key": "other-tenant-publish",
          "X-CSRF-Token": otherToken,
        },
        data: {
          exportId: exportList.data[0]!.id,
          platformPreset: "generic",
          metadata: publishMetadata(),
        },
      });
      expect(forbidden.status()).toBe(403);
      expect((await forbidden.json()).error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    } finally {
      await otherRequest.dispose();
    }

    await page.getByRole("button", { name: "查看完整目录" }).click();
    await expect(page.locator(".export-toc > div")).toHaveCount(chapters.length);
    await expect(page.getByRole("button", { name: "收起目录" })).toBeVisible();
    await expect(page.getByRole("link", { name: "导出与发布", exact: true })).toBeVisible();
    await expectAuthorFacingLanguage(page);
    await expectNoPrototypeOnlyLeakage(page);

    for (const width of viewports) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/workspace/${work.id}/export`);
      await expect(page.getByRole("heading", { name: "把故事带出去" })).toBeVisible();
      await expect(page.locator(".export-history-row")).toHaveCount(2);
      await expect(page.locator(".publish-check").first()).toBeVisible();
      await expect(page.getByLabel("当前作品与创作线")).toContainText("山海照夜");
      await expect(page.getByLabel("当前作品与创作线")).toContainText("主线");
      await expectAuthorFacingLanguage(page);
      await expectNoPrototypeOnlyLeakage(page);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
      const goldenPath = path.resolve(
        "artifacts/ui/golden/export-publish",
        `export-publish-${width}.png`,
      );
      if (existsSync(goldenPath)) {
        await expect(page).toHaveScreenshot(
          ["export-publish", `export-publish-${width}.png`],
          productionScreenshotOptions,
        );
      } else {
        const candidatePath = testInfo.outputPath(`export-publish-${width}.png`);
        await page.screenshot({
          animations: "disabled",
          caret: "hide",
          fullPage: true,
          path: candidatePath,
        });
        await testInfo.attach(`export-publish-${width}-candidate`, {
          contentType: "image/png",
          path: candidatePath,
        });
      }
    }
    await unfreezeTimestamps();

    const databaseUrl =
      process.env.E2E_DATABASE_URL ??
      "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_e2e";
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query(
        `UPDATE work_export_receipts
            SET expires_at = now() - interval '1 second'
          WHERE work_id = $1`,
        [work.id],
      );
    } finally {
      await pool.end();
    }
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.goto(`/workspace/${work.id}/export`);
    await expect(page.locator(".export-history-row").first()).toContainText("已过期");
    await expect(
      page.locator(".export-history-row").first().getByRole("button", { name: "重新导出" }),
    ).toBeVisible();
  } finally {
    await worker.stop();
  }
});

test("covers loading, empty, error and partial states with real recovery", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context, "导出状态作者");
  const work = await createWork(page.request, {
    mode: "blank",
    title: "空山未见",
  });
  const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;

  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const workUrl = `**/api/v1/works/${work.id}`;
  await page.route(workUrl, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`/workspace/${work.id}/export`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("正在加载导出与发布")).toBeVisible();
  release?.();
  await expect(page.getByRole("heading", { name: "把故事带出去" })).toBeVisible();
  await expect(
    page.getByText("还没有导出记录。选择范围和格式后即可生成第一份文件。"),
  ).toBeVisible();
  await expect(
    page.getByText("完成一次导出后，运行发布检查以查看书名、标签、钩子、字数和格式结果。"),
  ).toBeVisible();
  await page.unroute(workUrl);

  await page.route(workUrl, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "导出与发布加载失败。",
          details: {},
          requestId: "req_export_publish_error",
        },
      }),
    });
  });
  await page.reload();
  await expect(page.getByText("导出与发布加载失败。")).toBeVisible();
  await page.unroute(workUrl);
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("heading", { name: "把故事带出去" })).toBeVisible();

  await page.route(`${branchPath}/publish-check`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "发布预览加载失败。",
          details: {},
          requestId: "req_export_publish_partial",
        },
      }),
    });
  });
  await page.reload();
  await expect(page.getByText("已有发布预览暂不可用，仍可重新运行检查。")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始导出" })).toBeEnabled();
});

async function authenticatedPage(page: Page, context: BrowserContext, displayName: string) {
  const session = await registerUser(
    page.request,
    uniqueEmail("export-publish"),
    "StrongPassword123",
    displayName,
  );
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
}

function publishMetadata() {
  return {
    title: "山海照夜",
    author: "导出发布作者",
    summary: "一盏山灯在万妖夜行时熄灭，守灯人必须用自己的旧名重新点燃它。",
    tags: ["仙侠", "山灯"],
    coverHeadline: "山海照夜",
    coverSubline: "最后一盏山灯",
    coverTone: "cinnabar",
    aiDisclosure: false,
    copyrightAcknowledged: false,
  };
}

async function createChapters(
  request: APIRequestContext,
  branchPath: string,
  count: number,
): Promise<Array<{ id: string; number: number }>> {
  const chapters: Array<{ id: string; number: number }> = [];
  const titles = [
    "山门",
    "钟声",
    "旧名",
    "灯影",
    "夜路",
    "渡口",
    "纸人",
    "雪债",
    "断桥",
    "归灯",
    "天门",
    "空棺",
    "回声",
    "青玉",
    "血河",
    "照夜",
    "最后一页",
    "灯灭之前",
  ];
  for (let number = 1; number <= count; number += 1) {
    const title = titles[(number - 1) % titles.length] ?? `第 ${number} 章`;
    const token = await getCsrf(request);
    const created = await request.post(`${branchPath}/chapters`, {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        number,
        title,
        brief: {
          goal: `推进第 ${number} 章的守灯线索。`,
          pov: "沈砚",
          location: "忘川渡",
          sceneBeats: ["沈砚追查山灯的旧名。", "门外传来第三次钟声。"],
          requiredFacts: ["山灯只能由守灯人的旧名点燃"],
        },
      },
    });
    expect(created.status()).toBe(201);
    const chapter = (await created.json()).data as { id: string; version: number };
    const versionToken = await getCsrf(request);
    const version = await request.post(`${branchPath}/chapters/${chapter.id}/versions`, {
      headers: { Origin: origin, "X-CSRF-Token": versionToken },
      data: {
        version: chapter.version,
        content:
          `第 ${number} 章，山灯在夜风里摇了一次。` +
          "沈砚把旧名写在灯纸上，火苗映出许多已经忘记的面孔。".repeat(85),
      },
    });
    expect(version.status()).toBe(201);
    chapters.push({ id: chapter.id, number });
  }
  return chapters;
}

async function freezePublishTimestamps(page: Page): Promise<() => Promise<void>> {
  const routePattern = "**/api/v1/**";
  const handler = async (route: Route) => {
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
    await route.fulfill({ response, json: freezePublishValue(payload) });
  };
  await page.route(routePattern, handler);
  return async () => {
    await page.unroute(routePattern, handler);
  };
}

function freezePublishValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => freezePublishValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entry]) => [
      entryKey,
      entryKey === "expiresAt"
        ? "2099-01-01T00:00:00.000Z"
        : /(At|timestamp)$/u.test(entryKey) && typeof entry === "string"
          ? "2026-11-05T08:50:00.000Z"
          : freezePublishValue(entry),
    ]),
  );
}
