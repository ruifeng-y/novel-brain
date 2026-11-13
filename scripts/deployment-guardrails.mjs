import { readFileSync } from "node:fs";

export function validateDeploymentAssets() {
  const errors = [];
  const compose = readFileSync("infra/docker/compose.yml", "utf8");
  const production = readFileSync("infra/docker/compose.production.yml", "utf8");
  const productionEnv = readFileSync(".env.production.example", "utf8");
  const prometheus = readFileSync("infra/observability/prometheus.yml", "utf8");
  const deployment = readFileSync("docs/operations/deployment.md", "utf8");
  const smoke = readFileSync("apps/worker/scripts/stack-smoke.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/deployment-smoke.yml", "utf8");

  for (const service of ["api:", "worker:", "migrate:", "caddy:", "minio:", "prometheus:"]) {
    if (!compose.includes(service)) {
      errors.push(`compose.yml missing service ${service.slice(0, -1)}`);
    }
  }
  if (!compose.includes("STORAGE_HEALTH_URL: http://minio:9000/minio/health/live")) {
    errors.push("API and Worker must use the internal MinIO health endpoint");
  }
  if (!prometheus.includes("job_name: novelbrain-api")) {
    errors.push("Prometheus must scrape the NovelBrain API");
  }
  if (!prometheus.includes("job_name: novelbrain-minio")) {
    errors.push("Prometheus must scrape MinIO storage metrics");
  }
  for (const value of [
    "${AUTH_SECRET:?AUTH_SECRET is required}",
    "${PROXY_IP_SECRET:?PROXY_IP_SECRET is required}",
    "${MODEL_CONFIG_ENCRYPTION_KEY:?MODEL_CONFIG_ENCRYPTION_KEY is required}",
    "${MODEL_PROVIDER_ALLOWLIST:?MODEL_PROVIDER_ALLOWLIST is required}",
    "${SMTP_HOST:?SMTP_HOST is required}",
  ]) {
    if (!production.includes(value)) {
      errors.push(`production compose must require ${value}`);
    }
  }
  if (
    !productionEnv.includes("DATABASE_URL=postgresql://") ||
    !productionEnv.includes("@postgres:")
  ) {
    errors.push("production env must use the internal Postgres hostname");
  }
  if (!productionEnv.includes("REDIS_URL=redis://redis:")) {
    errors.push("production env must use the internal Redis hostname");
  }
  for (const service of ["postgres", "redis", "mailpit", "minio", "api", "prometheus"]) {
    if (!production.includes(`${service}:\n    ports: !reset []`)) {
      errors.push(`production compose must remove public ports for ${service}`);
    }
  }
  if (!production.includes("Caddyfile.production")) {
    errors.push("production compose must use the production Caddyfile");
  }
  if (!production.includes('COOKIE_SECURE: "true"')) {
    errors.push("production compose must require secure cookies");
  }
  for (const command of [
    "docker compose --env-file .env -f infra/docker/compose.yml -f infra/docker/compose.production.yml up -d --build --wait",
    "pnpm stack:smoke",
    "node apps/worker/scripts/stack-smoke.mjs",
    "Rollback",
  ]) {
    if (!deployment.includes(command)) {
      errors.push(`deployment runbook missing ${command}`);
    }
  }
  for (const metric of [
    "novelbrain_api_request_duration_seconds",
    "novelbrain_worker_queue_jobs",
    "novelbrain_jobs_total",
    "novelbrain_model_cost_cny_total",
  ]) {
    if (!smoke.includes(metric)) {
      errors.push(`stack smoke missing ${metric}`);
    }
  }
  if (
    !workflow.includes(
      "docker compose --env-file .env.production.example -f infra/docker/compose.yml -f infra/docker/compose.production.yml up -d --build --wait",
    )
  ) {
    errors.push("deployment smoke workflow must build and start the production overlay");
  }
  if (!workflow.includes("node apps/worker/scripts/stack-smoke.mjs")) {
    errors.push("deployment smoke workflow must execute production stack smoke");
  }
  if (!workflow.includes("infra/docker/compose.production.yml config --quiet")) {
    errors.push("deployment smoke workflow must validate the production overlay");
  }
  if (!workflow.includes("/bin/promtool") || !workflow.includes("check config")) {
    errors.push("deployment smoke workflow must validate Prometheus configuration");
  }
  if (!workflow.includes("test rules /etc/prometheus/alerts.test.yml")) {
    errors.push("deployment smoke workflow must test Prometheus alert rules");
  }
  if (!smoke.includes("Metrics must not be exposed through the public Web origin")) {
    errors.push("stack smoke must reject public metrics exposure");
  }
  return errors;
}
