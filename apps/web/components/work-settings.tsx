"use client";

import {
  Archive,
  CheckCircle2,
  Copy,
  ImageUp,
  LoaderCircle,
  RotateCcw,
  Save,
  ShieldAlert,
  Tag,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  apiErrorSchema,
  workDuplicateRequestSchema,
  workResponseSchema,
  type WorkEditableStatus,
  type WorkGenre,
  type WorkOverview,
  type WorkScaleTarget,
  type WorkUpdateCadence,
} from "@novel-brain/contracts";

import { clearCsrfCache, getCsrfToken } from "../lib/csrf-client";

const genreLabels: Record<WorkGenre, string> = {
  xianxia: "仙侠",
  history: "历史",
  urban: "都市",
};

const statusLabels: Record<WorkEditableStatus, string> = {
  preparing: "筹备中",
  serializing: "连载中",
  paused: "暂停",
  completed: "已完本",
};

const scaleLabels: Record<WorkScaleTarget, string> = {
  short: "短篇",
  medium: "中篇",
  long: "长篇",
  epic: "超长篇",
};

const cadenceLabels: Record<WorkUpdateCadence, string> = {
  daily: "日更",
  every_other_day: "隔日更",
  weekly: "周更",
  irregular: "不定期",
};

interface WorkSettingsForm {
  title: string;
  penName: string;
  genre: WorkGenre;
  status: WorkEditableStatus;
  scaleTarget: WorkScaleTarget;
  chapterLengthTarget: number;
  tags: string;
  targetPlatform: string;
  targetAudience: string;
  readerPromise: string;
  updateCadence: WorkUpdateCadence;
  synopsis: string;
  styleSample: string;
  taboos: string;
}

export function WorkSettings({ workId }: { workId: string }) {
  const router = useRouter();
  const [work, setWork] = useState<WorkOverview | null>(null);
  const [form, setForm] = useState<WorkSettingsForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<"archive" | "duplicate" | "trash" | null>(null);
  const [copyManuscript, setCopyManuscript] = useState(false);
  const [copyHistory, setCopyHistory] = useState(false);
  const [duplicateKey, setDuplicateKey] = useState("");
  const [uploadingCover, setUploadingCover] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setPermissionDenied(false);
    try {
      const response = await fetch(`/api/v1/works/${workId}`, { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/login?reason=session-expired");
        return;
      }
      if (response.status === 403) {
        setPermissionDenied(true);
        return;
      }
      if (!response.ok) {
        throw new Error(await readError(response, "作品设置加载失败。"));
      }
      const data = workResponseSchema.parse(await response.json()).data;
      setWork(data);
      setForm(toForm(data));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "作品设置加载失败。");
    } finally {
      setLoading(false);
    }
  }, [router, workId]);

  useEffect(() => {
    void load();
  }, [load]);

  const readonly = work?.status === "completed" || work?.status === "archived" || permissionDenied;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!work || !form || readonly) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const token = await getCsrfToken();
      const response = await fetch(`/api/v1/works/${work.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({
          version: work.version,
          title: form.title.trim(),
          penName: form.penName.trim(),
          genre: form.genre,
          status: form.status,
          scaleTarget: form.scaleTarget,
          chapterLengthTarget: form.chapterLengthTarget,
          tags: parseTags(form.tags),
          settings: {
            targetPlatform: form.targetPlatform.trim(),
            targetAudience: form.targetAudience.trim(),
            readerPromise: form.readerPromise.trim(),
            updateCadence: form.updateCadence,
            synopsis: form.synopsis.trim(),
            styleSample: form.styleSample.trim(),
            taboos: form.taboos.trim(),
          },
        }),
      });
      if (!response.ok) {
        if (handleAuthFailure(response)) return;
        throw new Error(await readError(response, "作品设置保存失败。"));
      }
      const updated = workResponseSchema.parse(await response.json()).data;
      setWork(updated);
      setForm(toForm(updated));
      setNotice("作品设置已保存。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "作品设置保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!work) return;
    setAction("archive");
    setError("");
    setNotice("");
    try {
      const token = await getCsrfToken();
      const response = await fetch(`/api/v1/works/${work.id}/archive`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({ version: work.version }),
      });
      if (!response.ok) {
        if (handleAuthFailure(response)) return;
        throw new Error(await readError(response, "作品归档失败。"));
      }
      const updated = workResponseSchema.parse(await response.json()).data;
      setWork(updated);
      setForm(toForm(updated));
      setDialog(null);
      setNotice("作品已归档，可在工作台筛选“已归档”后恢复。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "作品归档失败。");
    } finally {
      setAction("");
    }
  }

  async function restore() {
    if (!work) return;
    setAction("restore");
    setError("");
    setNotice("");
    try {
      const token = await getCsrfToken();
      const response = await fetch(`/api/v1/works/${work.id}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({ version: work.version }),
      });
      if (!response.ok) {
        if (handleAuthFailure(response)) return;
        throw new Error(await readError(response, "作品恢复失败。"));
      }
      const updated = workResponseSchema.parse(await response.json()).data;
      setWork(updated);
      setForm(toForm(updated));
      setNotice("作品已恢复到归档前状态。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "作品恢复失败。");
    } finally {
      setAction("");
    }
  }

  async function reopen() {
    if (!work) return;
    setAction("reopen");
    setError("");
    try {
      const token = await getCsrfToken();
      const response = await fetch(`/api/v1/works/${work.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({ version: work.version, status: "serializing" }),
      });
      if (!response.ok) {
        if (handleAuthFailure(response)) return;
        throw new Error(await readError(response, "恢复连载失败。"));
      }
      const updated = workResponseSchema.parse(await response.json()).data;
      setWork(updated);
      setForm(toForm(updated));
      setNotice("作品已恢复连载，可以继续修改。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "恢复连载失败。");
    } finally {
      setAction("");
    }
  }

  async function duplicate() {
    if (!work) return;
    setAction("duplicate");
    setError("");
    try {
      const token = await getCsrfToken();
      const request = workDuplicateRequestSchema.parse({ copyManuscript, copyHistory });
      const requestKey = duplicateKey || crypto.randomUUID();
      if (!duplicateKey) setDuplicateKey(requestKey);
      const response = await fetch(`/api/v1/works/${work.id}/duplicate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": token,
          "idempotency-key": requestKey,
        },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        if (handleAuthFailure(response)) return;
        throw new Error(await readError(response, "复制作品失败。"));
      }
      const copied = workResponseSchema.parse(await response.json()).data;
      setDialog(null);
      router.push(`/workspace/${copied.id}/overview`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "复制作品失败。");
    } finally {
      setAction("");
    }
  }

  async function uploadCover(file: File | undefined) {
    if (!file || !work || readonly) return;
    if (file.size === 0 || file.size > 5 * 1024 * 1024) {
      setError("封面图片大小必须在 5MB 以内。");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("封面仅支持 JPEG、PNG 或 WebP。");
      return;
    }
    setUploadingCover(true);
    setError("");
    setNotice("");
    try {
      const token = await getCsrfToken();
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`/api/v1/works/${work.id}/cover?version=${work.version}`, {
        method: "PUT",
        headers: { "x-csrf-token": token },
        body,
      });
      if (!response.ok) {
        if (handleAuthFailure(response)) return;
        throw new Error(await readError(response, "封面上传失败。"));
      }
      const updated = workResponseSchema.parse(await response.json()).data;
      setWork(updated);
      setNotice("作品封面已更新。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "封面上传失败。");
    } finally {
      setUploadingCover(false);
    }
  }

  async function trashWork() {
    if (!work) return;
    setAction("trash");
    setError("");
    try {
      const token = await getCsrfToken();
      const response = await fetch(`/api/v1/works/${work.id}/trash`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({ version: work.version }),
      });
      if (!response.ok) {
        if (handleAuthFailure(response)) return;
        throw new Error(await readError(response, "移入回收站失败。"));
      }
      router.push("/workspace?trash=true");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "移入回收站失败。");
    } finally {
      setAction("");
    }
  }

  function handleAuthFailure(response: Response): boolean {
    if (response.status === 401) {
      clearCsrfCache();
      router.replace("/login?reason=session-expired");
      return true;
    }
    if (response.status === 403) {
      setPermissionDenied(true);
      return true;
    }
    return false;
  }

  if (permissionDenied) {
    return (
      <section className="panel work-settings-state" role="alert">
        <ShieldAlert size={22} aria-hidden="true" />
        <div>
          <h1>无权修改这本作品</h1>
          <p>只有作品作者可以查看和修改作品设置。</p>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="panel work-settings-state" role="status">
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
        <span>正在加载作品设置</span>
      </section>
    );
  }

  if (error && !work) {
    return (
      <section className="panel work-settings-state" role="alert">
        <TriangleAlert size={20} aria-hidden="true" />
        <div>
          <h1>作品设置加载失败</h1>
          <p>{error}</p>
          <button className="btn btn-ghost btn-small" onClick={load} type="button">
            重试
          </button>
        </div>
      </section>
    );
  }

  if (!work || !form) return null;

  return (
    <>
      <section className="page-head">
        <div>
          <p className="eyebrow">作品设置</p>
          <h1>把这本书的边界定清楚</h1>
          <p className="page-sub">作品级设置只影响《{work.title}》；模型配置仍在账号级。</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-ghost" onClick={load} type="button">
            <RotateCcw size={15} aria-hidden="true" />
            刷新
          </button>
          {work.status === "archived" ? (
            <button
              className="btn btn-primary"
              disabled={action !== ""}
              onClick={restore}
              type="button"
            >
              {action === "restore" ? (
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
              ) : (
                <Archive size={15} aria-hidden="true" />
              )}
              恢复作品
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={readonly || saving}
              form="work-settings-form"
              type="submit"
            >
              {saving ? (
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
              ) : (
                <Save size={15} aria-hidden="true" />
              )}
              保存设置
            </button>
          )}
        </div>
      </section>

      {work.status === "archived" ? (
        <div className="model-notice warning" role="status">
          <Archive size={16} aria-hidden="true" />
          <span>作品已归档，恢复后会回到归档前的创作状态。</span>
        </div>
      ) : null}
      {work.status === "completed" ? (
        <div className="model-notice warning" role="status">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>作品已完本，默认只读。</span>
          <button
            className="text-btn small"
            disabled={action !== ""}
            onClick={reopen}
            type="button"
          >
            恢复连载
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="model-notice danger" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="model-notice success" role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>{notice}</span>
        </div>
      ) : null}

      <div className="work-settings-layout">
        <form className="panel work-settings-form" id="work-settings-form" onSubmit={save}>
          <fieldset disabled={readonly || saving}>
            <div className="panel-head">
              <div>
                <span className="panel-kicker">基础信息</span>
                <h2>书名与创作方向</h2>
              </div>
              <span className="badge">{statusLabels[toEditableStatus(work.status)]}</span>
            </div>
            <div className="work-settings-grid">
              <label className="auth-field">
                <span>书名</span>
                <input
                  maxLength={120}
                  onChange={(event) => update("title", event.target.value)}
                  required
                  value={form.title}
                />
              </label>
              <label className="auth-field">
                <span>笔名</span>
                <input
                  maxLength={50}
                  onChange={(event) => update("penName", event.target.value)}
                  required
                  value={form.penName}
                />
              </label>
              <label className="auth-field">
                <span>题材</span>
                <select
                  onChange={(event) => update("genre", event.target.value as WorkGenre)}
                  value={form.genre}
                >
                  {Object.entries(genreLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="auth-field">
                <span>目标平台</span>
                <input
                  maxLength={80}
                  onChange={(event) => update("targetPlatform", event.target.value)}
                  placeholder="例如：起点中文网"
                  value={form.targetPlatform}
                />
              </label>
              <label className="auth-field">
                <span>目标读者</span>
                <input
                  maxLength={500}
                  onChange={(event) => update("targetAudience", event.target.value)}
                  value={form.targetAudience}
                />
              </label>
              <label className="auth-field">
                <span>读者承诺</span>
                <input
                  maxLength={500}
                  onChange={(event) => update("readerPromise", event.target.value)}
                  value={form.readerPromise}
                />
              </label>
              <label className="auth-field">
                <span>规模</span>
                <select
                  onChange={(event) => update("scaleTarget", event.target.value as WorkScaleTarget)}
                  value={form.scaleTarget}
                >
                  {Object.entries(scaleLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="auth-field">
                <span>章节字数</span>
                <input
                  max={10000}
                  min={1000}
                  onChange={(event) => update("chapterLengthTarget", Number(event.target.value))}
                  type="number"
                  value={form.chapterLengthTarget}
                />
              </label>
              <label className="auth-field">
                <span>更新节奏</span>
                <select
                  onChange={(event) =>
                    update("updateCadence", event.target.value as WorkUpdateCadence)
                  }
                  value={form.updateCadence}
                >
                  {Object.entries(cadenceLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="auth-field">
                <span>连载状态</span>
                <select
                  onChange={(event) => update("status", event.target.value as WorkEditableStatus)}
                  value={form.status}
                >
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="auth-field work-settings-wide">
                <span>标签</span>
                <input
                  maxLength={600}
                  onChange={(event) => update("tags", event.target.value)}
                  placeholder="用逗号分隔，例如：记忆代价, 长线伏笔"
                  value={form.tags}
                />
              </label>
              <label className="auth-field work-settings-wide">
                <span>简介</span>
                <textarea
                  maxLength={4000}
                  onChange={(event) => update("synopsis", event.target.value)}
                  rows={3}
                  value={form.synopsis}
                />
              </label>
              <label className="auth-field work-settings-wide">
                <span>风格样本</span>
                <textarea
                  maxLength={4000}
                  onChange={(event) => update("styleSample", event.target.value)}
                  rows={3}
                  value={form.styleSample}
                />
              </label>
              <label className="auth-field work-settings-wide">
                <span>禁忌</span>
                <textarea
                  maxLength={2000}
                  onChange={(event) => update("taboos", event.target.value)}
                  rows={2}
                  value={form.taboos}
                />
              </label>
            </div>
          </fieldset>
        </form>

        <aside className="work-settings-side">
          <section className="panel">
            <div className="panel-head">
              <h3>封面</h3>
              <span className="badge">{work.coverImageUrl ? "已上传" : "未设置"}</span>
            </div>
            {work.coverImageUrl ? (
              <img
                alt="作品封面"
                className="work-settings-cover"
                referrerPolicy="no-referrer"
                src={work.coverImageUrl}
              />
            ) : (
              <div className={`work-settings-cover work-settings-cover-${form.genre}`}>
                <span>{genreLabels[form.genre]}</span>
                <strong>{form.title.slice(0, 8)}</strong>
              </div>
            )}
            <p className="work-settings-hint">
              <Tag size={14} aria-hidden="true" />
              封面只用于书架和作品总览，不影响正文生成。
            </p>
            <label className="btn btn-ghost btn-block cover-upload-button">
              {uploadingCover ? (
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
              ) : (
                <ImageUp size={15} aria-hidden="true" />
              )}
              <span>
                {uploadingCover ? "正在上传" : work.coverImageUrl ? "更换封面" : "上传封面"}
              </span>
              <input
                accept="image/jpeg,image/png,image/webp"
                disabled={readonly || uploadingCover}
                onChange={(event) => {
                  void uploadCover(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
                type="file"
              />
            </label>
            <p className="work-settings-hint">
              JPEG、PNG 或 WebP，最大 5MB；上传后会安全压缩为 WebP。
            </p>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>作品操作</h3>
            </div>
            <div className="work-action-list">
              <button
                onClick={() => {
                  setDuplicateKey(crypto.randomUUID());
                  setDialog("duplicate");
                }}
                type="button"
              >
                <Copy size={17} aria-hidden="true" />
                <div>
                  <strong>复制作品</strong>
                  <small>复制作品设置、故事圣经、独立设定、大纲与可独立风格样本</small>
                </div>
              </button>
              {work.status === "archived" ? (
                <button disabled={action !== ""} onClick={restore} type="button">
                  <RotateCcw size={17} aria-hidden="true" />
                  <div>
                    <strong>恢复作品</strong>
                    <small>回到归档前的连载状态</small>
                  </div>
                </button>
              ) : (
                <button
                  disabled={action !== "" || readonly}
                  onClick={() => setDialog("archive")}
                  type="button"
                >
                  <Archive size={17} aria-hidden="true" />
                  <div>
                    <strong>归档作品</strong>
                    <small>从书架隐藏，保留分支与版本数据</small>
                  </div>
                </button>
              )}
              <button
                className="danger-action"
                disabled={action !== "" || readonly}
                onClick={() => setDialog("trash")}
                type="button"
              >
                <Trash2 size={17} aria-hidden="true" />
                <div>
                  <strong>移入回收站</strong>
                  <small>保留 30 天，永久删除前必须先完成导出</small>
                </div>
              </button>
            </div>
          </section>
        </aside>
      </div>

      {dialog ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="work-settings-dialog-title"
            aria-modal="true"
            className="modal work-settings-dialog"
            role="dialog"
          >
            <div className="modal-head">
              <div>
                <span className="panel-kicker">
                  {dialog === "archive"
                    ? "确认归档"
                    : dialog === "trash"
                      ? "移入回收站"
                      : "复制作品"}
                </span>
                <h2 id="work-settings-dialog-title">
                  {dialog === "archive"
                    ? "归档后仍可恢复"
                    : dialog === "trash"
                      ? "30 天内仍可在工作台恢复"
                      : "选择要复制的内容"}
                </h2>
              </div>
              <button
                aria-label="关闭"
                className="icon-btn"
                onClick={() => setDialog(null)}
                type="button"
              >
                ×
              </button>
            </div>
            {dialog === "archive" || dialog === "trash" ? (
              <div className="modal-body">
                <p>
                  {dialog === "archive"
                    ? "归档不会删除分支、版本或正文，可随时从工作台恢复。"
                    : "作品会从默认书架隐藏，并在 30 天后允许永久删除。永久删除前必须先完成导出。"}
                </p>
              </div>
            ) : (
              <div className="modal-body copy-work-body">
                <label className="check-row">
                  <input checked readOnly type="checkbox" />
                  <span>作品设置、故事圣经、独立设定、大纲与可独立风格样本</span>
                </label>
                <p className="work-settings-copy-boundary">
                  默认不会复制正文、章节版本、章节派生事实、人物认知状态与黄金三章候选。正文与章节历史可在下方显式选择，其余依赖内容需要在新作品重新生成。
                </p>
                <label className="check-row">
                  <input
                    checked={copyManuscript}
                    onChange={(event) => {
                      setCopyManuscript(event.target.checked);
                      if (!event.target.checked) setCopyHistory(false);
                    }}
                    type="checkbox"
                  />
                  <span>正文（默认不复制）</span>
                </label>
                <label className="check-row">
                  <input
                    checked={copyHistory}
                    disabled={!copyManuscript}
                    onChange={(event) => setCopyHistory(event.target.checked)}
                    type="checkbox"
                  />
                  <span>章节历史版本（需先选择正文）</span>
                </label>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setDialog(null)} type="button">
                取消
              </button>
              <button
                className="btn btn-primary"
                disabled={action !== ""}
                onClick={
                  dialog === "archive" ? archive : dialog === "trash" ? trashWork : duplicate
                }
                type="button"
              >
                {action ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : null}
                {dialog === "archive" ? "确认归档" : dialog === "trash" ? "确认移入" : "创建副本"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );

  function update<K extends keyof WorkSettingsForm>(key: K, value: WorkSettingsForm[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }
}

function toForm(work: WorkOverview): WorkSettingsForm {
  return {
    title: work.title,
    penName: work.penName,
    genre: work.genre,
    status: toEditableStatus(work.status),
    scaleTarget: work.scaleTarget,
    chapterLengthTarget: work.chapterLengthTarget,
    tags: work.tags.join(", "),
    targetPlatform: stringSetting(work.settings.targetPlatform),
    targetAudience: stringSetting(work.settings.targetAudience),
    readerPromise: stringSetting(work.settings.readerPromise),
    updateCadence: cadenceSetting(work.settings.updateCadence),
    synopsis: stringSetting(work.settings.synopsis),
    styleSample: stringSetting(work.settings.styleSample),
    taboos: stringSetting(work.settings.taboos),
  };
}

function toEditableStatus(status: WorkOverview["status"]): WorkEditableStatus {
  return status === "draft" || status === "archived" ? "preparing" : status;
}

function stringSetting(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cadenceSetting(value: unknown): WorkUpdateCadence {
  return value === "every_other_day" || value === "weekly" || value === "irregular"
    ? value
    : "daily";
}

function parseTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,，]/u)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

async function readError(response: Response, fallback: string): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : fallback;
}
