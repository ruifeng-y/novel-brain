import { Queue } from "bullmq";
import contracts from "@novel-brain/contracts";

const { WORKER_QUEUE_NAME, readinessResponseSchema } = contracts;

const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3000";
const mailpitUrl = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const metricsUrl = process.env.METRICS_URL ?? "http://127.0.0.1:3001/api/v1/metrics";
const prometheusUrl = process.env.PROMETHEUS_URL ?? "http://127.0.0.1:9090";
const storageHealthUrl =
  process.env.STORAGE_HEALTH_URL ?? "http://127.0.0.1:9000/minio/health/live";
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");

function redisConnection() {
  return {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    ...(redisUrl.username ? { username: decodeURIComponent(redisUrl.username) } : {}),
    ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
    ...(redisUrl.pathname.length > 1 ? { db: Number(redisUrl.pathname.slice(1)) } : {}),
  };
}

async function fetchRequired(url, validate) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return validate ? validate(response) : response;
}

async function verifyPrometheusStorageMetrics() {
  const targets = await fetchRequired(`${prometheusUrl}/api/v1/targets`, async (response) => {
    const payload = await response.json();
    return payload.data?.activeTargets ?? [];
  });
  for (const job of ["novelbrain-api", "novelbrain-minio"]) {
    const target = targets.find((entry) => entry.labels?.job === job);
    if (!target || target.health !== "up") {
      throw new Error(`Prometheus target is not up: ${job}`);
    }
  }
  for (const metric of [
    "minio_cluster_capacity_usable_total_bytes",
    "minio_cluster_capacity_usable_free_bytes",
  ]) {
    const queryUrl = new URL("/api/v1/query", prometheusUrl);
    queryUrl.searchParams.set("query", metric);
    const result = await fetchRequired(queryUrl.toString(), async (response) => {
      const payload = await response.json();
      return payload.data?.result ?? [];
    });
    if (result.length === 0) {
      throw new Error(`Prometheus has no storage metric: ${metric}`);
    }
  }
}

async function waitForPrometheusStorageMetrics() {
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await verifyPrometheusStorageMetrics();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw lastError ?? new Error("Prometheus storage metrics did not become ready");
}

async function main() {
  await fetchRequired(`${webUrl}/health`, async (response) => {
    const html = await response.text();
    if (!html.includes("服务状态")) {
      throw new Error("Web health page did not render");
    }
  });

  await fetchRequired(`${apiUrl}/api/v1/health/ready`, async (response) => {
    readinessResponseSchema.parse(await response.json());
  });

  await fetchRequired(`${mailpitUrl}/api/v1/info`);
  for (const path of ["metrics", "METRICS", "foo/..%2Fmetrics", "foo/%252e%252e%252fmetrics"]) {
    const publicMetrics = await fetch(`${webUrl}/api/v1/${path}`);
    if (publicMetrics.status !== 404) {
      throw new Error(`Metrics must not be exposed through the public Web origin: ${path}`);
    }
  }
  await fetchRequired(storageHealthUrl);
  await fetchRequired(metricsUrl, async (response) => {
    const text = await response.text();
    for (const metric of [
      "novelbrain_api_request_duration_seconds",
      "novelbrain_worker_queue_jobs",
      "novelbrain_jobs_window",
      "novelbrain_model_cost_cny_window",
      "novelbrain_dependency_up",
    ]) {
      if (!text.includes(metric)) {
        throw new Error(`Metrics response is missing ${metric}`);
      }
    }
  });
  await waitForPrometheusStorageMetrics();

  const connection = redisConnection();
  const queue = new Queue(WORKER_QUEUE_NAME, { connection });
  await queue.waitUntilReady();

  try {
    const workers = await queue.getWorkers();
    if (workers.length === 0) {
      throw new Error("No Worker is consuming the queue");
    }
  } finally {
    await queue.close();
  }

  console.log(
    JSON.stringify({
      event: "stack.smoke.completed",
      web: `${webUrl}/health`,
      api: `${apiUrl}/api/v1/health/ready`,
      mailpit: `${mailpitUrl}/api/v1/info`,
      metrics: metricsUrl,
      prometheus: prometheusUrl,
      storage: storageHealthUrl,
      worker: "ready",
    }),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown stack smoke error";
  console.error(JSON.stringify({ event: "stack.smoke.failed", message }));
  process.exitCode = 1;
});
