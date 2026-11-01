'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, apiRequest, type User } from '../../../lib/auth-api';
import {
  PURPOSE_DESCRIPTIONS,
  PURPOSE_LABELS,
  friendlyModelConfigError,
  type ConnectionTestResponse,
  type EffectivePurpose,
  type ModelConfig,
  type ModelConfigListResponse,
  type ModelPurpose,
} from '../../../lib/model-configs-api';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; user: User; data: ModelConfigListResponse }
  | { status: 'error'; message: string };

type EditorState = {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  purpose: ModelPurpose;
  isDefault: boolean;
};

type Notice = {
  kind: 'success' | 'error';
  text: string;
} | null;

const EMPTY_EDITOR: EditorState = {
  name: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: '',
  purpose: 'prose',
  isDefault: false,
};

function nextAvailablePurpose(items: ModelConfig[]): ModelPurpose | undefined {
  const usedPurposes = new Set(items.map((item) => item.purpose));
  return (['prose', 'planning', 'check'] as ModelPurpose[]).find(
    (purpose) => !usedPurposes.has(purpose),
  );
}

function newEditor(items: ModelConfig[]): EditorState {
  return {
    ...EMPTY_EDITOR,
    purpose: nextAvailablePurpose(items) ?? EMPTY_EDITOR.purpose,
  };
}

function effectivePurposeText(value: EffectivePurpose): string {
  if (!value.name) {
    return '尚未配置';
  }
  if (value.source === 'purpose') {
    return value.name;
  }
  if (value.source === 'prose_fallback') {
    return `${value.name}（沿用正文配置）`;
  }
  return `${value.name}（沿用默认配置）`;
}

function connectionLabel(result: ConnectionTestResponse): string {
  if (result.status === 'success') {
    return result.latencyMs === undefined ? '连接成功' : `连接成功 · ${result.latencyMs}ms`;
  }
  if (result.status === 'invalid_key') {
    return 'API Key 无效，请检查后重新保存。';
  }
  return '网络连接失败，请检查 Base URL 或稍后再试。';
}

export function ModelSettings() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [editingId, setEditingId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string>();
  const [testingId, setTestingId] = useState<string>();
  const [notice, setNotice] = useState<Notice>(null);
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResponse>>({});

  async function loadData(): Promise<ModelConfigListResponse | undefined> {
    try {
      const [user, data] = await Promise.all([
        apiRequest<User>('/api/v1/auth/me'),
        apiRequest<ModelConfigListResponse>('/api/v1/model-configs'),
      ]);
      setState({ status: 'ready', user, data });
      return data;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace('/login');
        return undefined;
      }
      setState({ status: 'error', message: friendlyModelConfigError(error) });
      return undefined;
    }
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest<User>('/api/v1/auth/me'),
      apiRequest<ModelConfigListResponse>('/api/v1/model-configs'),
    ])
      .then(([user, data]) => {
        if (active) {
          setState({ status: 'ready', user, data });
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          router.replace('/login');
          return;
        }
        setState({ status: 'error', message: friendlyModelConfigError(error) });
      });

    return () => {
      active = false;
    };
  }, [router]);

  function updateEditor<Key extends keyof EditorState>(key: Key, value: EditorState[Key]) {
    setEditor((current) => ({ ...current, [key]: value }));
  }

  function startNew() {
    setEditingId(undefined);
    setEditor(newEditor(state.status === 'ready' ? state.data.items : []));
    setNotice(null);
  }

  function startEdit(config: ModelConfig) {
    setEditingId(config.id);
    setEditor({
      name: config.name,
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: '',
      purpose: config.purpose,
      isDefault: config.isDefault,
    });
    setNotice(null);
  }

  async function saveConfig(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);

    try {
      let saved: ModelConfig;
      const body: Record<string, unknown> = {
        name: editor.name,
        baseUrl: editor.baseUrl,
        model: editor.model,
        purpose: editor.purpose,
        isDefault: editor.isDefault,
      };
      if (editor.apiKey.trim()) {
        body.apiKey = editor.apiKey.trim();
      }

      if (editingId) {
        saved = await apiRequest<ModelConfig>(`/api/v1/model-configs/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        body.provider = 'deepseek';
        body.apiKey = editor.apiKey.trim();
        saved = await apiRequest<ModelConfig>('/api/v1/model-configs', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }

      setNotice({ kind: 'success', text: '配置已保存' });
      const refreshed = await loadData();
      const available = refreshed ? nextAvailablePurpose(refreshed.items) : undefined;
      if (available) {
        setEditingId(undefined);
        setEditor(newEditor(refreshed?.items ?? []));
      } else {
        setEditingId(saved.id);
        setEditor({
          name: saved.name,
          baseUrl: saved.baseUrl,
          model: saved.model,
          apiKey: '',
          purpose: saved.purpose,
          isDefault: saved.isDefault,
        });
      }
    } catch (error) {
      setNotice({ kind: 'error', text: friendlyModelConfigError(error) });
    } finally {
      setSaving(false);
    }
  }

  async function testConnection(configId: string) {
    setTestingId(configId);
    setNotice(null);
    try {
      const result = await apiRequest<ConnectionTestResponse>(
        `/api/v1/model-configs/${configId}/test`,
        { method: 'POST' },
      );
      setTestResults((current) => ({ ...current, [configId]: result }));
    } catch (error) {
      setNotice({ kind: 'error', text: friendlyModelConfigError(error) });
    } finally {
      setTestingId(undefined);
    }
  }

  async function deleteConfig(config: ModelConfig) {
    if (!window.confirm(`删除“${config.name}”？保存的 API Key 也会一起删除。`)) {
      return;
    }

    setDeletingId(config.id);
    setNotice(null);
    try {
      await apiRequest<void>(`/api/v1/model-configs/${config.id}`, { method: 'DELETE' });
      if (editingId === config.id) {
        setEditingId(undefined);
        setEditor(EMPTY_EDITOR);
      }
      setTestResults((current) => {
        const next = { ...current };
        delete next[config.id];
        return next;
      });
      setNotice({ kind: 'success', text: '配置已删除' });
      await loadData();
    } catch (error) {
      setNotice({ kind: 'error', text: friendlyModelConfigError(error) });
    } finally {
      setDeletingId(undefined);
    }
  }

  if (state.status === 'loading') {
    return (
      <main className="workspace-shell">
        <p className="workspace-loading">正在打开模型设置…</p>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="workspace-shell">
        <section className="workspace-error">
          <h1>暂时无法打开模型设置</h1>
          <p>{state.message}</p>
          <button className="secondary-button" onClick={() => window.location.reload()} type="button">
            重新加载
          </button>
        </section>
      </main>
    );
  }

  const { items, effectivePurposes } = state.data;
  const purposeInUse = items.some(
    (item) => item.purpose === editor.purpose && item.id !== editingId,
  );

  return (
    <main className="workspace-shell settings-shell">
      <header className="workspace-header">
        <Link className="workspace-brand" href="/workspace">
          NovelBrain
        </Link>
        <nav className="workspace-nav" aria-label="账号导航">
          <Link href="/workspace">作品书架</Link>
          <Link aria-current="page" href="/workspace/settings">
            模型设置
          </Link>
          <span>{state.user.displayName}</span>
        </nav>
      </header>

      <section className="settings-hero">
        <div>
          <p className="workspace-step">账号设置</p>
          <h1>模型设置</h1>
        </div>
        <p>模型由你自己的 DeepSeek API Key 驱动。Key 加密保存，之后只显示掩码。</p>
      </section>

      <section className="purpose-summary" aria-label="各用途当前使用的配置">
        {(['planning', 'prose', 'check'] as ModelPurpose[]).map((purpose) => (
          <div key={purpose}>
            <span>{PURPOSE_LABELS[purpose]}</span>
            <strong>{effectivePurposeText(effectivePurposes[purpose])}</strong>
          </div>
        ))}
      </section>

      <div className="settings-layout">
        <section className="model-config-section" aria-labelledby="model-config-list-title">
          <div className="works-section-heading">
            <h2 id="model-config-list-title">已保存的配置</h2>
            <span>{items.length} 套</span>
          </div>

          {notice ? (
            <p
              className={`form-message form-message-${notice.kind} settings-notice`}
              role="status"
            >
              {notice.text}
            </p>
          ) : null}

          {items.length === 0 ? (
            <div className="works-empty settings-empty">
              <p className="workspace-step">连接模型</p>
              <h2>还没有模型配置</h2>
              <p>先保存一套 DeepSeek 配置，规划、正文和校验就可以开始工作。</p>
            </div>
          ) : (
            <div className="model-config-list">
              {items.map((config) => {
                const result = testResults[config.id];
                return (
                  <article className="model-config-row" key={config.id}>
                    <div className="model-config-main">
                      <div className="model-config-heading">
                        <div>
                          <span className={`purpose-tag purpose-tag-${config.purpose}`}>
                            {PURPOSE_LABELS[config.purpose]}
                          </span>
                          {config.isDefault ? (
                            <span className="default-tag">默认配置</span>
                          ) : null}
                        </div>
                        <h3>{config.name}</h3>
                      </div>
                      <p className="model-config-endpoint">
                        {config.baseUrl} · {config.model}
                      </p>
                      <p className="model-config-key">
                        API Key <span>{config.apiKeyMasked}</span>
                      </p>
                      {result ? (
                        <p
                          className={`connection-result connection-result-${result.status}`}
                          role="status"
                        >
                          {connectionLabel(result)}
                        </p>
                      ) : null}
                    </div>
                    <div className="model-config-actions">
                      <button
                        className="secondary-button"
                        disabled={testingId === config.id}
                        onClick={() => testConnection(config.id)}
                        type="button"
                      >
                        {testingId === config.id ? '正在测试…' : '测试连接'}
                      </button>
                      <button
                        className="text-button"
                        onClick={() => startEdit(config)}
                        type="button"
                      >
                        编辑
                      </button>
                      <button
                        className="text-button danger-text"
                        disabled={deletingId === config.id}
                        onClick={() => deleteConfig(config)}
                        type="button"
                      >
                        {deletingId === config.id ? '正在删除…' : '删除配置'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="model-config-editor" aria-labelledby="model-config-editor-title">
          <div className="editor-heading">
            <div>
              <p className="workspace-step">{editingId ? '编辑配置' : '新增配置'}</p>
              <h2 id="model-config-editor-title">
                {editingId ? '调整模型连接' : '连接 DeepSeek'}
              </h2>
            </div>
            {editingId ? (
              <button className="text-button" onClick={startNew} type="button">
                取消编辑
              </button>
            ) : null}
          </div>

          <form className="auth-form settings-form" onSubmit={saveConfig}>
            <label className="field">
              <span>配置名称</span>
              <input
                maxLength={80}
                onChange={(event) => updateEditor('name', event.target.value)}
                placeholder="例如：DeepSeek 正文"
                required
                value={editor.name}
              />
            </label>

            <label className="field">
              <span>Base URL</span>
              <input
                onChange={(event) => updateEditor('baseUrl', event.target.value)}
                required
                type="url"
                value={editor.baseUrl}
              />
            </label>

            <label className="field">
              <span>模型名</span>
              <input
                onChange={(event) => updateEditor('model', event.target.value)}
                required
                value={editor.model}
              />
            </label>

            <label className="field">
              <span>API Key</span>
              <input
                autoComplete="off"
                onChange={(event) => updateEditor('apiKey', event.target.value)}
                placeholder={editingId ? '留空则保留当前 Key' : '粘贴 DeepSeek API Key'}
                required={!editingId}
                type="password"
                value={editor.apiKey}
              />
            </label>

            <div className="field">
              <label htmlFor="model-purpose">用途</label>
              <select
                id="model-purpose"
                onChange={(event) => updateEditor('purpose', event.target.value as ModelPurpose)}
                value={editor.purpose}
              >
                {(['planning', 'prose', 'check'] as ModelPurpose[]).map((purpose) => (
                  <option key={purpose} value={purpose}>
                    {PURPOSE_LABELS[purpose]}
                  </option>
                ))}
              </select>
            </div>
            <p className="field-hint">{PURPOSE_DESCRIPTIONS[editor.purpose]}</p>

            <label className="checkbox-field">
              <input
                checked={editor.isDefault}
                disabled={editingId !== undefined && items.some((item) => item.id === editingId && item.isDefault)}
                onChange={(event) => updateEditor('isDefault', event.target.checked)}
                type="checkbox"
              />
              <span>设为默认配置</span>
            </label>

            {purposeInUse ? (
              <p className="form-message form-message-error" role="alert">
                这个用途已经有一套配置，请编辑或删除原来的配置。
              </p>
            ) : null}

            <button
              className="primary-button settings-save"
              disabled={saving || purposeInUse}
              type="submit"
            >
              {saving ? '正在保存…' : '保存配置'}
            </button>
          </form>
        </aside>
      </div>
    </main>
  );
}
