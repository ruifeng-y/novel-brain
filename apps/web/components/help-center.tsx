"use client";

import {
  BookOpen,
  CircleHelp,
  FileText,
  Keyboard,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { legalCopy } from "../lib/legal-content";

const guideSteps = [
  ["新建作品", "从一句话、空白模板或旧稿开始建立作品。"],
  ["故事圣经", "确认故事方向、主角、世界规则和读者承诺。"],
  ["大纲工作台", "逐层组织全书、卷、幕、章和场景。"],
  ["写作台", "在正文、事实、连续性和版本之间完成本章工作。"],
  ["导出与发布", "检查元数据、内容安全、AI 标识和发布准备。"],
] as const;

const glossary = [
  ["已确认设定", "后续生成必须遵守的事实、角色认知和叙事计划。"],
  ["平行版本", "从某个版本点分出的完整故事线，不覆盖主线。"],
  ["影响范围", "一次修改会波及的章节、设定和伏笔。"],
  ["质量报告", "钩子、节奏、信息密度、人物声纹、文笔和连续性检查。"],
] as const;

const faqs = [
  {
    question: "为什么不能直接在正文里改设定？",
    answer: "正文是设定的呈现结果。设定修改走修改请求后，才能保留原因、影响范围和回滚点。",
  },
  {
    question: "为什么生成前要确认故事圣经？",
    answer: "核心方向先稳定，后续章节才不会因为前提变化而整体漂移。",
  },
  {
    question: "模型 Key 会显示吗？",
    answer: "界面只显示掩码。普通日志不记录明文 Key，也不记录正文和完整提示词。",
  },
  {
    question: "发布内容遇到安全提示怎么办？",
    answer:
      "可以修正内容后重新导出，也可以从导出与发布页提交申诉或纠正说明。状态和证据会保留在内容安全记录中。",
  },
] as const;

export function HelpCenter() {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  const visibleFaqs = useMemo(
    () =>
      normalized
        ? faqs.filter((item) =>
            `${item.question}${item.answer}`.toLocaleLowerCase("zh-CN").includes(normalized),
          )
        : faqs,
    [normalized],
  );

  return (
    <div className="static-content-page help-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">帮助中心</p>
          <h1>先看这几件事</h1>
          <p className="page-sub">从开书路径到内容安全申诉，重要操作都在这里说明。</p>
        </div>
        <a className="btn btn-ghost" href="#shortcuts">
          <Keyboard size={17} aria-hidden="true" />
          <span>快捷键</span>
        </a>
      </header>

      <div className="help-search-row">
        <label>
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">搜索常见问题</span>
          <input
            aria-label="搜索常见问题"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索常见问题"
            type="search"
            value={query}
          />
        </label>
        <span>当前版本 {legalCopy.version}</span>
      </div>

      <div className="help-grid">
        <section className="panel help-card" aria-labelledby="help-steps-title">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">新手路径</span>
              <h2 id="help-steps-title">从想法到可发布稿件</h2>
            </div>
            <BookOpen size={20} aria-hidden="true" />
          </div>
          <ol className="help-steps">
            {guideSteps.map(([title, body], index) => (
              <li key={title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{title}</strong>
                  <small>{body}</small>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="panel help-card" aria-labelledby="shortcuts-title" id="shortcuts">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">操作</span>
              <h2 id="shortcuts-title">常用快捷键</h2>
            </div>
            <Keyboard size={20} aria-hidden="true" />
          </div>
          <div className="shortcut-list">
            <div>
              <span>全局搜索</span>
              <kbd>Ctrl K</kbd>
            </div>
            <div>
              <span>关闭弹层</span>
              <kbd>Esc</kbd>
            </div>
            <div>
              <span>专注写作</span>
              <Link href="/workspace">打开写作台</Link>
            </div>
            <div>
              <span>切换章节</span>
              <span>写作台左侧</span>
            </div>
          </div>
        </section>

        <section className="panel help-card" aria-labelledby="glossary-title">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">术语</span>
              <h2 id="glossary-title">创作语言</h2>
            </div>
            <CircleHelp size={20} aria-hidden="true" />
          </div>
          <div className="glossary-list">
            {glossary.map(([term, definition]) => (
              <div key={term}>
                <strong>{term}</strong>
                <small>{definition}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="panel help-card" aria-labelledby="legal-links-title">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">数据与合规</span>
              <h2 id="legal-links-title">使用前需要知道的边界</h2>
            </div>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className="help-resource-list">
            <Link href="/legal/terms">
              <FileText size={17} aria-hidden="true" />
              <span>用户协议</span>
            </Link>
            <Link href="/legal/privacy">
              <ShieldCheck size={17} aria-hidden="true" />
              <span>隐私政策</span>
            </Link>
            <Link href="/legal/ai-disclosure">
              <Sparkles size={17} aria-hidden="true" />
              <span>AI 生成内容说明</span>
            </Link>
          </div>
        </section>
      </div>

      <section className="panel help-faq-panel" aria-labelledby="faq-title">
        <div className="panel-head">
          <div>
            <span className="panel-kicker">常见问题</span>
            <h2 id="faq-title">你可能会问</h2>
          </div>
          <span className="badge">{visibleFaqs.length} 条</span>
        </div>
        {visibleFaqs.length > 0 ? (
          <div className="faq-list">
            {visibleFaqs.map((item) => (
              <article key={item.question}>
                <strong>{item.question}</strong>
                <p>{item.answer}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="static-empty-state" role="status">
            <CircleHelp size={24} aria-hidden="true" />
            <strong>没有找到帮助内容</strong>
            <p>换一个关键词，或直接查看上面的开书路径和术语。</p>
          </div>
        )}
      </section>
    </div>
  );
}
