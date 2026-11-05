import { expect, test, type Page } from "@playwright/test";

import { getCsrf, mailCode, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import {
  createConfirmedSettings,
  createM0Chapter,
  seedM0Work,
  type M0WorkFixture,
} from "../helpers/m0";
import { expectAuthorFacingLanguage } from "../helpers/ui";
import { startWorker } from "../helpers/worker";

const viewports = [390, 900, 1180, 1440] as const;
const frozenTimestamp = "2026-11-05T08:50:00.000Z";
const screenshotOptions = {
  animations: "disabled",
  caret: "hide",
  fullPage: true,
  maxDiffPixelRatio: 0.005,
  scale: "css",
} as const;

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async () => {
  await resetRateLimits();
});

test("completes the full M0 author journey through the production UI", async ({
  page,
}, testInfo) => {
  const email = uniqueEmail("m0-journey");
  await page.goto("/register");
  await page.getByLabel("邮箱").fill(email);
  await page.getByRole("button", { name: "发送验证码" }).click();
  await expect(page.getByText("验证码已发送，请检查邮箱。")).toBeVisible();
  await page.getByLabel("验证码").fill(await mailCode(email));
  await page.getByLabel("显示名称").fill("全链路作者");
  await page.getByLabel("密码").fill("StrongPassword123");
  await page.getByRole("button", { name: "注册并进入" }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  await page.goto("/workspace/settings/account");
  await page.getByLabel("配置名称").fill("DeepSeek 正文");
  await page.getByLabel("API Key").fill("sk-journey-secret-1234");
  await page.getByRole("checkbox", { name: "正文" }).check();
  await page.getByRole("button", { name: "新增配置" }).click();
  await expect(page.getByText("模型配置已保存。")).toBeVisible();
  await expect(page.getByText("****1234")).toBeVisible();
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText("连接正常。")).toBeVisible();

  await page.goto("/workspace/new-project");
  await page.getByLabel("书名").fill("忘川书");
  await page.getByLabel("故事灵感").fill("一个被宗门抛弃的杂役，意外得到一本会吞噬记忆的古书。");
  await page.getByRole("button", { name: "创建作品并进入总览" }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  const workId = /\/workspace\/([0-9a-f-]+)\/overview/.exec(page.url())?.[1];
  expect(workId).toBeTruthy();
  const workResponse = await page.request.get(`/api/v1/works/${workId}`);
  expect(workResponse.ok()).toBe(true);
  const work = (await workResponse.json()).data as M0WorkFixture;
  const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;

  await page.goto(`/workspace/${work.id}/bible`);
  await page.locator(".story-bible-empty").getByRole("button", { name: "生成九卡提案" }).click();
  await expect(page.getByRole("heading", { name: "九卡已完整" })).toBeVisible();
  await page.getByRole("button", { name: "锁定故事圣经" }).click();
  await expect(page.getByText("故事圣经已锁定，修改需要发起修改请求。")).toBeVisible();

  await page.goto(`/workspace/${work.id}/outline`);
  await page.getByRole("spinbutton", { name: "章节序号" }).fill("1");
  await page.getByRole("textbox", { name: "章节标题" }).fill("一只手也能结印");
  await page
    .getByRole("textbox", { name: "章目标" })
    .fill("让沈砚在断臂后找到新的战斗方式，并让顾青第一次怀疑他。");
  await page.getByRole("textbox", { name: "POV" }).fill("沈砚");
  await page.getByRole("textbox", { name: "地点" }).fill("荒寺外山道");
  await page
    .getByRole("textbox", { name: "场景节拍（一行一个）" })
    .fill(
      [
        "沈砚藏起断臂，被顾青撞见。",
        "血河宗追兵逼近，两人被迫联手。",
        "沈砚单手结印，忘川书短暂显形。",
        "顾青看见书页一角，但没有点破。",
      ].join("\n"),
    );
  await page
    .getByRole("textbox", { name: "必用事实（一行一个）" })
    .fill(["左臂骨折，不能双手结印", "顾青不知道忘川书完整来历"].join("\n"));
  await page.getByRole("button", { name: "创建章纲" }).click();
  await expect(page.getByRole("heading", { name: "一只手也能结印" })).toBeVisible();

  await createConfirmedSettings(page.request, branchPath);
  const chapterResponse = await page.request.get(`${branchPath}/chapters`);
  expect(chapterResponse.ok()).toBe(true);
  const chapter = (await chapterResponse.json()).data[0] as { id: string };
  expect(chapter.id).toBeTruthy();

  const worker = await startWorker();
  try {
    await page.goto(`/workspace/${work.id}/write?chapterId=${chapter.id}`);
    await page.getByRole("button", { name: "生成整章" }).click();
    await expect(
      page.locator(".writing-generation").getByRole("heading", { name: "等待审阅" }),
    ).toBeVisible({ timeout: 15_000 });

    const factsPanel = page.getByRole("region", { name: "本章事实" });
    const optionalFact = factsPanel
      .locator(".writing-fact-card")
      .filter({ has: page.locator(".writing-fact-risk-low") })
      .first();
    await expect(optionalFact).toBeVisible();
    await optionalFact.getByRole("button", { name: "驳回" }).click();
    await expect(optionalFact.getByText("已驳回", { exact: true })).toBeVisible();

    const highRiskFact = factsPanel
      .locator(".writing-fact-card")
      .filter({ has: page.locator(".writing-fact-risk-high") });
    await highRiskFact.getByRole("button", { name: "确认", exact: true }).click();
    await expect(highRiskFact.getByText("已确认", { exact: true })).toBeVisible();

    const mediumRiskFact = factsPanel
      .locator(".writing-fact-card")
      .filter({ has: page.locator(".writing-fact-risk-medium") });
    await mediumRiskFact.getByRole("button", { name: "确认", exact: true }).click();
    await expect(mediumRiskFact.getByText("已确认", { exact: true })).toBeVisible();
    await expect(factsPanel.getByText("先批准本章，才能提交事实。")).toBeVisible();
    await factsPanel.getByRole("button", { name: "批准本章" }).click();
    await expect(factsPanel.getByRole("button", { name: "本章已批准" })).toBeDisabled();
    await expect(factsPanel.getByText("已满足提交条件，可以提交本章事实。")).toBeVisible();
    const submit = factsPanel.getByRole("button", { name: "提交本章事实" });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(factsPanel.getByRole("button", { name: "本章事实已提交" })).toBeDisabled();
    await expect(factsPanel.getByText("摘要已更新")).toBeVisible();
    await expectAuthorFacingLanguage(page);
    await testInfo.attach("m0-journey-completed", {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });

    await page.goto(`/workspace/${work.id}/settings`);
    await page.getByRole("button", { name: "查看已确认设定" }).click();
    const confirmed = page.locator(".confirmed-settings");
    await expect(confirmed.getByText("章节事实").first()).toBeVisible();
    await expectAuthorFacingLanguage(page);

    const submittedFacts = await page.request.get(`${branchPath}/facts`);
    expect(submittedFacts.ok()).toBe(true);
    expect(
      (await submittedFacts.json()).data.filter((item: { kind?: string }) => item.kind === "fact"),
    ).toHaveLength(2);
  } finally {
    await worker.stop();
  }
});

test("checks every M0 parity page at all signed-off viewports and author language", async ({
  page,
  context,
  request,
}) => {
  const email = uniqueEmail("m0-parity");
  const session = await registerUser(request, email, "StrongPassword123", "M0 验收作者");
  await freezeApiTimestamps(page);
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "欢迎回来" }).first()).toBeVisible();
    await expectAuthorFacingLanguage(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page).toHaveScreenshot(["auth", `auth-${width}.png`], screenshotOptions);
  }
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
  const work = await seedM0Work(request);
  const chapter = await createM0Chapter(request, work);
  const pages = [
    { id: "dashboard", path: "/workspace", heading: "工作台", ready: ".project-card" },
    {
      id: "new-project",
      path: "/workspace/new-project",
      heading: "把一个想法，长成一本书",
      ready: ".mode-switch",
    },
    {
      id: "account-settings",
      path: "/workspace/settings/account",
      heading: "把写作环境准备好",
      ready: ".model-config-row, .model-empty",
    },
    {
      id: "work-overview",
      path: `/workspace/${work.id}/overview`,
      heading: work.title,
      ready: ".overview-hero",
    },
    {
      id: "bible",
      path: `/workspace/${work.id}/bible`,
      heading: work.title,
      ready: ".story-bible-layout",
    },
    {
      id: "settings",
      path: `/workspace/${work.id}/settings`,
      heading: "设定中心",
      ready: ".settings-workspace-grid",
    },
    {
      id: "outline",
      path: `/workspace/${work.id}/outline`,
      heading: "大纲工作台",
      ready: ".outline-workspace-grid",
    },
    {
      id: "writing",
      path: `/workspace/${work.id}/write?chapterId=${chapter.id}`,
      heading: "写作台",
      ready: ".writing-editor",
    },
  ] as const;

  for (const pageContract of pages) {
    for (const width of viewports) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(pageContract.path);
      await expect(page.getByRole("heading", { name: pageContract.heading }).first()).toBeVisible();
      await expect(page.locator(pageContract.ready).first()).toBeVisible();
      await expectAuthorFacingLanguage(page);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await expect(page).toHaveScreenshot(
        [pageContract.id, `${pageContract.id}-${width}.png`],
        screenshotOptions,
      );
    }
  }

  const csrf = await getCsrf(request);
  expect(csrf.length).toBeGreaterThan(20);
});

async function freezeApiTimestamps(page: Page) {
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
