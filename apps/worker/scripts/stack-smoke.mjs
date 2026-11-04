import { Queue } from "bullmq";
import contracts from "@novel-brain/contracts";

const { WORKER_QUEUE_NAME, readinessResponseSchema } = contracts;

const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3000";
const mailpitUrl = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
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
      worker: "ready",
    }),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown stack smoke error";
  console.error(JSON.stringify({ event: "stack.smoke.failed", message }));
  process.exitCode = 1;
});
