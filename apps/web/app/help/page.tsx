import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '帮助与快捷键 · NovelBrain',
};

const shortcuts = [
  ['Ctrl / ⌘ + K', '打开全局搜索'],
  ['Esc', '关闭搜索、通知或账号菜单'],
  ['Ctrl / ⌘ + S', '在写作台保存当前章节'],
  ['Ctrl / ⌘ + Enter', '在写作台生成或继续生成'],
  ['Alt + 1 … 9', '在作品内快速切换左侧导航'],
  ['?', '打开这份帮助页'],
];

const glossary = [
  ['故事圣经', '这本书不可动摇的核心：一句话故事、主角、世界铁律、主线、结局方向和读者承诺。'],
  ['正史', '作者已经确认并锁定的内容。后续章节和生成任务必须遵守。'],
  ['平行版本', '从某个版本点分出的独立创作线，不会覆盖主线。'],
  ['伏笔账本', '记录伏笔的出现章节、计划回收章节和当前状态。'],
  ['任务报告', '一批章节完成后的质量、用量、连续性、伏笔和下一步建议。'],
  ['审核队列', '批量生成后等待作者批准、送写作台、驳回或送平行版本的章节。'],
];

const faqs = [
  {
    question: '生成到一半失败了怎么办？',
    answer:
      '到批量生产页打开任务详情，已完成章节会保留。确认模型 Key 和错误后点“从失败步骤重试”，不会从头重写。',
  },
  {
    question: '为什么自动通过不能用？',
    answer:
      '自动通过要求标准质量档位、所选章纲全部锁定，并且没有高风险事件。卷末和关键人物死亡等高风险章节始终需要人工确认。',
  },
  {
    question: '改了前面章节，后面怎么办？',
    answer:
      '已写部分尽量通过修改请求和影响分析处理。结构性冲突从版本点拉平行版本，确认后再选择性摘取回主线。',
  },
  {
    question: '作品数据怎么导出或删除？',
    answer:
      '账号设置里可以先导出全部作品和账号资料，再申请注销。注销后有 30 天恢复期，期满后在线数据永久删除。',
  },
];

export default function HelpPage() {
  return (
    <main className="workspace-shell settings-shell">
      <header className="workspace-header">
        <Link className="workspace-brand" href="/workspace">
          NovelBrain
        </Link>
        <nav className="workspace-nav" aria-label="帮助导航">
          <Link href="/workspace">作品书架</Link>
          <Link href="/workspace/settings">模型设置</Link>
          <Link href="/workspace/settings/account">账号设置</Link>
          <Link aria-current="page" href="/help">
            帮助
          </Link>
        </nav>
      </header>

      <section className="settings-hero">
        <div>
          <p className="workspace-step">使用说明</p>
          <h1>帮助与快捷键</h1>
        </div>
        <p>先看快捷键和术语，再查常见问题。所有入口都在作品导航和右上角工具里。</p>
      </section>

      <div className="help-layout">
        <section className="help-section" aria-labelledby="help-shortcuts-title">
          <p className="workspace-step">键盘</p>
          <h2 id="help-shortcuts-title">快捷键</h2>
          <dl className="help-shortcut-list">
            {shortcuts.map(([keys, description]) => (
              <div key={keys}>
                <dt>{keys}</dt>
                <dd>{description}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="help-section" aria-labelledby="help-glossary-title">
          <p className="workspace-step">术语</p>
          <h2 id="help-glossary-title">术语表</h2>
          <dl className="help-glossary-list">
            {glossary.map(([term, description]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{description}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="help-section help-section-wide" aria-labelledby="help-faq-title">
          <p className="workspace-step">常见问题</p>
          <h2 id="help-faq-title">FAQ</h2>
          <div className="help-faq-list">
            {faqs.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
