import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { expectAuthorFacingLanguage } from "../helpers/ui";

const origin = "http://localhost:3000";

async function authenticatedPage(page: Page, context: BrowserContext) {
  const email = uniqueEmail("entity-detail");
  const session = await registerUser(page.request, email, "StrongPassword123", "人物档案作者");
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

test.beforeEach(async () => {
  await resetRateLimits();
});

test("shows the minimal character body, knowledge and relationship detail", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "idea",
    title: "忘川书",
    idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  });
  const token = await getCsrf(page.request);
  await page.request.post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      type: "character",
      name: "沈砚",
      aliases: ["小砚"],
      summary: "被宗门抛弃的外门杂役。",
      description: "谨慎、记仇，但会为救过自己的人承担风险。",
      tags: ["主角"],
      data: {
        bodyState: "左臂骨折，不能双手结印。",
        knowledgeBoundary: "不知道父母死于仇杀。",
        relationshipSummary: "与顾青表面亲近，实际互相试探。",
      },
    },
  });

  await page.goto(`/workspace/${work.id}/settings`);
  await page.getByRole("button", { name: /^人物/ }).click();
  await page
    .locator(".settings-entity-card", { hasText: "沈砚" })
    .getByRole("button", { name: "查看设定详情" })
    .click();

  const detail = page.locator(".settings-entity-detail");
  await expect(detail.getByRole("heading", { name: "沈砚" })).toBeVisible();
  await expect(detail.getByText("当前身体状态")).toBeVisible();
  await expect(detail.getByText("左臂骨折，不能双手结印。")).toBeVisible();
  await expect(detail.getByText("知识边界")).toBeVisible();
  await expect(detail.getByText("不知道父母死于仇杀。")).toBeVisible();
  await expect(detail.getByText("关系摘要")).toBeVisible();
  await expect(detail.getByText("与顾青表面亲近，实际互相试探。")).toBeVisible();
  await expectAuthorFacingLanguage(page);
});
