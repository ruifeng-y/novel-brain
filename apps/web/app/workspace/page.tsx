import { ArrowRight, BookOpen } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "../../components/app-shell";
import { getCurrentAuthState } from "../../lib/auth";

export default async function WorkspacePage() {
  const auth = await getCurrentAuthState();
  if (auth.status === "unauthenticated") {
    redirect("/login?reason=session-expired");
  }
  if (auth.status === "forbidden") {
    redirect("/login?reason=permission");
  }

  return (
    <AppShell user={auth.data.user}>
      <section className="page-head">
        <div>
          <p className="eyebrow">个人工作室</p>
          <h1>工作台</h1>
          <p className="page-sub">作品、写作进度和待办会集中在这里。</p>
        </div>
      </section>

      <section className="panel workspace-empty" aria-labelledby="workspace-empty-title">
        <div className="empty-icon" aria-hidden="true">
          <BookOpen size={24} />
        </div>
        <div>
          <h2 id="workspace-empty-title">还没有作品</h2>
          <p>创作一部作品后，进度和待办会显示在这里。</p>
        </div>
        <Link className="btn btn-ghost" href="/health">
          查看服务状态
          <ArrowRight size={15} />
        </Link>
      </section>
    </AppShell>
  );
}
