"use client";

import {
  Activity,
  CircleCheck,
  Database,
  RefreshCw,
  Server,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  livenessResponseSchema,
  readinessResponseSchema,
  type DependencyCheck,
  type LivenessResponse,
  type ReadinessResponse,
} from "@novel-brain/contracts";

type HealthState =
  | { phase: "loading" }
  | { phase: "loaded"; liveness: LivenessResponse; readiness: ReadinessResponse }
  | { phase: "error" };

const checkLabels: Record<DependencyCheck["name"], string> = {
  database: "数据库",
  queue: "任务队列",
};

function dependencyCheck(readiness: ReadinessResponse | undefined, name: DependencyCheck["name"]) {
  return readiness?.data.checks.find((check) => check.name === name);
}

export function HealthDashboard() {
  const [state, setState] = useState<HealthState>({ phase: "loading" });
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 5_000);

    async function loadHealth() {
      setState({ phase: "loading" });

      try {
        const [livenessResponse, readinessResponse] = await Promise.all([
          fetch("/api/v1/health", { cache: "no-store", signal: controller.signal }),
          fetch("/api/v1/health/ready", { cache: "no-store", signal: controller.signal }),
        ]);

        if (!livenessResponse.ok) {
          throw new Error("liveness_request_failed");
        }

        const liveness = livenessResponseSchema.parse(await livenessResponse.json());
        const readiness = readinessResponseSchema.parse(await readinessResponse.json());
        setState({ phase: "loaded", liveness, readiness });
      } catch {
        if (active) {
          setState({ phase: "error" });
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void loadHealth();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [refreshToken]);

  const readiness = state.phase === "loaded" ? state.readiness : undefined;
  const database = dependencyCheck(readiness, "database");
  const queue = dependencyCheck(readiness, "queue");
  const ready = readiness?.data.status === "ready";
  const statusLabel =
    state.phase === "loading"
      ? "检查中"
      : state.phase === "error"
        ? "无法连接"
        : ready
          ? "运行正常"
          : "需要处理";
  const statusClass =
    state.phase === "loading"
      ? "pending"
      : state.phase === "error" || !ready
        ? "danger"
        : "success";

  return (
    <>
      <section className="page-head">
        <div>
          <p className="eyebrow">系统</p>
          <h1>服务状态</h1>
          <p className="page-sub">查看应用、数据库和任务队列是否可用。</p>
        </div>
        <div className="head-actions">
          <span className={`status-pill ${statusClass}`}>
            {statusClass === "success" ? (
              <CircleCheck size={15} aria-hidden="true" />
            ) : statusClass === "danger" ? (
              <TriangleAlert size={15} aria-hidden="true" />
            ) : (
              <Activity size={15} aria-hidden="true" />
            )}
            {statusLabel}
          </span>
          <button className="btn btn-ghost" type="button" onClick={refresh}>
            <RefreshCw size={15} aria-hidden="true" />
            重新检查
          </button>
        </div>
      </section>

      <section className="status-grid" aria-label="服务检查结果">
        <StatusCard
          icon={<Server size={18} />}
          label="应用服务"
          status={state.phase === "loading" ? "loading" : state.phase === "error" ? "down" : "up"}
          detail={state.phase === "loaded" ? "请求正常" : "等待响应"}
        />
        <StatusCard
          icon={<Database size={18} />}
          label="数据库"
          status={state.phase === "loading" ? "loading" : (database?.status ?? "down")}
          detail={database ? `${database.latencyMs} ms` : "未取得检查结果"}
        />
        <StatusCard
          icon={<Workflow size={18} />}
          label="任务队列"
          status={state.phase === "loading" ? "loading" : (queue?.status ?? "down")}
          detail={queue ? `${queue.latencyMs} ms` : "未取得检查结果"}
        />
      </section>

      <section className="panel check-panel" aria-labelledby="check-panel-title">
        <div className="panel-head">
          <div>
            <span className="panel-kicker">运行检查</span>
            <h2 id="check-panel-title">检查详情</h2>
          </div>
          {readiness ? (
            <span className="check-time">
              最近检查 {new Date(readiness.data.timestamp).toLocaleTimeString("zh-CN")}
            </span>
          ) : null}
        </div>

        {state.phase === "loading" ? (
          <div className="check-list" aria-label="正在检查">
            <div className="check-row skeleton" />
            <div className="check-row skeleton" />
          </div>
        ) : state.phase === "error" ? (
          <div className="check-error">
            <TriangleAlert size={20} aria-hidden="true" />
            <div>
              <strong>暂时无法读取服务状态</strong>
              <p>请确认应用服务已经启动，然后重新检查。</p>
            </div>
          </div>
        ) : (
          <div className="check-list">
            {readiness?.data.checks.map((check) => (
              <div className="check-row" key={check.name}>
                <span className={`check-dot ${check.status}`} aria-hidden="true" />
                <strong>{checkLabels[check.name]}</strong>
                <span className="check-status">{check.status === "up" ? "可用" : "不可用"}</span>
                <span className="check-latency">{check.latencyMs} ms</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

interface StatusCardProps {
  icon: React.ReactNode;
  label: string;
  status: "up" | "down" | "loading";
  detail: string;
}

function StatusCard({ icon, label, status, detail }: StatusCardProps) {
  return (
    <article className="panel status-card">
      <span className={`status-icon ${status}`} aria-hidden="true">
        {icon}
      </span>
      <div>
        <span className="status-label">{label}</span>
        <strong>{status === "loading" ? "检查中" : status === "up" ? "可用" : "不可用"}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}
