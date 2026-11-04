import { expect, test } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const prototypeUrl = pathToFileURL(
  path.resolve(__dirname, '../index.html'),
).href;

const pages = [
  'auth',
  'dashboard',
  'new-project',
  'work-overview',
  'bible',
  'settings',
  'outline',
  'foreshadows',
  'writing',
  'batch',
  'changes',
  'export-publish',
  'work-settings',
  'entity-detail',
  'account-settings',
  'help',
  'legal',
  'states',
];

test.describe('prototype route and responsive parity', () => {
  for (const pageName of pages) {
    test(`${pageName} holds at 1440/1180/900/390`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1180, height: 900 },
        { width: 900, height: 900 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(`${prototypeUrl}#${pageName}`);
        await expect(page.locator('.app-shell')).toBeVisible();
        await expect(page.locator(`.page[data-page="${pageName}"]`)).toHaveClass(
          /active/,
        );

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
      }

      expect(errors).toEqual([]);
    });
  }
});

test.describe('page-specific states', () => {
  const cases: Array<[string, string]> = [
    ['dashboard', 'empty'],
    ['new-project', 'long'],
    ['work-overview', 'partial'],
    ['bible', 'locked'],
    ['writing', 'conflict'],
    ['writing', 'partial'],
    ['batch', 'partial'],
    ['changes', 'error'],
    ['outline', 'partial'],
    ['settings', 'locked'],
    ['foreshadows', 'long'],
    ['export-publish', 'partial'],
    ['work-settings', 'permission'],
    ['entity-detail', 'locked'],
    ['account-settings', 'permission'],
    ['help', 'error'],
    ['legal', 'readonly'],
    ['states', 'long'],
    ['auth', 'error'],
    ['states', 'disabled'],
  ];

  for (const [pageName, state] of cases) {
    test(`${pageName} renders ${state} inside the page`, async ({ page }) => {
      await page.goto(`${prototypeUrl}#${pageName}`);
      await page.evaluate(
        ([targetPage, targetState]) => {
          (window as unknown as { navigate: (page: string) => void }).navigate(
            targetPage,
          );
          (
            window as unknown as { setDemoState: (state: string) => void }
          ).setDemoState(targetState);
        },
        [pageName, state],
      );

      const panel = page.locator(
        `.page[data-page="${pageName}"] .page-state-panel[data-state="${state}"]`,
      );
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('button', { name: '返回正常' })).toBeVisible();

      await panel.getByRole('button', { name: '返回正常' }).click();
      await expect(panel).toHaveCount(0);
    });
  }
});

test.describe('prototype gates and author language', () => {
  test('structural conflicts cannot be applied directly', async ({ page }) => {
    await page.goto(`${prototypeUrl}#changes`);
    await expect(
      page.getByRole('button', { name: '结构性冲突不可直接应用' }),
    ).toBeDisabled();
  });

  test('locked bible and entity controls are disabled', async ({ page }) => {
    await page.goto(`${prototypeUrl}#bible`);
    await expect(
      page.getByRole('button', { name: '已锁定 · 走修改请求' }),
    ).toBeDisabled();

    await page.goto(`${prototypeUrl}#entity-detail`);
    await expect(
      page.getByRole('button', { name: '已锁定 · 删除需修改请求' }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: '已锁定 · 编辑需修改请求' }),
    ).toBeDisabled();
  });

  test('work and account deletion require export', async ({ page }) => {
    await page.goto(`${prototypeUrl}#dashboard`);
    await page.getByRole('button', { name: '回收站', exact: true }).click();
    await expect(
      page
        .locator('[data-work-id="w-5"]')
        .getByRole('button', { name: '先导出再删除' }),
    ).toBeDisabled();

    await page.goto(`${prototypeUrl}#work-settings`);
    const workDelete = page.locator('.danger-action', {
      hasText: '永久删除',
    });
    await expect(workDelete).toBeDisabled();

    await page.goto(`${prototypeUrl}#account-settings`);
    await expect(
      page.getByRole('button', { name: '先导出再删除' }),
    ).toBeDisabled();
  });

  test('golden three cannot be locked before all six dimensions pass', async ({
    page,
  }) => {
    await page.goto(`${prototypeUrl}#outline`);
    await expect(
      page.getByRole('button', { name: '六维评审未达标 · 暂不可锁定' }),
    ).toBeDisabled();
  });

  test('unresolved import conflict blocks entering the work overview', async ({
    page,
  }) => {
    await page.goto(`${prototypeUrl}#new-project`);
    await page.getByRole('button', { name: '导入旧稿', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '先裁决 1 条冲突' }),
    ).toBeDisabled();
  });

  test('settings import supports partial or complete settings before creation', async ({
    page,
  }) => {
    await page.goto(`${prototypeUrl}#new-project`);
    await page.getByRole('button', { name: '导入设定', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '把人物、势力、地图和体系带进来' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '先裁决 1 条冲突' }),
    ).toBeDisabled();
    await page.getByRole('button', { name: '开始识别' }).click();
    await expect(
      page.locator('#settings-import-preview .import-preview-head .badge'),
    ).toHaveText('识别完成');
  });

  test('import parsing can pause and resume from a checkpoint', async ({
    page,
  }) => {
    await page.goto(`${prototypeUrl}#new-project`);
    await page.getByRole('button', { name: '导入旧稿', exact: true }).click();
    await page.getByRole('button', { name: '暂停解析' }).click();
    await expect(page.locator('#import-progress-text')).toHaveText(
      /解析已暂停 · 已处理 3 \/ 12 块/,
    );
    await page.getByRole('button', { name: '从检查点继续' }).click();
    await expect(page.locator('#import-progress-text')).toHaveText(
      /后台分块解析中 · 已处理 3 \/ 12 块/,
    );
  });

  test('locked entity aliases require a change request', async ({ page }) => {
    await page.goto(`${prototypeUrl}#entity-detail`);
    await expect(
      page.getByRole('button', { name: '已锁定 · 别名需修改请求' }),
    ).toBeDisabled();
  });

  test('facts require chapter approval and a separate submit action', async ({
    page,
  }) => {
    await page.goto(`${prototypeUrl}#writing`);
    await page.locator('[data-note-tab="facts"]').click();

    const submit = page.getByRole('button', { name: '提交本章事实' });
    await expect(submit).toBeDisabled();

    await page
      .locator('[data-note-panel="facts"] .note-card[data-fact-status="pending"]')
      .first()
      .getByRole('button', { name: '确认', exact: true })
      .click();
    await page
      .locator('[data-note-panel="facts"] .note-card[data-fact-status="pending"]')
      .getByRole('button', { name: '确认', exact: true })
      .click();

    await expect(page.locator('body')).not.toContainText('已写入已确认设定');
    await expect(submit).toBeDisabled();

    await page.getByRole('button', { name: '批准本章' }).click();
    await page.locator('#confirm-submit').click();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.locator('#editor-chapter-status')).toHaveText(
      '事实已提交',
    );
  });

  test('state matrix no longer advertises old gaps', async ({ page }) => {
    await page.goto(`${prototypeUrl}#states`);
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/七态全局演示|缺口/);
    await expect(page.getByText('全部 11 类')).toBeVisible();
  });

  test('visible author language does not leak internal terms', async ({ page }) => {
    for (const pageName of pages) {
      await page.goto(`${prototypeUrl}#${pageName}`);
      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(
        /Agent|Canon|Context Pack|上下文包|生成上下文|单一版本图|淘汰记录|P0|P1|P2|P3|P4|正史/,
      );
    }
  });
});
