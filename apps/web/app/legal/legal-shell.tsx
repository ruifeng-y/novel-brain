import Link from 'next/link';
import type { ReactNode } from 'react';

const legalLinks = [
  { href: '/legal/privacy', label: '隐私政策' },
  { href: '/legal/terms', label: '用户协议' },
  { href: '/legal/ai-content', label: 'AI 生成内容标识' },
];

export function LegalShell({ children }: { children: ReactNode }) {
  return (
    <main className="legal-shell">
      <header className="legal-header">
        <Link className="legal-brand" href="/">
          NovelBrain
        </Link>
        <nav aria-label="法律文件" className="legal-nav">
          {legalLinks.map((link) => (
            <Link href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
      </header>

      {children}

      <footer className="legal-footer">
        <span>NovelBrain</span>
        <span>作品归作者所有，平台只做创作所需的处理。</span>
      </footer>
    </main>
  );
}
