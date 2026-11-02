import Link from 'next/link';

const promises = [
  {
    label: '故事有根',
    detail: '人物、地点、规则和关系始终有据可查，不会写着写着变了样。',
  },
  {
    label: '线索有回响',
    detail: '伏笔、承诺和人物弧光放在同一处，重要的线不会被忘记。',
  },
  {
    label: '修改有退路',
    detail: '每一次调整都留有痕迹，想回头时不用重写整本书。',
  },
];

export default function HomePage() {
  return (
    <main className="home-shell">
      <header className="home-header">
        <Link className="home-brand" href="/">
          NovelBrain
        </Link>
        <nav className="home-nav" aria-label="账号">
          <Link href="/login">登录</Link>
          <Link className="home-nav-primary" href="/register">
            开始写作
          </Link>
        </nav>
      </header>

      <section className="home-hero">
        <p className="home-kicker">写给认真写长篇的人</p>
        <h1>
          把故事写到最后一行，
          <br />
          也让它始终站得住。
        </h1>
        <p className="home-lead">
          从一句想法开始，照看人物的选择、世界的规则和每一次伏笔。 NovelBrain
          陪你把漫长的一本书写到完成。
        </p>
        <div className="home-actions">
          <Link className="primary-button home-primary" href="/register">
            创建作者账号
          </Link>
          <Link className="home-secondary" href="/login">
            已有账号，直接登录
          </Link>
        </div>
      </section>

      <section className="home-promises" aria-label="写作支持">
        {promises.map((promise, index) => (
          <article key={promise.label}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <h2>{promise.label}</h2>
            <p>{promise.detail}</p>
          </article>
        ))}
      </section>

      <footer className="home-footer">
        <span>NovelBrain</span>
        <nav aria-label="法律文件" className="home-legal">
          <Link href="/legal/privacy">隐私政策</Link>
          <Link href="/legal/terms">用户协议</Link>
          <Link href="/legal/ai-content">AI 生成内容标识</Link>
        </nav>
        <span>为长篇创作留出足够的空间</span>
      </footer>
    </main>
  );
}
