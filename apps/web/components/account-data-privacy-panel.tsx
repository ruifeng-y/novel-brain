"use client";

import {
  CheckCircle2,
  Download,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  accountDeletionResponseSchema,
  accountExportReceiptResponseSchema,
  type AccountDeletionRequest,
  type AccountExportReceipt,
} from "@novel-brain/contracts";

import { formatDateTime, readError } from "../lib/account-ui";
import { getCsrfToken } from "../lib/csrf-client";

export function AccountDataPrivacyPanel() {
  const router = useRouter();
  const [receipt, setReceipt] = useState<AccountExportReceipt | null>(null);
  const [deletion, setDeletion] = useState<AccountDeletionRequest | null>(null);
  const [loadingLifecycle, setLoadingLifecycle] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadLifecycle = useCallback(async () => {
    setLoadingLifecycle(true);
    try {
      const response = await fetch("/api/v1/users/me/deletion", { cache: "no-store" });
      if (response.status === 404) {
        setDeletion(null);
        return;
      }
      if (!response.ok) {
        throw new Error(await readError(response, "账号删除状态加载失败。"));
      }
      const lifecycle = accountDeletionResponseSchema.parse(await response.json()).data;
      setDeletion(lifecycle.status === "recovered" ? null : lifecycle);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "账号删除状态加载失败。");
    } finally {
      setLoadingLifecycle(false);
    }
  }, []);

  useEffect(() => {
    void loadLifecycle();
  }, [loadLifecycle]);

  async function exportAccount() {
    setBusy("export");
    setError("");
    setNotice("");
    try {
      const csrfToken = await getCsrfToken();
      const created = await fetch("/api/v1/users/me/export", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!created.ok) {
        throw new Error(await readError(created, "账号数据导出失败。"));
      }
      const exportReceipt = accountExportReceiptResponseSchema.parse(await created.json()).data;
      const downloaded = await fetch(`/api/v1/users/me/export/${exportReceipt.id}/download`);
      if (!downloaded.ok) {
        throw new Error(await readError(downloaded, "账号数据下载失败。"));
      }
      const url = URL.createObjectURL(await downloaded.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `novel-brain-account-${exportReceipt.generatedAt.slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setReceipt(exportReceipt);
      setNotice("账号数据已导出，核对无误后即可申请注销。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "账号数据导出失败。");
    } finally {
      setBusy("");
    }
  }

  async function requestDeletion() {
    if (!receipt) {
      return;
    }
    if (
      !window.confirm("申请注销后账号进入 30 天恢复期，期间可以恢复。是否继续？") ||
      !window.confirm("30 天后作品、正文、版本、设定、轨迹和导出文件会永久删除。确认申请注销？")
    ) {
      return;
    }
    setBusy("delete");
    setError("");
    setNotice("");
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch("/api/v1/users/me/delete", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ exportReceiptId: receipt.id, confirm: true }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "账号注销申请失败。"));
      }
      const lifecycle = accountDeletionResponseSchema.parse(await response.json()).data;
      setDeletion(lifecycle.status === "recovered" ? null : lifecycle);
      setReceipt(null);
      setNotice("注销申请已提交，账号进入 30 天恢复期。");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "账号注销申请失败。");
    } finally {
      setBusy("");
    }
  }

  async function recoverAccount() {
    setBusy("recover");
    setError("");
    setNotice("");
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch("/api/v1/users/me/deletion/recover", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!response.ok) {
        throw new Error(await readError(response, "账号恢复失败。"));
      }
      const lifecycle = accountDeletionResponseSchema.parse(await response.json()).data;
      setDeletion(lifecycle.status === "recovered" ? null : lifecycle);
      setNotice("账号已恢复，作品和数据保持原样。");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "账号恢复失败。");
    } finally {
      setBusy("");
    }
  }

  const isRecoverable = Boolean(
    deletion &&
    (deletion.status === "recovery_pending" || deletion.status === "failed") &&
    new Date(deletion.recoverableUntil).getTime() > Date.now(),
  );
  const failedStoreCount =
    deletion?.stores.filter((store) => store.status === "failed").length ?? 0;

  return (
    <section
      className="panel account-settings-card account-privacy-card"
      aria-labelledby="account-privacy-title"
    >
      <div className="panel-head">
        <div>
          <span className="panel-kicker">数据与隐私</span>
          <h2 id="account-privacy-title">你的作品和数据归你</h2>
        </div>
        {deletion ? <span className="badge">{statusLabel(deletion.status)}</span> : null}
      </div>

      {error ? (
        <div className="account-security-notice danger" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{error}</span>
          <button className="text-btn small" onClick={() => void loadLifecycle()} type="button">
            重试
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="account-security-notice success" role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>{notice}</span>
        </div>
      ) : null}
      {loadingLifecycle ? (
        <div className="account-security-loading" role="status">
          <LoaderCircle className="spin" size={17} aria-hidden="true" />
          正在加载数据与隐私状态
        </div>
      ) : null}

      <div className="data-action-list">
        <div>
          <Download size={18} aria-hidden="true" />
          <div>
            <strong>导出账号数据</strong>
            <small>作品、设定、正文、版本和修改记录；不包含模型 Key 或登录凭证</small>
          </div>
          <button
            className="btn btn-ghost btn-small"
            disabled={busy !== "" || isRecoverable}
            onClick={exportAccount}
            type="button"
          >
            {busy === "export" ? (
              <>
                <LoaderCircle className="spin" size={14} aria-hidden="true" />
                导出中
              </>
            ) : (
              "导出"
            )}
          </button>
        </div>
        <div>
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>隐私与数据范围</strong>
            <small>模型调用只发送必要上下文，Key 不进入导出包或普通日志</small>
          </div>
          <span className="badge jade-badge">已保护</span>
        </div>
        {deletion ? (
          <div className="data-lifecycle-row">
            <RotateCcw size={18} aria-hidden="true" />
            <div>
              <strong>{statusLabel(deletion.status)}</strong>
              <small>
                申请于 {formatDateTime(deletion.requestedAt)}；可恢复至{" "}
                {formatDateTime(deletion.recoverableUntil)}
              </small>
              {deletion.status === "failed" ? (
                <small className="danger-text">
                  {deletion.failure?.retryable
                    ? "部分数据清理未完成，系统会自动重试"
                    : "部分数据清理未完成，请稍后重试或联系支持"}
                  {failedStoreCount > 0 ? `（${failedStoreCount} 项待重试）` : ""}
                </small>
              ) : null}
            </div>
            {isRecoverable ? (
              <button
                className="btn btn-ghost btn-small"
                disabled={busy !== ""}
                onClick={recoverAccount}
                type="button"
              >
                {busy === "recover" ? "恢复中" : "恢复账号"}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="danger-row">
            <Trash2 size={18} aria-hidden="true" />
            <div>
              <strong>删除账号</strong>
              <small>需先完成数据导出；30 天内可恢复，过期后永久删除</small>
            </div>
            <button
              className="btn btn-ghost btn-small danger-button"
              disabled={!receipt || busy !== ""}
              onClick={requestDeletion}
              type="button"
            >
              {busy === "delete" ? "申请中" : receipt ? "申请注销" : "先导出再删除"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function statusLabel(status: AccountDeletionRequest["status"]): string {
  switch (status) {
    case "recovery_pending":
      return "恢复期内";
    case "purging":
      return "正在永久删除";
    case "failed":
      return "部分清理失败";
    case "completed":
      return "已完成删除";
    case "recovered":
      return "账号已恢复";
  }
}
