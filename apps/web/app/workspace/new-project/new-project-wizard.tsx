'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ChangeEvent } from 'react';
import { AccountShell } from '../../_components/app-shell';
import { ApiError, apiRequest, friendlyError, type User } from '../../../lib/auth-api';
import type { PenNameListResponse } from '../../../lib/account-api';
import {
  GENRE_LABELS,
  SCALE_LABELS,
  TARGET_PLATFORMS,
  UPDATE_CADENCE_OPTIONS,
  uploadWorkCover,
  type Work,
  type WorkScale,
} from '../../../lib/works-api';

type EntryMode = 'idea' | 'blank' | 'template' | 'import';
type GenrePack = 'xianxia' | 'history' | 'urban';

type WizardForm = {
  idea: string;
  title: string;
  penName: string;
  genrePack: GenrePack;
  genreVariant: string;
  scale: WorkScale;
  targetPlatform: string;
  targetReader: string;
  chapterWordCount: string;
  updateCadence: string;
  synopsis: string;
  styleSamples: string;
  taboos: string;
  tags: string;
};

type ManuscriptChapter = {
  title: string;
  content: string;
};

const STEP_LABELS = ['灵感', '题材', '规模', '读者', '蓝图', '创建'];

const GENRE_TEMPLATES: Array<{
  value: GenrePack;
  label: string;
  detail: string;
}> = [
  { value: 'xianxia', label: '仙侠', detail: '宗门、境界、飞升与记忆代价' },
  { value: 'history', label: '历史', detail: '架空古代或穿越争霸' },
  { value: 'urban', label: '都市', detail: '现实规则、商业与人物关系' },
];

const INITIAL_FORM: WizardForm = {
  idea: '',
  title: '',
  penName: '',
  genrePack: 'xianxia',
  genreVariant: 'alternate_ancient',
  scale: 'long',
  targetPlatform: '起点中文网',
  targetReader: '',
  chapterWordCount: '2500',
  updateCadence: '每周三更',
  synopsis: '',
  styleSamples: '',
  taboos: '',
  tags: '',
};

function splitTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,，\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

function splitManuscript(text: string): ManuscriptChapter[] {
  const lines = text.split(/\r?\n/);
  const chapters: ManuscriptChapter[] = [];
  let current: ManuscriptChapter = { title: '', content: '' };
  const heading = /^(?:#{1,3}\s+|第[0-9一二三四五六七八九十百千万]+[章节回卷][^\n]*$)/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (heading.test(trimmed)) {
      if (current.title || current.content.trim()) {
        chapters.push(current);
      }
      current = {
        title: trimmed.replace(/^#{1,3}\s+/, '').trim(),
        content: '',
      };
    } else {
      current.content += `${line}\n`;
    }
  }
  if (current.title || current.content.trim()) {
    chapters.push(current);
  }
  const parsed = chapters
    .filter((chapter) => chapter.title.trim() || chapter.content.trim())
    .map((chapter) => ({
      ...chapter,
      title: chapter.title.trim() || '正文',
      content: chapter.content.trim(),
    }));
  return parsed.length > 0 ? parsed : [{ title: '正文', content: text }];
}

function serializeChapters(chapters: ManuscriptChapter[]): string {
  return chapters.map((chapter) => `# ${chapter.title}\n\n${chapter.content}`).join('\n\n');
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}

export function NewProjectWizard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [penNames, setPenNames] = useState<PenNameListResponse['items']>([]);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<EntryMode>('idea');
  const [form, setForm] = useState<WizardForm>(INITIAL_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [manuscriptFile, setManuscriptFile] = useState<File | null>(null);
  const [manuscriptText, setManuscriptText] = useState('');
  const [manuscriptBase64, setManuscriptBase64] = useState('');
  const [chapters, setChapters] = useState<ManuscriptChapter[]>([]);

  useEffect(() => {
    Promise.all([
      apiRequest<User>('/api/v1/auth/me'),
      apiRequest<PenNameListResponse>('/api/v1/users/me/pen-names'),
    ])
      .then(([loadedUser, response]) => {
        setUser(loadedUser);
        setPenNames(response.items);
        setForm((current) => ({
          ...current,
          penName: current.penName || response.items[0]?.name || '',
        }));
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof ApiError && requestError.status === 401) {
          router.replace('/login');
          return;
        }
        setLoadError(friendlyError(requestError));
      });
  }, [router]);

  function update<Key extends keyof WizardForm>(key: Key, value: WizardForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError('');
  }

  function chooseMode(nextMode: EntryMode) {
    setMode(nextMode);
    setError('');
    if (nextMode === 'template') {
      setForm((current) => ({
        ...current,
        title: current.title || '未命名长篇',
      }));
    }
  }

  function validateStep(): string | null {
    if (step === 1) {
      if (!form.title.trim()) {
        return '先给这本书一个书名。';
      }
      if (mode === 'idea' && !form.idea.trim()) {
        return '用一句话写下最想讲的故事。';
      }
      if (mode === 'import' && !manuscriptFile) {
        return '请选择要导入的旧稿文件。';
      }
    }
    if (step === 2 && !form.genrePack) {
      return '请选择题材。';
    }
    if (step === 3) {
      if (!form.penName) {
        return '请选择笔名。';
      }
      if (!form.scale || !form.targetPlatform) {
        return '请选择规模和目标平台。';
      }
      const wordCount = Number(form.chapterWordCount);
      if (!Number.isFinite(wordCount) || wordCount < 500 || wordCount > 20_000) {
        return '章节字数需要在 500 到 20000 字之间。';
      }
    }
    return null;
  }

  function nextStep() {
    const validation = validateStep();
    if (validation) {
      setError(validation);
      return;
    }
    setError('');
    setStep((current) => Math.min(6, current + 1));
  }

  function previousStep() {
    setError('');
    setStep((current) => Math.max(1, current - 1));
  }

  async function readManuscriptFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setManuscriptFile(file);
    setError('');
    if (file.name.toLowerCase().endsWith('.docx')) {
      setChapters([]);
      setManuscriptText('');
      setManuscriptBase64(arrayBufferToBase64(await file.arrayBuffer()));
    } else {
      const text = await file.text();
      const parsed = splitManuscript(text);
      setManuscriptText(text);
      setManuscriptBase64('');
      setChapters(parsed);
      if (!form.title.trim()) {
        update('title', file.name.replace(/\.[^.]+$/, ''));
      }
    }
  }

  function updateChapter(index: number, title: string) {
    setChapters((current) =>
      current.map((chapter, chapterIndex) =>
        chapterIndex === index ? { ...chapter, title } : chapter,
      ),
    );
  }

  function mergeChapter(index: number) {
    setChapters((current) => {
      if (index >= current.length - 1) {
        return current;
      }
      const chapter = current[index];
      const next = current[index + 1];
      return [
        ...current.slice(0, index),
        {
          title: chapter.title,
          content: `${chapter.content}\n\n${next.title}\n\n${next.content}`.trim(),
        },
        ...current.slice(index + 2),
      ];
    });
  }

  function splitChapter(index: number) {
    setChapters((current) => {
      const chapter = current[index];
      const paragraphs = chapter.content.split(/\n\s*\n/).filter(Boolean);
      if (paragraphs.length < 2) {
        return current;
      }
      const midpoint = Math.ceil(paragraphs.length / 2);
      return [
        ...current.slice(0, index),
        { ...chapter, content: paragraphs.slice(0, midpoint).join('\n\n') },
        {
          title: `${chapter.title}（下）`,
          content: paragraphs.slice(midpoint).join('\n\n'),
        },
        ...current.slice(index + 1),
      ];
    });
  }

  function payload(): Record<string, unknown> {
    return {
      creationMode: mode === 'idea' ? 'idea' : 'blank',
      title: form.title.trim(),
      ...(mode === 'idea' ? { idea: form.idea.trim() } : {}),
      penName: form.penName,
      genrePack: form.genrePack,
      ...(form.genrePack === 'history' ? { genreVariant: form.genreVariant } : {}),
      scale: form.scale,
      targetPlatform: form.targetPlatform,
      ...(form.targetReader.trim() ? { targetReader: form.targetReader.trim() } : {}),
      chapterWordCount: Number(form.chapterWordCount),
      updateCadence: form.updateCadence,
      ...(form.synopsis.trim() ? { synopsis: form.synopsis.trim() } : {}),
      ...(form.styleSamples.trim() ? { styleSamples: form.styleSamples.trim() } : {}),
      ...(form.taboos.trim() ? { taboos: form.taboos.trim() } : {}),
      ...(form.tags.trim() ? { tags: splitTags(form.tags) } : {}),
    };
  }

  async function createWork() {
    const validation = validateStep();
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (mode === 'import' && manuscriptFile) {
        const isDocx = manuscriptFile.name.toLowerCase().endsWith('.docx');
        const body = {
          ...payload(),
          fileName: isDocx ? manuscriptFile.name : 'manuscript.md',
          ...(isDocx
            ? { contentBase64: manuscriptBase64 }
            : {
                content:
                  chapters.length > 0 ? serializeChapters(chapters) : manuscriptText,
              }),
        };
        const result = await apiRequest<{ workId: string }>('/api/v1/works/import', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        router.push(`/workspace/${result.workId}/overview`);
        return;
      }

      const work = await apiRequest<Work>('/api/v1/works', {
        method: 'POST',
        body: JSON.stringify(payload()),
      });
      if (coverFile) {
        try {
          await uploadWorkCover(work.id, coverFile);
        } catch {
          // The work is already created; a failed cover upload can be retried in work settings.
        }
      }
      router.push(`/workspace/${work.id}/overview`);
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <main className="app-shell-error">
        <section>
          <h1>暂时无法打开新建作品</h1>
          <p>{loadError}</p>
          <button className="secondary-button" onClick={() => window.location.reload()} type="button">
            重新加载
          </button>
        </section>
      </main>
    );
  }

  if (!user) {
    return <main className="app-shell-loading">正在准备创作向导…</main>;
  }

  const previewCards = [
    { title: '一句话故事', text: form.idea || form.title || '待补全' },
    { title: '核心卖点', text: form.tags || '待补全' },
    { title: '主角', text: '待补全' },
    { title: '金手指', text: '待补全' },
    { title: '世界铁律', text: '待补全' },
    { title: '主线', text: form.synopsis || '待补全' },
    { title: '支线', text: '待补全' },
    { title: '结局方向', text: '待补全' },
    { title: '读者承诺', text: form.targetReader || '待补全' },
  ];

  return (
    <AccountShell active="dashboard" breadcrumbLabel="新建作品" user={user}>
      <main className="workspace-shell new-project-shell">
        <section className="wizard-hero">
          <p className="workspace-step">新建作品</p>
          <h1>把一个想法，长成一本书</h1>
          <p>先说你最想讲的那句话，剩下的我们边写边补。</p>
        </section>

        <ol className="wizard-progress" aria-label="创建步骤">
          {STEP_LABELS.map((label, index) => (
            <li className={step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''} key={label}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{label}</strong>
            </li>
          ))}
        </ol>

        <section className="wizard-panel" aria-live="polite">
          {step === 1 ? (
            <>
              <div className="wizard-step-heading">
                <p className="workspace-step">第 1 步</p>
                <h2>你想写一个什么样的故事？</h2>
              </div>
              <div className="wizard-mode-grid" role="tablist" aria-label="创建入口">
                {[
                  ['idea', '一句话想法', '从一个念头开始'],
                  ['blank', '空白作品', '先把书名定下来'],
                  ['template', '题材模板', '按题材预填边界'],
                  ['import', '导入旧稿', '把已有章节接进来'],
                ].map(([value, label, detail]) => (
                  <button
                    aria-selected={mode === value}
                    className={`wizard-mode-card ${mode === value ? 'active' : ''}`}
                    key={value}
                    onClick={() => chooseMode(value as EntryMode)}
                    role="tab"
                    type="button"
                  >
                    <strong>{label}</strong>
                    <small>{detail}</small>
                  </button>
                ))}
              </div>

              {mode === 'idea' ? (
                <label className="field">
                  <span>故事灵感</span>
                  <textarea
                    aria-label="故事灵感"
                    maxLength={5_000}
                    onChange={(event) => update('idea', event.target.value)}
                    placeholder="例如：一个被宗门抛弃的杂役，靠一本吞噬记忆的古书爬上仙途。"
                    rows={4}
                    value={form.idea}
                  />
                </label>
              ) : null}

              {mode === 'template' ? (
                <div className="wizard-template-grid">
                  {GENRE_TEMPLATES.map((template) => (
                    <button
                      className={`wizard-template-card ${form.genrePack === template.value ? 'active' : ''}`}
                      key={template.value}
                      onClick={() => update('genrePack', template.value)}
                      type="button"
                    >
                      <strong>{template.label}</strong>
                      <small>{template.detail}</small>
                    </button>
                  ))}
                </div>
              ) : null}

              {mode === 'import' ? (
                <div className="wizard-import-box">
                  <label className="field">
                    <span>旧稿文件</span>
                    <input
                      accept=".txt,.md,.markdown,.docx"
                      aria-label="旧稿文件"
                      onChange={(event) => void readManuscriptFile(event)}
                      type="file"
                    />
                  </label>
                  <p className="field-hint">
                    支持 TXT、Markdown 和 Word。TXT/Markdown 可先调整章节标题、合并或拆分；Word 会在导入时按章节标题切分。
                  </p>
                  {chapters.length > 0 ? (
                    <div className="wizard-chapter-list">
                      {chapters.map((chapter, index) => (
                        <div className="wizard-chapter-row" key={`${chapter.title}-${index}`}>
                          <span>{String(index + 1).padStart(2, '0')}</span>
                          <input
                            aria-label={`章节标题 ${index + 1}`}
                            onChange={(event) => updateChapter(index, event.target.value)}
                            value={chapter.title}
                          />
                          <div>
                            <button
                              className="text-button"
                              disabled={index >= chapters.length - 1}
                              onClick={() => mergeChapter(index)}
                              type="button"
                            >
                              合并下一章
                            </button>
                            <button
                              className="text-button"
                              disabled={chapter.content.split(/\n\s*\n/).filter(Boolean).length < 2}
                              onClick={() => splitChapter(index)}
                              type="button"
                            >
                              拆分
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : manuscriptFile ? (
                    <p className="field-hint">Word 文件已读取，导入时会自动切分章节。</p>
                  ) : null}
                </div>
              ) : null}

              <label className="field">
                <span>书名</span>
                <input
                  aria-label="书名"
                  maxLength={80}
                  onChange={(event) => update('title', event.target.value)}
                  placeholder="例如：仙途：忘川书"
                  value={form.title}
                />
              </label>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="wizard-step-heading">
                <p className="workspace-step">第 2 步</p>
                <h2>选择题材与规模</h2>
              </div>
              <div className="wizard-two-col">
                <label className="field">
                  <span>题材</span>
                  <select
                    aria-label="题材"
                    onChange={(event) => update('genrePack', event.target.value as GenrePack)}
                    value={form.genrePack}
                  >
                    {Object.entries(GENRE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {form.genrePack === 'history' ? (
                  <label className="field">
                    <span>历史方向</span>
                    <select
                      aria-label="历史方向"
                      onChange={(event) => update('genreVariant', event.target.value)}
                      value={form.genreVariant}
                    >
                      <option value="alternate_ancient">架空古代</option>
                      <option value="time_travel_conquest">穿越争霸</option>
                    </select>
                  </label>
                ) : null}
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <div className="wizard-step-heading">
                <p className="workspace-step">第 3 步</p>
                <h2>把写作目标定清楚</h2>
              </div>
              <div className="wizard-two-col">
                <label className="field">
                  <span>笔名</span>
                  <select
                    aria-label="笔名"
                    onChange={(event) => update('penName', event.target.value)}
                    value={form.penName}
                  >
                    {penNames.map((penName) => (
                      <option key={penName.id} value={penName.name}>
                        {penName.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>规模</span>
                  <select
                    aria-label="规模"
                    onChange={(event) => update('scale', event.target.value as WorkScale)}
                    value={form.scale}
                  >
                    {Object.entries(SCALE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>目标平台</span>
                  <select
                    aria-label="目标平台"
                    onChange={(event) => update('targetPlatform', event.target.value)}
                    value={form.targetPlatform}
                  >
                    {TARGET_PLATFORMS.map((platform) => (
                      <option key={platform} value={platform}>
                        {platform}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>目标读者</span>
                  <input
                    aria-label="目标读者"
                    onChange={(event) => update('targetReader', event.target.value)}
                    placeholder="例如：喜欢长线伏笔的读者"
                    value={form.targetReader}
                  />
                </label>
                <label className="field">
                  <span>章节字数</span>
                  <input
                    aria-label="章节字数"
                    min={500}
                    max={20_000}
                    onChange={(event) => update('chapterWordCount', event.target.value)}
                    type="number"
                    value={form.chapterWordCount}
                  />
                </label>
                <label className="field">
                  <span>更新节奏</span>
                  <select
                    aria-label="更新节奏"
                    onChange={(event) => update('updateCadence', event.target.value)}
                    value={form.updateCadence}
                  >
                    {UPDATE_CADENCE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <div className="wizard-step-heading">
                <p className="workspace-step">第 4 步</p>
                <h2>告诉系统读者的期待和边界</h2>
              </div>
              <div className="wizard-two-col">
                <label className="field">
                  <span>简介</span>
                  <textarea
                    aria-label="简介"
                    onChange={(event) => update('synopsis', event.target.value)}
                    rows={4}
                    value={form.synopsis}
                  />
                </label>
                <label className="field">
                  <span>风格样本</span>
                  <textarea
                    aria-label="风格样本"
                    onChange={(event) => update('styleSamples', event.target.value)}
                    rows={4}
                    value={form.styleSamples}
                  />
                </label>
                <label className="field">
                  <span>禁忌</span>
                  <textarea
                    aria-label="禁忌"
                    onChange={(event) => update('taboos', event.target.value)}
                    placeholder="例如：不写无代价复活"
                    rows={3}
                    value={form.taboos}
                  />
                </label>
                <label className="field">
                  <span>作品标签</span>
                  <input
                    aria-label="作品标签"
                    onChange={(event) => update('tags', event.target.value)}
                    placeholder="升级流，长线伏笔，群像"
                    value={form.tags}
                  />
                </label>
                <label className="field">
                  <span>封面图片</span>
                  <input
                    accept="image/png,image/jpeg,image/webp"
                    aria-label="封面图片"
                    onChange={(event) => setCoverFile(event.target.files?.[0] ?? null)}
                    type="file"
                  />
                </label>
              </div>
            </>
          ) : null}

          {step === 5 ? (
            <>
              <div className="wizard-step-heading">
                <p className="workspace-step">第 5 步</p>
                <h2>故事蓝图预览</h2>
                <p>这是创建后的起点。九卡会在故事圣经里继续补全和锁定。</p>
              </div>
              <div className="wizard-blueprint-grid">
                {previewCards.map((card, index) => (
                  <article className="wizard-blueprint-card" key={card.title}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{card.title}</strong>
                    <p>{card.text}</p>
                  </article>
                ))}
              </div>
            </>
          ) : null}

          {step === 6 ? (
            <>
              <div className="wizard-step-heading">
                <p className="workspace-step">第 6 步</p>
                <h2>确认创建</h2>
                <p>创建后会进入作品总览，再继续补故事圣经和第一章大纲。</p>
              </div>
              <dl className="wizard-summary">
                <div><dt>书名</dt><dd>{form.title}</dd></div>
                <div><dt>笔名</dt><dd>{form.penName}</dd></div>
                <div><dt>题材</dt><dd>{GENRE_LABELS[form.genrePack] ?? form.genrePack}</dd></div>
                <div><dt>规模</dt><dd>{SCALE_LABELS[form.scale] ?? form.scale}</dd></div>
                <div><dt>目标平台</dt><dd>{form.targetPlatform}</dd></div>
                <div><dt>章节字数</dt><dd>{Number(form.chapterWordCount).toLocaleString('zh-CN')} 字</dd></div>
                <div><dt>更新节奏</dt><dd>{form.updateCadence}</dd></div>
                <div><dt>读者</dt><dd>{form.targetReader || '暂未填写'}</dd></div>
                {mode === 'import' ? (
                  <div><dt>导入章节</dt><dd>{chapters.length || '按文件自动切分'}</dd></div>
                ) : null}
              </dl>
            </>
          ) : null}

          {error ? (
            <p className="form-message form-message-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="wizard-actions">
            {step > 1 ? (
              <button className="secondary-button" onClick={previousStep} type="button">
                上一步
              </button>
            ) : (
              <span />
            )}
            {step < 6 ? (
              <button className="primary-button" onClick={nextStep} type="button">
                下一步
              </button>
            ) : (
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void createWork()}
                type="button"
              >
                {busy
                  ? mode === 'import'
                    ? '正在导入…'
                    : '正在创建…'
                  : mode === 'import'
                    ? '导入作品并进入总览'
                    : '创建作品并进入总览'}
              </button>
            )}
          </div>
        </section>
      </main>
    </AccountShell>
  );
}
