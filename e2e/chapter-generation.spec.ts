import { expect, test, type Page } from '@playwright/test';

type MailpitMessage = {
  ID: string;
  To: Array<{ Address: string }>;
};

async function readVerificationCode(email: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const payload = (await response.json()) as { messages: MailpitMessage[] };
    const message = payload.messages.find((candidate) =>
      candidate.To.some((recipient) => recipient.Address === email),
    );

    if (message) {
      const detailResponse = await fetch(`http://127.0.0.1:8025/api/v1/message/${message.ID}`);
      const detail = (await detailResponse.json()) as { Text: string; Snippet: string };
      const code = `${detail.Text}\n${detail.Snippet}`.match(/(?<!\d)\d{6}(?!\d)/)?.[0];
      if (code) {
        return code;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`No verification email arrived for ${email}`);
}

function countCjkCharacters(text: string): number {
  return (
    text.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{323AF}]/gu)
      ?.length ?? 0
  );
}

async function expectHighlightOverBodyEditor(page: Page): Promise<void> {
  const editor = page.locator('.writing-editor-surface');
  const textarea = page.getByLabel('章节正文');
  const mark = editor
    .locator('[data-testid="inline-continuity-mark"]')
    .filter({ hasText: '双手结印' })
    .first();

  await expect(editor).toBeVisible();
  await expect(textarea).toBeVisible();
  await expect(mark).toBeVisible();

  const [editorBox, textareaBox, markBox] = await Promise.all([
    editor.boundingBox(),
    textarea.boundingBox(),
    mark.boundingBox(),
  ]);
  expect(editorBox).not.toBeNull();
  expect(textareaBox).not.toBeNull();
  expect(markBox).not.toBeNull();
  if (!editorBox || !textareaBox || !markBox) {
    throw new Error('Expected the editor, textarea, and inline mark to have bounding boxes');
  }

  const tolerance = 2;
  expect(markBox.x).toBeGreaterThanOrEqual(editorBox.x - tolerance);
  expect(markBox.y).toBeGreaterThanOrEqual(editorBox.y - tolerance);
  expect(markBox.x + markBox.width).toBeLessThanOrEqual(
    editorBox.x + editorBox.width + tolerance,
  );
  expect(markBox.y + markBox.height).toBeLessThanOrEqual(
    editorBox.y + editorBox.height + tolerance,
  );

  expect(markBox.x).toBeGreaterThanOrEqual(textareaBox.x - tolerance);
  expect(markBox.x + markBox.width).toBeLessThanOrEqual(
    textareaBox.x + textareaBox.width + tolerance,
  );
  expect(markBox.y).toBeGreaterThanOrEqual(textareaBox.y - tolerance);
  expect(markBox.y + markBox.height).toBeLessThanOrEqual(
    textareaBox.y + textareaBox.height + tolerance,
  );
}

test('an author can generate, edit, save, and recover a chapter in the writing desk', async ({
  page,
}) => {
  const email = `chapter-generation-e2e-${Date.now()}@example.com`;
  const password = 'correct horse battery staple';
  const title = `天门残卷${Date.now()}`;
  const storyBible = {
    oneSentenceStory: '边城少年以残剑问仙，最终守住人间最后一道天门。',
    protagonist: '沈砚，外冷内热的边城剑客',
    worldIronLaw: '任何人借天门之力，都必须以一段真实记忆作为代价。',
  };
  const chapterOutline = {
    chapterGoal: '沈砚在断碑前第一次引动残剑。',
    pov: '沈砚',
    sceneBeats: '沈砚逃入荒寺避雨\n断碑浮现旧日剑痕\n残剑认主并反噬记忆',
    chapterEndHook: '他想起的母亲，竟从未在自己的记忆里活过。',
  };

  await page.context().setExtraHTTPHeaders({
    'X-Forwarded-For': `192.0.2.${(Date.now() % 250) + 1}`,
  });
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('验证码已发送')).toBeVisible();

  const code = await readVerificationCode(email);
  await page.getByLabel('验证码').fill(code);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  await page.getByRole('link', { name: '模型设置' }).click();
  await page.getByLabel('配置名称').fill('DeepSeek 正文');
  await page.getByLabel('API Key').fill('sk-e2e-fake-provider');
  await page.getByLabel('用途', { exact: true }).selectOption('prose');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText('配置已保存')).toBeVisible();

  await page.getByRole('link', { name: '作品书架' }).click();
  await page.getByLabel('书名').fill(title);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+$/);

  await page.getByLabel('一句话故事').fill(storyBible.oneSentenceStory);
  await page.getByLabel('主角').fill(storyBible.protagonist);
  await page.getByLabel('世界铁律').fill(storyBible.worldIronLaw);
  await page.getByRole('button', { name: '保存故事圣经' }).click();
  await expect(page.getByText('故事圣经已保存')).toBeVisible();

  await page.getByLabel('章目标').fill(chapterOutline.chapterGoal);
  await page.getByLabel('叙事视角').fill(chapterOutline.pov);
  await page.getByLabel('场景节拍').fill(chapterOutline.sceneBeats);
  await page.getByLabel('章末钩子').fill(chapterOutline.chapterEndHook);
  await page.getByRole('button', { name: '保存章纲' }).click();
  await expect(page.getByText('章纲已保存')).toBeVisible();

  await page.getByRole('link', { name: '写作台', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/write$/);
  await expect(page.getByRole('heading', { name: '写作进度' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '本章参考' })).toBeVisible();
  await expect(page.getByLabel('章节正文')).toBeVisible();
  await expect(page.getByText('第 1 章').first()).toBeVisible();

  await page.getByRole('button', { name: '根据章纲生成' }).click();
  await expect(page.getByText('初稿已生成', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(async () => countCjkCharacters(await page.getByLabel('章节正文').inputValue()))
    .toBeGreaterThanOrEqual(2000);
  await expect
    .poll(async () => countCjkCharacters(await page.getByLabel('章节正文').inputValue()))
    .toBeLessThanOrEqual(3000);
  await expect(page.getByText('2,500 字', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '保存版本' }).click();
  await expect(page.getByText('版本 1 已保存')).toBeVisible();
  const savedContent = await page.getByLabel('章节正文').inputValue();

  const factPanel = page.getByRole('region', { name: '本章事实' });
  await expect(factPanel).toBeVisible();
  await expect(factPanel.getByText('来源原句')).toHaveCount(3);

  const editedFact = '沈砚用掌中血触发断碑，碑上浮出从未见过的文字。';
  await factPanel.getByLabel('事实内容：事件').fill(editedFact);
  await factPanel
    .getByTestId('fact-proposal-event')
    .getByRole('button', { name: '保存修改' })
    .click();
  await expect(factPanel.getByText('事实修改已保存')).toBeVisible();

  await factPanel
    .getByTestId('fact-proposal-event')
    .getByRole('button', { name: '确认采用' })
    .click();
  await expect(
    factPanel.getByTestId('fact-proposal-event').getByText('已确认'),
  ).toBeVisible();
  await expect(factPanel.getByText(editedFact)).toBeVisible();

  await factPanel
    .getByTestId('fact-proposal-body_state')
    .getByRole('button', { name: '驳回' })
    .click();
  await expect(
    factPanel.getByTestId('fact-proposal-body_state').getByText('已驳回'),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('章节正文')).toHaveValue(savedContent);
  await expect(page.getByRole('heading', { name: '写作进度' })).toBeVisible();
  await expect(
    page.getByTestId('fact-proposal-event').getByText('已确认'),
  ).toBeVisible();
  await expect(
    page.getByTestId('fact-proposal-body_state').getByText('已驳回'),
  ).toBeVisible();

  await page.getByRole('link', { name: '作品与章纲' }).click();
  await page
    .getByLabel('章目标')
    .fill(`${chapterOutline.chapterGoal} [[FAIL_AFTER_PARTIAL]]`);
  await page.getByRole('button', { name: '保存章纲' }).click();
  await expect(page.getByText('章纲已保存')).toBeVisible();
  await page.getByRole('link', { name: '写作台', exact: true }).click();

  await page.getByRole('button', { name: '根据章纲生成' }).click();
  await expect(page.locator('.writing-error[role="alert"]')).toContainText('已经写出的内容');
  const partialDraft = await page.getByLabel('章节正文').inputValue();
  expect(countCjkCharacters(partialDraft)).toBeGreaterThan(0);
  expect(countCjkCharacters(partialDraft)).toBeLessThan(countCjkCharacters(savedContent));
  await expect(page.getByRole('button', { name: '恢复生成前内容' })).toBeVisible();

  await page.getByRole('button', { name: '恢复生成前内容' }).click();
  await expect(page.getByLabel('章节正文')).toHaveValue(savedContent);

  await expect(page.getByText(/Canon|Context Pack|Agent|POV|Branch|正史|上下文包/)).toHaveCount(
    0,
  );
});

test('an author sees and can ignore a left-arm continuity conflict in the writing desk', async ({
  page,
}) => {
  const email = `continuity-e2e-${Date.now()}@example.com`;
  const password = 'correct horse battery staple';
  const title = `断臂结印${Date.now()}`;
  const chapterOneOutline = {
    chapterGoal: '沈砚在断碑前第一次引动残剑。',
    pov: '沈砚',
    sceneBeats: '沈砚逃入荒寺避雨\n断碑浮现旧日剑痕\n残剑认主并反噬记忆',
    chapterEndHook: '他想起的母亲，竟从未在自己的记忆里活过。',
  };

  await page.context().setExtraHTTPHeaders({
    'X-Forwarded-For': `192.0.2.${(Date.now() % 250) + 1}`,
  });
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('验证码已发送')).toBeVisible();

  const code = await readVerificationCode(email);
  await page.getByLabel('验证码').fill(code);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  await page.getByRole('link', { name: '模型设置' }).click();
  await page.getByLabel('配置名称').fill('DeepSeek 正文');
  await page.getByLabel('API Key').fill('sk-e2e-fake-provider');
  await page.getByLabel('用途', { exact: true }).selectOption('prose');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText('配置已保存')).toBeVisible();

  await page.getByRole('link', { name: '作品书架' }).click();
  await page.getByLabel('书名').fill(title);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+$/);
  const workId = new URL(page.url()).pathname.split('/').at(-1) as string;

  await page.getByLabel('一句话故事').fill(
    '边城少年以残剑问仙，最终守住人间最后一道天门。',
  );
  await page.getByLabel('主角').fill('沈砚，外冷内热的边城剑客');
  await page.getByLabel('世界铁律').fill(
    '任何人借天门之力，都必须以一段真实记忆作为代价。',
  );
  await page.getByRole('button', { name: '保存故事圣经' }).click();
  await expect(page.getByText('故事圣经已保存')).toBeVisible();

  await page.getByLabel('章目标').fill(chapterOneOutline.chapterGoal);
  await page.getByLabel('叙事视角').fill(chapterOneOutline.pov);
  await page.getByLabel('场景节拍').fill(chapterOneOutline.sceneBeats);
  await page.getByLabel('章末钩子').fill(chapterOneOutline.chapterEndHook);
  await page.getByRole('button', { name: '保存章纲' }).click();
  await expect(page.getByText('章纲已保存')).toBeVisible();

  await page.getByRole('link', { name: '写作台', exact: true }).click();
  await page.getByRole('button', { name: '根据章纲生成' }).click();
  await expect(page.getByText('初稿已生成', { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  const factPanel = page.getByRole('region', { name: '本章事实' });
  const bodyStateFact = factPanel.getByTestId('fact-proposal-body_state');
  await bodyStateFact
    .getByLabel('事实内容：身体状况')
    .fill('沈砚的左臂骨折，左手无法用力。');
  await bodyStateFact.getByRole('button', { name: '保存修改' }).click();
  await expect(factPanel.getByText('事实修改已保存')).toBeVisible();
  await bodyStateFact.getByRole('button', { name: '确认采用' }).click();
  await expect(bodyStateFact.getByText('已确认')).toBeVisible();

  const workResponse = await page.request.get(`/api/v1/works/${workId}`);
  expect(workResponse.ok()).toBeTruthy();
  const work = (await workResponse.json()) as {
    mainBranch: { id: string };
  };
  const branchId = work.mainBranch.id;
  const outlineResponse = await page.request.put(
    `/api/v1/works/${workId}/branches/${branchId}/chapter-outlines/2`,
    {
      data: {
        chapterGoal: '沈砚在追兵围困中结印破局。[[LEFT_ARM_CONFLICT]]',
        pov: '沈砚',
        sceneBeats: ['追兵封住山道', '沈砚催动残剑', '碑文反噬引来旧敌'],
        chapterEndHook: '来人的袖口绣着母亲旧宅的家纹。',
      },
    },
  );
  expect(outlineResponse.ok()).toBeTruthy();

  await page.reload();
  await page
    .getByRole('button')
    .filter({ hasText: '第 2 章' })
    .click();
  await page.getByRole('button', { name: '根据章纲生成' }).click();
  await expect(page.getByText('初稿已生成', { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  const continuityPanel = page.getByRole('region', { name: '连续性提示' });
  await expect(continuityPanel).toBeVisible();
  await expect(continuityPanel.getByText('身体状态冲突')).toBeVisible();
  await expect(continuityPanel.locator('.continuity-issue-message')).toContainText(
    '左臂',
  );
  await expect(continuityPanel.locator('.continuity-suggestion')).toContainText(
    '右手',
  );
  await expectHighlightOverBodyEditor(page);
  await page.screenshot({
    fullPage: true,
    path: 'test-results/ticket-9-continuity.png',
  });

  const bodyEditor = page.getByLabel('章节正文');
  await bodyEditor.evaluate((element) => {
    element.scrollTop = 240;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect
    .poll(async () =>
      page.locator('.writing-highlight-backdrop').evaluate((element) => element.scrollTop),
    )
    .toBe(240);
  await bodyEditor.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expectHighlightOverBodyEditor(page);

  const beforeEdit = await bodyEditor.inputValue();
  await bodyEditor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('补');
  await expect.poll(async () => bodyEditor.inputValue()).not.toBe(beforeEdit);
  await bodyEditor.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expectHighlightOverBodyEditor(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectHighlightOverBodyEditor(page);
  await page.screenshot({
    fullPage: true,
    path: 'test-results/ticket-9-continuity-mobile.png',
  });

  const ignoreReason = '这里用右手代替左手结印，后文会解释左臂已经恢复。';
  await continuityPanel.getByLabel('忽略原因').fill(ignoreReason);
  await continuityPanel.getByRole('button', { name: '忽略这条提示' }).click();
  await expect(continuityPanel.getByText('已忽略', { exact: true })).toBeVisible();
  await expect(continuityPanel.getByText(ignoreReason)).toBeVisible();

  await page.reload();
  await page
    .getByRole('button')
    .filter({ hasText: '第 2 章' })
    .click();
  const reloadedPanel = page.getByRole('region', { name: '连续性提示' });
  await expect(reloadedPanel.getByText('已忽略', { exact: true })).toBeVisible();
  await expect(reloadedPanel.getByText(ignoreReason)).toBeVisible();

  await expect(reloadedPanel).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  expect(
    await reloadedPanel.locator('.continuity-issue').evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await expect(page.getByText(/Canon|Context Pack|Agent|POV|Branch|正史|上下文包/)).toHaveCount(
    0,
  );
});
