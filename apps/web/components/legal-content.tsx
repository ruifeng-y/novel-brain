import { ArrowLeft, ArrowRight, FileText, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";

import { legalCopy, legalDocumentOrder, type LegalDocumentKey } from "../lib/legal-content";

const documentIcons = {
  terms: FileText,
  privacy: ShieldCheck,
  "ai-disclosure": Sparkles,
} as const;

export function LegalOverview() {
  return (
    <div className="static-content-page legal-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">法律与合规</p>
          <h1>使用前需要知道的边界</h1>
          <p className="page-sub">作者保留作品版权；平台提供工具，不替代作者的发布责任。</p>
        </div>
        <Link className="btn btn-ghost" href="/workspace/settings/account">
          <ArrowLeft size={17} aria-hidden="true" />
          <span>返回账号设置</span>
        </Link>
      </header>

      <DraftNotice />

      <div className="legal-document-grid">
        {legalDocumentOrder.map((key) => {
          const document = legalCopy.documents[key];
          const Icon = documentIcons[key];
          return (
            <Link className="panel legal-document-link" href={`/legal/${key}`} key={key}>
              <Icon size={22} aria-hidden="true" />
              <span className="panel-kicker">{document.title}</span>
              <h2>{document.summary}</h2>
              <span className="legal-link-action">
                阅读全文
                <ArrowRight size={16} aria-hidden="true" />
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function LegalDocumentContent({ documentKey }: { documentKey: LegalDocumentKey }) {
  const document = legalCopy.documents[documentKey];
  const Icon = documentIcons[documentKey];

  return (
    <div className="static-content-page legal-page">
      <header className="page-head legal-document-head">
        <div>
          <p className="eyebrow">法律与合规</p>
          <h1>{document.title}</h1>
          <p className="page-sub">{document.summary}</p>
        </div>
        <Link className="btn btn-ghost" href="/legal">
          <ArrowLeft size={17} aria-hidden="true" />
          <span>全部条款</span>
        </Link>
      </header>

      <DraftNotice />

      <div className="legal-document-layout">
        <aside className="panel legal-document-nav" aria-label="法律文件">
          {legalDocumentOrder.map((key) => {
            const item = legalCopy.documents[key];
            const ItemIcon = documentIcons[key];
            return (
              <Link
                aria-current={key === documentKey ? "page" : undefined}
                className={key === documentKey ? "active" : ""}
                href={`/legal/${key}`}
                key={key}
              >
                <ItemIcon size={17} aria-hidden="true" />
                <span>{item.title}</span>
              </Link>
            );
          })}
        </aside>

        <article className="panel legal-document-body">
          <div className="legal-document-meta">
            <Icon size={21} aria-hidden="true" />
            <span>版本 {legalCopy.version}</span>
            <span>更新于 {legalCopy.lastUpdated}</span>
          </div>
          {document.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}

function DraftNotice() {
  return (
    <div className="legal-draft-notice" role="note">
      <ShieldCheck size={19} aria-hidden="true" />
      <div>
        <strong>当前版本为运营前草案</strong>
        <span>正式上线前，运营主体、联系渠道和适用地区仍需负责人复核。</span>
      </div>
    </div>
  );
}
