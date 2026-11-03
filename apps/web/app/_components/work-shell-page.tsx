'use client';

import type { ReactNode } from 'react';
import { WorkShell, type WorkNavKey } from './app-shell';

export function WorkShellPage({
  workId,
  active,
  eyebrow,
  title,
  description,
  children,
}: {
  workId: string;
  active: WorkNavKey;
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <WorkShell active={active} workId={workId}>
      <main className="workspace-shell">
        <section className="shell-page-stub">
          <p className="workspace-step">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
          <p className="shell-page-note">此页面已接入新的作品壳层，内容迁移将在后续切片完成。</p>
          {children}
        </section>
      </main>
    </WorkShell>
  );
}
