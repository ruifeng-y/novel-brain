import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalShell } from '../legal-shell';

export const metadata: Metadata = {
  title: 'AI 生成内容标识说明 · NovelBrain',
  description: '何时需要标识 AI 辅助创作，以及可直接使用的标识写法。',
};

export default function AiContentPage() {
  return (
    <LegalShell>
      <article className="legal-document">
        <header className="legal-hero">
          <p className="legal-kicker">隐私与使用说明</p>
          <h1>AI 生成内容标识说明</h1>
          <p className="legal-intro">
            当作品在构思、大纲、正文、改写或封面等环节使用了 AI，发布时应让读者和发布平台知道 AI
            参与的范围。标识不是免责声明，作者仍需对最终内容负责。
          </p>
          <p className="legal-meta">生效日期：2026 年 11 月 2 日 · 适用版本：V1</p>
        </header>

        <div className="legal-layout">
          <nav aria-label="本页目录" className="legal-toc">
            <a href="#when">什么时候需要标识</a>
            <a href="#how">推荐标识写法</a>
            <a href="#platform">发布到平台时怎么填</a>
            <a href="#author">作者需要做什么</a>
            <a href="#avoid">不建议的做法</a>
          </nav>

          <div className="legal-body">
            <section id="when">
              <h2>什么时候需要标识</h2>
              <p>
                只要 AI
                对最终公开内容有实质贡献，就应主动查看发布平台和适用法律的要求，并在需要时标识。
                包括由 AI
                起草或续写正文、生成关键情节或大纲、改写大段文字、生成重要设定，以及生成用于发布的封面或插图。
              </p>
              <p>
                如果 AI
                只用于拼写检查、错别字修正、简单检索或你最终没有采用其建议，通常不需要单独标识。
                如果发布平台提供“AI 参与创作”选项，即使只是辅助构思，也建议按平台问题如实选择。
              </p>
            </section>

            <section id="how">
              <h2>推荐标识写法</h2>
              <p>
                按实际使用范围选择一条，放在作品简介、作者的话、章节开头或章节末尾，确保读者能直接看到。
              </p>
              <ul>
                <li>本文使用 AI 辅助生成，经作者编辑、校对并承担内容责任。</li>
                <li>本章部分段落由 AI 辅助创作，作者已完成修改、事实核对和版权检查。</li>
                <li>本作品在构思、大纲或正文环节使用 AI 辅助，最终内容由作者选择和编辑。</li>
                <li>本作品封面或插图使用 AI 辅助制作，并已由作者检查。</li>
              </ul>
              <p>
                标识应说明 AI
                是辅助工具，而不是作者本人，也不要暗示平台或模型服务商对作品质量作出保证。
                如果只部分章节使用 AI，可在对应章节单独说明。
              </p>
            </section>

            <section id="platform">
              <h2>发布到平台时怎么填</h2>
              <ol>
                <li>先查看发布平台的作者规范，确认是否要求填写 AI 参与情况。</li>
                <li>有独立选项时，按实际使用范围选择“AI 辅助创作”或平台提供的相近选项。</li>
                <li>没有独立选项时，在简介或作者的话中加入一条明确、可见的文字说明。</li>
                <li>平台允许附加标签或元数据时，同时填写可读说明，不只用看不见的属性。</li>
                <li>导出后再次检查标识是否仍保留，避免只写在某个草稿备注里。</li>
              </ol>
              <p>
                NovelBrain
                不替你向小说平台发布，也无法自动修改其他平台的标识字段。不同平台规则可能变化，
                发布前应以该平台当时的要求为准。
              </p>
            </section>

            <section id="author">
              <h2>作者需要做什么</h2>
              <p>
                你需要检查 AI
                输出是否有事实错误、人物和设定冲突、与他人作品过度相似、侵犯隐私或包含违规内容。
                在发布前完成敏感内容和版权检查，并保留必要的修改记录，以便说明最终文本由你选择和编辑。
              </p>
              <p>
                涉及真实人物、商标、歌词、影视角色或其他受保护内容时，不要直接提交给模型生成或公开使用。
                对生成内容有疑问时，宁可删除或重写，也不要带着风险发布。
              </p>
            </section>

            <section id="avoid">
              <h2>不建议的做法</h2>
              <ul>
                <li>在 AI 有实质贡献时仍宣称作品完全由人工独立完成。</li>
                <li>只在隐藏备注或不可见属性中说明，导致读者和平台看不到。</li>
                <li>不要依赖不可见的自动识别或水印来代替清楚的人工标识。</li>
                <li>把 AI 生成直接当成已确认事实，或跳过发布前的版权和敏感内容检查。</li>
                <li>用“AI 生成”作为抄袭、侵权或发布违规内容的理由。</li>
              </ul>
              <p>
                关于作品权利和服务责任，请阅读 <Link href="/legal/terms">《用户协议》</Link>；
                关于正文会发送到哪里，请阅读 <Link href="/legal/privacy">《隐私政策》</Link>。
              </p>
            </section>
          </div>
        </div>
      </article>
    </LegalShell>
  );
}
