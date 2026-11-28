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
  'blueprint',
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
    ['blueprint', 'empty'],
    ['blueprint', 'loading'],
    ['blueprint', 'error'],
    ['blueprint', 'disabled'],
    ['blueprint', 'readonly'],
    ['blueprint', 'partial'],
    ['blueprint', 'long'],
    ['blueprint', 'conflict'],
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

test.describe('story blueprint review', () => {
  test('shows the candidate sections and budget evidence', async ({ page }) => {
    await page.goto(`${prototypeUrl}#blueprint`);

    await expect(
      page.getByRole('heading', { name: '审阅故事蓝图' }),
    ).toBeVisible();
    await expect(page.locator('.story-bible-card')).toHaveCount(9);
    await expect(
      page.getByRole('heading', { name: '核心设定候选' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '初始大纲基线' }),
    ).toBeVisible();
    await expect(page.getByText('世界规则 · 3 条')).toBeVisible();
    await expect(page.getByText('起点时间线 · 1 条')).toBeVisible();
    await expect(page.getByText('物品候选 · 0 / 1')).toBeVisible();
    await expect(
      page.locator('#blueprint-volume-chapters .blueprint-table-row'),
    ).toHaveCount(12);
    await expect(
      page.locator('#blueprint-scene-strip article'),
    ).toHaveCount(24);
    await expect(page.locator('.blueprint-act-strip span')).toHaveCount(3);
    await expect(
      page.locator('.blueprint-scene-card').first(),
    ).toContainText(/POV\s*沈砚/);
    await expect(
      page.locator('.blueprint-scene-card').first(),
    ).toContainText(/有序节拍/);
    await expect(
      page.locator('.blueprint-scene-card').first(),
    ).toContainText(/信息释放/);
    await expect(
      page.locator('#blueprint-volume-chapters .blueprint-table-row').first(),
    ).toContainText(/目标：/);
    await expect(
      page.locator('#blueprint-volume-chapters .blueprint-table-row').first(),
    ).toContainText(/必用事实：/);
    await expect(page.getByText('Token 用量')).toBeVisible();
    await expect(page.getByText('费用与预算')).toBeVisible();
  });

  test('requires conflict resolution and a reasoned not-applicable decision', async ({
    page,
  }) => {
    await page.goto(`${prototypeUrl}#blueprint`);

    const confirm = page.locator('#blueprint-confirm-button');
    const reason = page.locator('#blueprint-confirm-reason');
    await expect(confirm).toBeDisabled();
    await expect(reason).toContainText('先处理 1 项必须解决冲突');

    await page
      .getByRole('button', { name: '标记已解决', exact: true })
      .click();
    await expect(confirm).toBeDisabled();
    await expect(reason).toContainText('先补全 1 个必填项');

    await page.getByRole('button', { name: '标记不适用' }).click();
    const notApplicableReason = page.locator('#blueprint-na-reason');
    await notApplicableReason.fill(
      '前 12 章只写人物关系和追索，不引入可追踪物品。',
    );
    await page.getByRole('button', { name: '确认不适用' }).click();
    await expect(page.locator('#blueprint-required-field')).toHaveAttribute(
      'data-field-state',
      'not_applicable',
    );
    await expect(page.locator('#blueprint-na-evidence')).toContainText(
      '前 12 章只写人物关系和追索',
    );
    await expect(
      page.locator('#blueprint-missing-gate-severity'),
    ).toHaveText('已处理');
    await expect(confirm).toBeEnabled();

    await confirm.click();
    await expect(page.locator('.page[data-page="blueprint"]')).toHaveAttribute(
      'data-blueprint-status',
      'confirmed',
    );
    await expect(
      page.getByRole('heading', { name: '仙途：忘川书' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '蓝图已完成' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '开始写第一章' }),
    ).toBeVisible();
  });

  test('covers lifecycle and recovery states', async ({ page }) => {
    await page.goto(`${prototypeUrl}#blueprint`);
    const blueprintPage = page.locator('.page[data-page="blueprint"]');

    const scenarios = [
      ['生成中', 'running', '正在整理世界观与前三卷主线'],
      ['等待模型配置', 'waiting_model_config', '还差一个可用的模型连接'],
      ['预算暂停', 'budget_paused', '下一次模型调用会超过当前预算'],
      ['失败', 'failed', '初始大纲第二卷中断'],
      ['冲突', 'conflict', '有一条时间线冲突会阻止确认'],
      ['已确认', 'confirmed', '故事圣经、核心设定和初始大纲已锁定'],
      ['已取消', 'cancelled', '候选和检查点仍然保留'],
    ] as const;

    for (const [label, status, heading] of scenarios) {
      await page
        .locator(
          `.blueprint-scenario-switcher [data-blueprint-scenario="${status}"]`,
        )
        .click();
      await expect(blueprintPage).toHaveAttribute(
        'data-blueprint-status',
        status,
      );
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }

    await expect(
      page
        .locator('[data-blueprint-status-panel="cancelled"]')
        .getByRole('button', { name: '重新生成', exact: true }),
    ).toHaveCount(0);

    await page
      .locator('[data-blueprint-scenario="waiting_model_config"]')
      .click();
    await page.getByRole('button', { name: '配置完成后重试' }).click();
    await expect(blueprintPage).toHaveAttribute(
      'data-blueprint-status',
      'running',
    );
  });

  test('drives candidate completeness and readonly behavior from status', async ({
    page,
  }) => {
    await page.goto(`${prototypeUrl}#blueprint`);
    const blueprintPage = page.locator('.page[data-page="blueprint"]');

    await page
      .locator('[data-blueprint-scenario="waiting_model_config"]')
      .click();
    await expect(blueprintPage.locator('.blueprint-review-layout')).toBeHidden();
    await expect(page.locator('#blueprint-story-cost')).not.toBeVisible();
    await expect(page.locator('#blueprint-review-jump')).toBeHidden();

    await page.locator('[data-blueprint-scenario="running"]').click();
    await expect(page.locator('#blueprint-story-bible-badge')).toHaveText(
      '6 / 9 已生成',
    );
    await expect(
      page.locator('.story-bible-card:visible'),
    ).toHaveCount(6);
    await expect(
      page.locator('#blueprint-volume-chapters .blueprint-table-row em', {
        hasText: '等待生成',
      }),
    ).toHaveCount(12);
    await expect(
      page.locator('[data-blueprint-outline-meta]').first(),
    ).toHaveText('第 1 卷生成中');

    await page.locator('[data-blueprint-scenario="confirmed"]').click();
    await expect(page.locator('#blueprint-story-bible-badge')).toHaveText(
      '9 / 9 已锁定',
    );
    await expect(page.locator('[data-blueprint-volume]').first()).toBeEnabled();
    await expect(
      page.getByRole('button', { name: '已解决', exact: true }),
    ).toBeDisabled();
    await expect(page.locator('#blueprint-mark-na-button')).toBeHidden();
    await page.locator('.story-bible-card-head').nth(1).click();
    await expect(page.locator('.story-bible-card').nth(1)).toHaveClass(
      /active/,
    );

    await page.locator('[data-blueprint-volume]').nth(1).click();
    await expect(page.locator('#blueprint-volume-kicker')).toHaveText('第二卷');
    await page
      .locator('[data-blueprint-status-panel="confirmed"]')
      .getByRole('button', { name: '返回作品总览' })
      .click();
    await expect(
      page.getByRole('heading', { name: '蓝图已完成' }),
    ).toBeVisible();

    await page.goto(`${prototypeUrl}#blueprint`);
    await page.locator('[data-blueprint-scenario="cancelled"]').click();
    await page.getByRole('button', { name: '返回作品总览' }).click();
    await expect(page.locator('#blueprint-completion-banner')).toBeHidden();
    await expect(page.locator('#work-overview-status-badge')).toHaveText(
      '连载中',
    );
  });

  test('loads matching chapter and scene evidence when switching volumes', async ({
    page,
  }) => {
    await page.goto(`${prototypeUrl}#blueprint`);
    const tabs = page.locator('[data-blueprint-volume]');

    await expect(tabs).toHaveCount(3);
    await expect(tabs.first()).toHaveAttribute('role', 'tab');
    await expect(page.locator('#blueprint-volume-detail')).toHaveAttribute(
      'aria-labelledby',
      'blueprint-volume-tab-1',
    );
    await tabs.nth(1).click();
    await expect(page.locator('#blueprint-volume-detail')).toHaveAttribute(
      'aria-labelledby',
      'blueprint-volume-tab-2',
    );
    await expect(page.locator('#blueprint-volume-kicker')).toHaveText('第二卷');
    await expect(
      page.locator('#blueprint-volume-chapters .blueprint-table-row').first(),
    ).toContainText('第 13 章');
    await expect(
      page.locator('#blueprint-scene-strip article').first(),
    ).toContainText('场景 13-1');

    await tabs.nth(1).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#blueprint-volume-kicker')).toHaveText('第三卷');
  });

  test('does not fake chapters while generating and skips hidden volume tabs', async ({
    page,
  }) => {
    await page.goto(`${prototypeUrl}#blueprint`);
    await page.locator('[data-blueprint-scenario="running"]').click();

    await expect(page.locator('[data-blueprint-volume]').nth(1)).toBeHidden();
    await expect(
      page.locator('#blueprint-volume-chapters .blueprint-table-row em', {
        hasText: '等待生成',
      }),
    ).toHaveCount(12);

    const firstTab = page.locator('[data-blueprint-volume]').first();
    await firstTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(firstTab).toHaveAttribute('aria-selected', 'true');
  });

  test('updates the conflict status after resolution', async ({ page }) => {
    await page.goto(`${prototypeUrl}#blueprint`);
    const blueprintPage = page.locator('.page[data-page="blueprint"]');
    await page.locator('[data-blueprint-scenario="conflict"]').click();
    await page
      .getByRole('button', { name: '标记已解决', exact: true })
      .click();

    await expect(blueprintPage).toHaveAttribute(
      'data-blueprint-status',
      'waiting_review',
    );
    await expect(
      page.locator('[data-blueprint-status-panel="waiting_review"] h2'),
    ).toHaveText('候选已齐，等待你的确认');
    await expect(page.locator('#blueprint-conflict-summary-badge')).toHaveText(
      '1 个必填项待处理',
    );
  });

  test('validates the recovered budget before leaving the paused state', async ({
    page,
  }) => {
    await page.goto(`${prototypeUrl}#blueprint`);
    const blueprintPage = page.locator('.page[data-page="blueprint"]');
    await page.locator('[data-blueprint-scenario="budget_paused"]').click();
    await page.locator('[data-blueprint-volume]').nth(1).click();
    await expect(
      page.locator('#blueprint-volume-chapters .blueprint-table-row em', {
        hasText: '已规划',
      }),
    ).toHaveCount(6);
    await expect(
      page.locator('#blueprint-volume-chapters .blueprint-table-row em', {
        hasText: '等待生成',
      }),
    ).toHaveCount(6);
    await expect(page.locator('#blueprint-scene-strip article')).toHaveCount(12);

    const budget = page.locator('#blueprint-budget-input');
    const tokenBudget = page.locator('#blueprint-token-budget-input');
    await budget.fill('2.42');
    await page.getByRole('button', { name: '提高预算并继续' }).click();
    await expect(blueprintPage).toHaveAttribute(
      'data-blueprint-status',
      'budget_paused',
    );
    await expect(page.locator('#blueprint-budget-error')).toBeVisible();

    await budget.fill('8');
    await tokenBudget.fill('220000');
    await page.getByRole('button', { name: '提高预算并继续' }).click();
    await expect(blueprintPage).toHaveAttribute(
      'data-blueprint-status',
      'running',
    );
    await expect(page.locator('#blueprint-cost-value')).toContainText('/ ¥8.00');
    await expect(
      page.locator('[data-blueprint-outline-meta]').first(),
    ).toHaveText('2 / 3 卷');
    await expect(page.locator('#blueprint-running-stage')).toContainText(
      '初始大纲 · 第二卷',
    );
    await expect(page.locator('#blueprint-token-limit')).toHaveText('220,000');
    await expect(page.locator('#blueprint-token-budget-input')).toHaveAttribute(
      'min',
      '68421',
    );
    await expect(page.locator('#blueprint-cost-badge')).toHaveText(
      '预算内继续生成',
    );
  });

  test('allows candidate editing only in review states', async ({ page }) => {
    await page.goto(`${prototypeUrl}#blueprint`);
    const storyText = page.locator('.story-bible-card p').first();
    const editStory = page.getByRole('button', { name: '编辑九卡' });

    await editStory.click();
    await expect(storyText).toHaveAttribute('contenteditable', 'true');
    await storyText.fill('作者修改后的故事核心。');
    await page.getByRole('button', { name: '完成九卡编辑' }).click();
    await expect(storyText).toHaveAttribute('contenteditable', 'false');
    await expect(storyText).toHaveText('作者修改后的故事核心。');

    await page.locator('[data-blueprint-scenario="confirmed"]').click();
    await expect(
      page.getByRole('button', { name: '编辑九卡' }),
    ).toBeDisabled();

    await page.locator('[data-blueprint-scenario="waiting_review"]').click();
    await page.getByRole('button', { name: '编辑章纲' }).click();
    await page.locator('[data-blueprint-volume]').nth(1).click();
    const volumeTitle = page.locator('#blueprint-volume-title');
    await expect(volumeTitle).toHaveAttribute('role', 'textbox');
    await volumeTitle.fill('东境风雷 · 作者修订');
    await page.getByRole('button', { name: '完成章纲编辑' }).click();
    await page.locator('[data-blueprint-volume]').nth(2).click();
    await page.locator('[data-blueprint-volume]').nth(1).click();
    await expect(volumeTitle).toHaveText('东境风雷 · 作者修订');
    await expect(volumeTitle).toHaveAttribute('contenteditable', 'false');
  });

  test('offers cancel in every resumable lifecycle state', async ({ page }) => {
    await page.goto(`${prototypeUrl}#blueprint`);
    for (const status of [
      'waiting_review',
      'waiting_model_config',
      'budget_paused',
    ]) {
      await page.locator(`[data-blueprint-scenario="${status}"]`).click();
      await expect(
        page
          .locator(`[data-blueprint-status-panel="${status}"]`)
          .getByRole('button', { name: '取消蓝图' }),
      ).toBeVisible();
    }

    await page
      .locator('[data-blueprint-scenario="waiting_model_config"]')
      .click();
    await page.getByRole('button', { name: '取消蓝图' }).click();
    await expect(
      page.locator('.page[data-page="blueprint"]'),
    ).toHaveAttribute('data-blueprint-status', 'cancelled');
    await expect(
      page.locator('#blueprint-cancelled-candidates-button'),
    ).toBeHidden();
    await expect(page.locator('#blueprint-cancelled-title')).toHaveText(
      '尚未开始生成',
    );
    await expect(page.locator('#blueprint-cancelled-copy')).toContainText(
      '没有产生候选或检查点',
    );
    await expect(page.locator('#blueprint-checkpoint-note')).toHaveText(
      '没有候选或检查点',
    );
    await expect(page.locator('#toast')).toHaveText(
      '已取消等待，尚未生成候选或检查点',
    );
  });

  test('retries from the failed checkpoint without losing completed candidates', async ({
    page,
  }) => {
    await page.goto(`${prototypeUrl}#blueprint`);
    await page.locator('[data-blueprint-scenario="failed"]').click();
    await page.getByRole('button', { name: '从检查点重试' }).click();

    await expect(
      page.locator('.page[data-page="blueprint"]'),
    ).toHaveAttribute('data-blueprint-status', 'running');
    await expect(page.locator('.story-bible-card:visible')).toHaveCount(9);
    await expect(
      page.locator('[data-blueprint-outline-meta]').first(),
    ).toHaveText('1 / 3 卷');
  });

  test('cancel preserves the current checkpoint, progress and cost', async ({
    page,
  }) => {
    await page.goto(`${prototypeUrl}#blueprint`);
    await page.locator('[data-blueprint-scenario="running"]').click();
    await page.getByRole('button', { name: '取消生成' }).click();

    await expect(
      page.locator('.page[data-page="blueprint"]'),
    ).toHaveAttribute('data-blueprint-status', 'cancelled');
    await expect(page.locator('#blueprint-cost-value')).toHaveText(
      '¥2.61 / ¥6.00',
    );
    await expect(page.locator('#blueprint-total-cost')).toHaveText('¥2.61');
    await expect(page.locator('#blueprint-cost-badge')).toHaveText(
      '已取消 · 不再计费',
    );
    await expect(page.locator('#blueprint-cost-badge')).not.toHaveClass(
      /jade-badge/,
    );
    await expect(page.locator('.story-bible-card:visible')).toHaveCount(6);
    await expect(page.locator('#blueprint-settings-badge')).toHaveText(
      '4 / 6 类已保留',
    );
    await expect(
      page.locator('[data-blueprint-outline-meta]').first(),
    ).toHaveText('第 1 卷已暂停');
    await expect(page.locator('#blueprint-cost-note')).toHaveText(
      '已停止继续调用模型',
    );
    await expect(page.locator('#blueprint-checkpoint-note')).toHaveText(
      '已取消但保留候选与检查点',
    );
    await expect(page.locator('#blueprint-progress-note')).toContainText(
      '已停止',
    );
  });

  test('maps generic readonly and disabled states to blueprint behavior', async ({
    page,
  }) => {
    await page.goto(`${prototypeUrl}#blueprint`);
    const blueprintPage = page.locator('.page[data-page="blueprint"]');

    await page.evaluate(() => {
      (
        window as unknown as { setDemoState: (state: string) => void }
      ).setDemoState('readonly');
    });
    await expect(blueprintPage).toHaveAttribute(
      'data-blueprint-status',
      'confirmed',
    );

    await page.getByRole('button', { name: '返回正常' }).click();
    await expect(blueprintPage).toHaveAttribute(
      'data-blueprint-status',
      'waiting_review',
    );
    await expect(
      page.getByRole('button', { name: '标记已解决', exact: true }),
    ).toBeEnabled();

    await page.evaluate(() => {
      (
        window as unknown as { setDemoState: (state: string) => void }
      ).setDemoState('disabled');
    });
    await expect(blueprintPage).toHaveAttribute(
      'data-blueprint-status',
      'budget_paused',
    );

    await page.getByRole('button', { name: '返回正常' }).click();
    await page.evaluate(() => {
      (
        window as unknown as { setDemoState: (state: string) => void }
      ).setDemoState('error');
    });
    await expect(blueprintPage).toHaveAttribute(
      'data-blueprint-status',
      'failed',
    );
  });

  test('keeps conflict severities in evidence and out of author-facing copy', async ({
    page,
  }) => {
    await page.goto(`${prototypeUrl}#blueprint`);

    await expect(
      page.locator('.blueprint-conflict[data-severity="P0"]'),
    ).toContainText('必须解决');
    await expect(
      page.locator('.blueprint-conflict[data-severity="P1"]'),
    ).toContainText('建议处理');
    await expect(
      page.locator('.blueprint-conflict[data-severity="P2"]'),
    ).toContainText('可选优化');
    await expect(page.locator('body')).not.toContainText(/P0|P1|P2/);
  });

  test('keeps critical blueprint regions unclipped at all four widths', async ({
    page,
  }) => {
    await page.goto(`${prototypeUrl}#blueprint`);

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1180, height: 900 },
      { width: 900, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(50);
      const clipped = await page.evaluate(() => {
        const selectors = [
          '.blueprint-status-card:not([hidden])',
          '.blueprint-metric',
          '.story-bible-card',
          '.blueprint-setting-card',
          '.blueprint-required-field',
          '.blueprint-table-row',
          '.blueprint-scene-strip article',
          '.blueprint-gate-item',
          '.blueprint-conflict',
          '.blueprint-confirm-card',
        ];
        return selectors.flatMap((selector) =>
          [...document.querySelectorAll<HTMLElement>(selector)]
            .filter((element) => element.offsetParent !== null)
            .filter((element) => element.scrollWidth > element.clientWidth + 1)
            .map((element) => ({
              selector,
              viewportWidth: window.innerWidth,
              text: element.textContent?.trim().slice(0, 80),
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
            })),
        );
      });
      expect(clipped).toEqual([]);

      const regionsOverlap = await page.evaluate(() => {
        const metrics = document
          .querySelector('.blueprint-metric-grid')
          ?.getBoundingClientRect();
        const review = document
          .querySelector('.blueprint-review-layout')
          ?.getBoundingClientRect();
        return Boolean(
          metrics && review && review.top < metrics.bottom - 1,
        );
      });
      expect(regionsOverlap).toBe(false);
    }
  });
});

test.describe('prototype gates and author language', () => {
  test('account settings exposes a masked invalid-key recovery path', async ({
    page,
  }) => {
    await page.goto(`${prototypeUrl}#account-settings`);
    const invalidKey = page.locator('[data-key-state="invalid"]');
    await expect(invalidKey).toContainText('Key ••••••••');
    await expect(invalidKey).toContainText('Key 无效或已失效');
    await expect(
      invalidKey.getByRole('button', { name: '替换 Key' }),
    ).toBeVisible();
  });

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
