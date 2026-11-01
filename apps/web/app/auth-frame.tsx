import Link from 'next/link';
import type { ReactNode } from 'react';

export function AuthFrame({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-aside">
        <Link className="auth-brand" href="/">
          NovelBrain
        </Link>
        <div className="auth-aside-copy">
          <p className="auth-aside-kicker">为长篇而写</p>
          <h2>让每一次选择，都留在故事里。</h2>
          <p>从一句想法出发，照看人物、线索与伏笔，直到最后一章仍然站得住。</p>
        </div>
        <div className="auth-aside-note">
          <span>01</span>
          <p>你的作品和设定只属于你。</p>
        </div>
      </section>

      <section className="auth-main">
        <div className="auth-panel">
          <p className="auth-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="auth-intro">{intro}</p>
          {children}
        </div>
      </section>
    </main>
  );
}
