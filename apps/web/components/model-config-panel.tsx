"use client";

import {
  CheckCircle2,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiErrorSchema,
  modelConfigResponseSchema,
  modelConfigsResponseSchema,
  modelConnectionTestResponseSchema,
  modelProvidersResponseSchema,
  type ModelConfig,
  type ModelConfigInput,
  type ModelConnectionTestStatus,
  type ModelProviderInfo,
  type ModelPurpose,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";

interface FormState {
  provider: "deepseek" | "openai-compatible";
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  purposes: ModelPurpose[];
  isDefault: boolean;
}

const emptyForm: FormState = {
  provider: "deepseek",
  label: "DeepSeek 正文",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  apiKey: "",
  purposes: ["writing"],
  isDefault: true,
};

const purposeOptions: Array<{ value: ModelPurpose; label: string }> = [
  { value: "planning", label: "规划" },
  { value: "writing", label: "正文" },
  { value: "review", label: "检查" },
];

export function ModelConfigPanel() {
  const [providers, setProviders] = useState<ModelProviderInfo[]>([]);
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<ModelConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const createIdempotencyKey = useRef<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    const response = await fetch("/api/v1/model-configs", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const configData = modelConfigsResponseSchema.parse(await response.json()).data;
    setConfigs(configData);
    return configData;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [providerResponse] = await Promise.all([
        fetch("/api/v1/model-configs/providers", { cache: "no-store" }),
        fetchConfigs(),
      ]);
      if (!providerResponse.ok) {
        throw new Error(await readError(providerResponse));
      }
      const providerData = modelProvidersResponseSchema.parse(await providerResponse.json()).data;
      setProviders(providerData);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "模型配置加载失败。");
    } finally {
      setLoading(false);
    }
  }, [fetchConfigs]);

  useEffect(() => {
    void load();
  }, [load]);

  function selectProvider(providerKey: string) {
    const provider = providers.find((item) => item.key === providerKey);
    setForm((current) => ({
      ...current,
      provider: providerKey as FormState["provider"],
      baseUrl: provider?.defaultBaseUrl ?? current.baseUrl,
      model: provider?.models[0] ?? current.model,
    }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const csrfToken = await getCsrfToken();
      const payload: Omit<ModelConfigInput, "apiKey"> & { apiKey?: string } = {
        provider: form.provider,
        label: form.label,
        baseUrl: form.baseUrl,
        model: form.model,
        purposes: form.purposes,
        isDefault: form.isDefault,
      };
      if (form.apiKey) {
        payload.apiKey = form.apiKey;
      }
      if (!editing && !createIdempotencyKey.current) {
        createIdempotencyKey.current = crypto.randomUUID();
      }
      const response = await fetch(
        editing ? `/api/v1/model-configs/${editing.id}` : "/api/v1/model-configs",
        {
          method: editing ? "PATCH" : "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
            ...(!editing ? { "idempotency-key": createIdempotencyKey.current ?? "" } : {}),
          },
          body: JSON.stringify(editing ? { ...payload, version: editing.version } : payload),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      modelConfigResponseSchema.parse(await response.json());
      setNotice(editing ? "模型配置已更新。" : "模型配置已保存。");
      if (!editing) {
        createIdempotencyKey.current = null;
      }
      setEditing(null);
      setForm(emptyForm);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "模型配置保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function testConfig(config: ModelConfig) {
    setBusy(config.id);
    setError("");
    setNotice("");
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch(`/api/v1/model-configs/${config.id}/test`, {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const result = modelConnectionTestResponseSchema.parse(await response.json()).data;
      await fetchConfigs();
      setNotice(result.status === "success" ? "连接正常。" : result.message);
    } catch (caught) {
      await fetchConfigs().catch(() => undefined);
      setError(caught instanceof Error ? caught.message : "连接测试失败。");
    } finally {
      setBusy("");
    }
  }

  async function remove(config: ModelConfig) {
    setBusy(config.id);
    setError("");
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch(`/api/v1/model-configs/${config.id}`, {
        method: "DELETE",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除失败。");
    } finally {
      setBusy("");
    }
  }

  function edit(config: ModelConfig) {
    setEditing(config);
    setForm({
      provider: config.provider,
      label: config.label,
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: "",
      purposes: config.purposes,
      isDefault: config.isDefault,
    });
  }

  if (loading) {
    return (
      <section className="panel model-config-loading" aria-label="正在加载模型配置">
        <LoaderCircle className="spin" size={18} aria-hidden="true" />
        正在加载模型配置
      </section>
    );
  }

  return (
    <div className="model-settings-grid">
      <section className="panel account-settings-card" aria-labelledby="model-config-title">
        <div className="panel-head">
          <div>
            <span className="panel-kicker">模型配置</span>
            <h2 id="model-config-title">正文、规划与检查用哪个模型</h2>
          </div>
          <button className="btn btn-ghost" onClick={load} type="button">
            <RefreshCw size={15} aria-hidden="true" />
            刷新
          </button>
        </div>

        {error ? <div className="model-notice danger">{error}</div> : null}
        {notice ? <div className="model-notice success">{notice}</div> : null}
        {configs.some((config) => config.lastTestStatus && config.lastTestStatus !== "success") ? (
          <div className="model-notice warning">部分配置连接异常，请检查后重试。</div>
        ) : null}

        {configs.length === 0 ? (
          <div className="model-empty">
            <TriangleAlert size={20} aria-hidden="true" />
            <div>
              <strong>还没有模型配置</strong>
              <p>添加自己的 DeepSeek Key 后才能开始生成。</p>
            </div>
          </div>
        ) : (
          <div className="model-config-list">
            {configs.map((config) => (
              <article className="model-config-row" key={config.id}>
                <span className="model-logo">{config.provider === "deepseek" ? "DS" : "AI"}</span>
                <div className="model-config-copy">
                  <strong>{config.label}</strong>
                  <small>
                    {purposeLabels(config.purposes)} · {config.model} · Key {config.keyMasked}
                  </small>
                </div>
                {config.isDefault ? <span className="badge jade-badge">默认</span> : null}
                <span
                  className={`badge ${config.lastTestStatus === "success" ? "live-badge" : ""}`}
                  data-status={config.lastTestStatus ?? "untested"}
                >
                  {config.lastTestStatus === "success" ? (
                    <CheckCircle2 size={12} aria-hidden="true" />
                  ) : null}
                  {connectionStatusLabel(config.lastTestStatus)}
                </span>
                <button
                  className="text-btn small"
                  disabled={busy === config.id}
                  onClick={() => testConfig(config)}
                  type="button"
                >
                  测试连接
                </button>
                <button
                  aria-label={`编辑 ${config.label}`}
                  className="icon-btn small"
                  onClick={() => edit(config)}
                  title="编辑模型配置"
                  type="button"
                >
                  <Pencil size={15} aria-hidden="true" />
                </button>
                <button
                  aria-label={`删除 ${config.label}`}
                  className="icon-btn small"
                  disabled={busy === config.id}
                  onClick={() => remove(config)}
                  title="删除配置"
                  type="button"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel account-settings-card" aria-labelledby="model-form-title">
        <div className="panel-head">
          <div>
            <span className="panel-kicker">{editing ? "编辑配置" : "新增配置"}</span>
            <h2 id="model-form-title">填写服务商与 Key</h2>
          </div>
        </div>
        <form className="model-form" onSubmit={save}>
          <label className="auth-field">
            <span>服务商</span>
            <select
              disabled={Boolean(editing)}
              onChange={(event) => selectProvider(event.target.value)}
              value={form.provider}
            >
              {providers.map((provider) => (
                <option key={provider.key} value={provider.key}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>配置名称</span>
            <input
              onChange={(event) => setForm({ ...form, label: event.target.value })}
              required
              value={form.label}
            />
          </label>
          <label className="auth-field">
            <span>Base URL</span>
            <input
              onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
              required
              type="url"
              value={form.baseUrl}
            />
          </label>
          <label className="auth-field">
            <span>模型名</span>
            <input
              onChange={(event) => setForm({ ...form, model: event.target.value })}
              required
              value={form.model}
            />
          </label>
          <fieldset className="model-purposes">
            <legend>适用场景</legend>
            {purposeOptions.map((purpose) => (
              <label key={purpose.value}>
                <input
                  checked={form.purposes.includes(purpose.value)}
                  onChange={(event) => {
                    const purposes = event.target.checked
                      ? [...form.purposes, purpose.value]
                      : form.purposes.filter((value) => value !== purpose.value);
                    if (purposes.length === 0) {
                      return;
                    }
                    setForm({
                      ...form,
                      purposes,
                    });
                  }}
                  type="checkbox"
                />
                {purpose.label}
              </label>
            ))}
          </fieldset>
          <label className="auth-field">
            <span>API Key</span>
            <input
              autoComplete="off"
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
              placeholder={editing ? "留空则保留原 Key" : "sk-..."}
              required={!editing}
              type="password"
              value={form.apiKey}
            />
          </label>
          <label className="model-check">
            <input
              checked={form.isDefault}
              onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
              type="checkbox"
            />
            设为默认配置
          </label>
          <div className="model-form-actions">
            {editing ? (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setEditing(null);
                  setForm(emptyForm);
                }}
                type="button"
              >
                取消
              </button>
            ) : null}
            <button className="btn btn-primary" disabled={busy === "save"} type="submit">
              {busy === "save" ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}
              {editing ? "保存修改" : "新增配置"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

async function readError(response: Response): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : "请求失败，请稍后重试。";
}

function connectionStatusLabel(status: ModelConnectionTestStatus | null): string {
  switch (status) {
    case "success":
      return "连接正常";
    case "key_invalid":
      return "Key 无效";
    case "rate_limited":
      return "已限流";
    case "timeout":
      return "连接超时";
    case "provider_error":
      return "服务商异常";
    case "error":
      return "连接失败";
    default:
      return "未测试";
  }
}

function purposeLabel(purpose: ModelPurpose): string {
  return purposeOptions.find((option) => option.value === purpose)?.label ?? purpose;
}

function purposeLabels(purposes: ModelPurpose[]): string {
  return [...purposes]
    .sort(
      (left, right) =>
        purposeOptions.findIndex((option) => option.value === left) -
        purposeOptions.findIndex((option) => option.value === right),
    )
    .map(purposeLabel)
    .join("、");
}
