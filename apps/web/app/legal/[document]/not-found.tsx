import Link from "next/link";

import { AppShell } from "../../../components/app-shell";

export default function LegalDocumentNotFound() {
  return (
    <AppShell>
      <div className="static-content-error">
        <h1>没有找到这份条款</h1>
        <p>链接可能已经更新，请从法律与合规首页重新选择。</p>
        <Link className="btn btn-primary" href="/legal">
          返回全部条款
        </Link>
      </div>
    </AppShell>
  );
}
