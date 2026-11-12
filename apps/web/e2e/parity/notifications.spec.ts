import { randomBytes } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { NotificationType } from "@novel-brain/contracts";
import { Pool } from "pg";

import { registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";

const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_e2e";
const pool = new Pool({ connectionString: databaseUrl });
const viewportWidths = [390, 900, 1180, 1440];

test.beforeEach(async () => {
  await resetRateLimits();
});

test.afterAll(async () => {
  await pool.end();
});

test("reads individual and all notifications from the real API", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const email = await authenticatedPage(page, context);
  const olderNotifications = Array.from({ length: 8 }, (_, index) => ({
    type: "job_completed" as const,
    targetType: "job" as const,
    title: `历史任务完成 ${index + 1}`,
    message: "历史任务已完成。",
    dedupeKey: `job:history:${index + 1}`,
  }));
  await seedNotifications(email, [
    ...olderNotifications,
    {
      type: "job_completed",
      targetType: "job",
      title: "批量任务已完成",
      message: "第一卷已完成批量生成。",
      dedupeKey: "job:first:completed",
    },
    {
      type: "review_required",
      targetType: "review",
      title: "批量任务等待审核",
      message: "有一章需要作者确认。",
      dedupeKey: "review:second:required",
    },
  ]);

  await page.goto("/workspace");
  const trigger = page.getByRole("button", { name: "通知，10 条未读" });
  await trigger.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(page.getByText("批量任务已完成")).toBeVisible();
  await expect(page.getByText("批量任务等待审核")).toBeVisible();

  await page.getByRole("button", { name: /批量任务已完成/u }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole("button", { name: "通知，9 条未读" })).toBeVisible();

  await page.getByRole("button", { name: "通知，9 条未读" }).click();
  await page.getByRole("button", { name: "全部已读" }).click();
  await expect(page.getByRole("button", { name: "通知", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "没有未读通知" })).toBeVisible();
  await expect(page.getByText("全部已读")).toBeVisible();
});

for (const width of viewportWidths) {
  test(`opens the empty notification drawer at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await authenticatedPage(page, context);
    await page.goto("/workspace");
    await page.getByRole("button", { name: "通知", exact: true }).click();

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(page.getByText("暂无通知")).toBeVisible();

    const box = await drawer.boundingBox();
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    expect(box?.x).toBeGreaterThanOrEqual(-0.5);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((viewport?.width ?? 0) + 0.5);
    expect(box?.width).toBeLessThanOrEqual(width + 0.5);
    expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    if (width <= 760) {
      expect(box?.width).toBeCloseTo(width, 0);
    }

    await page.getByRole("button", { name: "关闭通知" }).click();
    await expect(page.getByRole("button", { name: "通知", exact: true })).toBeFocused();
  });
}

async function authenticatedPage(page: Page, context: BrowserContext): Promise<string> {
  const email = uniqueEmail("notifications");
  const session = await registerUser(page.request, email, "StrongPassword123", "通知作者");
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
  return email;
}

interface NotificationSeed {
  type: NotificationType;
  targetType: "job" | "review";
  title: string;
  message: string;
  dedupeKey: string;
}

async function seedNotifications(email: string, seeds: NotificationSeed[]): Promise<void> {
  const user = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  const userId = user.rows[0]?.id;
  if (!userId) {
    throw new Error(`Notification user not found: ${email}`);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    for (const [index, seed] of seeds.entries()) {
      await client.query(
        `INSERT INTO notifications (
           id, user_id, work_id, branch_id, type, target_type, target_id,
           payload, dedupe_key, read_at, created_at
         ) VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6::jsonb, $7, NULL, $8)`,
        [
          uuidv7(),
          userId,
          seed.type,
          seed.targetType,
          uuidv7(),
          JSON.stringify({
            title: seed.title,
            message: seed.message,
            href: "/workspace",
          }),
          seed.dedupeKey,
          new Date(Date.now() - (seeds.length - index) * 60_000),
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function uuidv7(): string {
  const bytes = randomBytes(16);
  const timestamp = Date.now();
  for (let index = 0; index < 6; index += 1) {
    bytes[index] = Math.floor(timestamp / 2 ** ((5 - index) * 8)) & 0xff;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
