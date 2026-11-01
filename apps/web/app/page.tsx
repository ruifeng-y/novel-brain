import Link from 'next/link';

const cards = [
  {
    label: '接口',
    value: '创作服务',
    detail: '健康检查、接口文档和数据库连接',
  },
  {
    label: '后台任务',
    value: '任务队列',
    detail: '示例任务会写入数据库',
  },
  {
    label: 'Data',
    value: 'Postgres + MinIO',
    detail: '数据库和对象存储已接入',
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen px-6 py-10 lg:px-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <header className="flex flex-col gap-5 border-b border-[var(--line)] pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">
              NOVELBRAIN · M0 PLATFORM FOUNDATION
            </p>
            <h1 className="font-serif text-5xl font-bold tracking-tight text-[var(--foreground)]">
              NovelBrain
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--muted)]">
              面向个人作者的长篇 AI 创作平台。M0 平台底座已经把 Web、API、Worker、
              Postgres、Redis 和对象存储接成一条可启动的链路。
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              className="rounded-md bg-[var(--foreground)] px-4 py-2 text-sm text-white"
              href="/health"
            >
              查看系统健康
            </Link>
            <a
              className="rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm"
              href="/api/v1/health"
            >
              API 健康接口
            </a>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          {cards.map((card) => (
            <article
              className="rounded-lg border border-[var(--line)] bg-white p-5 shadow-sm"
              key={card.label}
            >
              <p className="text-xs font-semibold tracking-[0.12em] text-[var(--muted)]">
                {card.label}
              </p>
              <h2 className="mt-3 text-xl font-semibold">{card.value}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{card.detail}</p>
            </article>
          ))}
        </section>

        <section className="rounded-lg border border-[var(--line)] bg-white p-6">
          <p className="text-xs font-semibold tracking-[0.12em] text-[var(--muted)]">
            M0 平台底座
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <h2 className="text-lg font-semibold">已经接好的</h2>
              <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                <li>邮箱验证码注册和登录的接口位置</li>
                <li>作品与分支的数据入口</li>
                <li>自带模型 Key 的配置位置</li>
                <li>创作与后台任务的共享契约</li>
              </ul>
            </div>
            <div>
              <h2 className="text-lg font-semibold">下一步</h2>
              <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
                M0 的下一张票是邮箱验证码注册与登录。随后是作品创建、DeepSeek 配置、
                最小故事圣经、单章生成和事实确认。
              </p>
            </div>
          </div>
        </section>

        <footer className="flex flex-col gap-2 border-t border-[var(--line)] pt-6 text-xs text-[var(--muted)] md:flex-row md:items-center md:justify-between">
          <span>NovelBrain V1 · M0 walking skeleton</span>
          <span>M0 平台底座 · 可启动、可迁移、可观测</span>
        </footer>
      </div>
    </main>
  );
}
