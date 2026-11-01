'use client';

import { useEffect, useState } from 'react';

type HealthPayload = {
  status?: string;
  service?: string;
  checks?: Record<string, string>;
  timestamp?: string;
  message?: string;
};

type Result = {
  state: 'loading' | 'ok' | 'error';
  payload?: HealthPayload;
  error?: string;
};

async function loadHealth(path: string): Promise<HealthPayload> {
  const response = await fetch(path, { cache: 'no-store' });
  const payload = (await response.json()) as HealthPayload;
  if (!response.ok) {
    throw new Error(payload.message ?? `HTTP ${response.status}`);
  }
  return payload;
}

function ResultCard({ title, result }: { title: string; result: Result }) {
  return (
    <article className="rounded-lg border border-[var(--line)] bg-white p-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span
          className={
            result.state === 'ok'
              ? 'rounded-full bg-[#e2efe9] px-2 py-1 text-xs text-[var(--jade)]'
              : result.state === 'error'
                ? 'rounded-full bg-[#f5e4df] px-2 py-1 text-xs text-[var(--cinnabar)]'
                : 'rounded-full bg-[#eef1ec] px-2 py-1 text-xs text-[var(--muted)]'
          }
        >
          {result.state === 'ok' ? '正常' : result.state === 'error' ? '异常' : '检查中'}
        </span>
      </div>
      <pre className="mt-4 overflow-auto rounded-md bg-[#f7f8f5] p-3 text-xs leading-6 text-[#4d5953]">
        {JSON.stringify(result.payload ?? { error: result.error }, null, 2)}
      </pre>
    </article>
  );
}

export default function HealthPage() {
  const [liveness, setLiveness] = useState<Result>({ state: 'loading' });
  const [readiness, setReadiness] = useState<Result>({ state: 'loading' });

  useEffect(() => {
    loadHealth('/api/v1/health')
      .then((payload) => setLiveness({ state: 'ok', payload }))
      .catch((error: unknown) =>
        setLiveness({ state: 'error', error: error instanceof Error ? error.message : 'unknown' }),
      );

    loadHealth('/api/v1/health/ready')
      .then((payload) => setReadiness({ state: 'ok', payload }))
      .catch((error: unknown) =>
        setReadiness({ state: 'error', error: error instanceof Error ? error.message : 'unknown' }),
      );
  }, []);

  return (
    <main className="min-h-screen px-6 py-10 lg:px-12">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="border-b border-[var(--line)] pb-6">
          <p className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">
            NOVELBRAIN · HEALTH
          </p>
          <h1 className="mt-3 font-serif text-4xl font-bold">系统健康</h1>
          <p className="mt-3 text-sm text-[var(--muted)]">
            M0 平台底座的存活检查和就绪检查。就绪检查会验证 Postgres、Redis 和 MinIO。
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <ResultCard title="存活检查 /health" result={liveness} />
          <ResultCard title="就绪检查 /health/ready" result={readiness} />
        </section>

        <a className="text-sm text-[var(--cinnabar)]" href="/">
          返回工作台
        </a>
      </div>
    </main>
  );
}
