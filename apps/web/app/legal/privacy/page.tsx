import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalShell } from '../legal-shell';

export const metadata: Metadata = {
  title: '隐私政策 · NovelBrain',
  description: 'NovelBrain 如何处理账号、作品、模型服务和删除请求。',
};

export default function PrivacyPage() {
  return (
    <LegalShell>
      <article className="legal-document">
        <header className="legal-hero">
          <p className="legal-kicker">隐私与使用说明</p>
          <h1>隐私政策</h1>
          <p className="legal-intro">
            这份政策说明 NovelBrain
            会保存哪些数据、正文会发送到哪里，以及你如何导出和删除自己的作品。
            我们只处理提供创作服务所必需的信息，不用你的作品训练平台模型。
          </p>
          <p className="legal-meta">生效日期：2026 年 11 月 2 日 · 适用版本：V1</p>
        </header>

        <div className="legal-layout">
          <nav aria-label="本页目录" className="legal-toc">
            <a href="#data">我们处理的数据</a>
            <a href="#models">模型服务与正文传输</a>
            <a href="#sharing">共享与委托处理</a>
            <a href="#retention">保存期限与账号删除</a>
            <a href="#rights">你的权利</a>
            <a href="#security">安全保护</a>
          </nav>

          <div className="legal-body">
            <section id="data">
              <h2>我们处理的数据</h2>
              <h3>账号与登录信息</h3>
              <p>
                为创建和登录账号，我们处理你的邮箱、显示名称、密码摘要、登录时间、IP
                地址、浏览器信息和会话状态。密码不会以明文保存，登录会话用于保持你已登录的状态。
              </p>
              <h3>创作数据</h3>
              <p>
                我们会保存你主动输入的创作内容，包括作品资料、故事圣经、设定、大纲、章节正文、版本、
                修改记录、确认过的事实、封面或地图图片，以及你主动生成的导出文件。
              </p>
              <h3>模型配置与任务信息</h3>
              <p>
                为调用你选择的模型服务，我们保存服务名称、服务地址、模型名称、用途、连接状态和加密后的模型凭证。
                凭证保存后只显示掩码，不会以明文回传，也不会写进日志或导出包。
              </p>
              <h3>必要 Cookie</h3>
              <p>我们使用必要的会话 Cookie 让你保持登录。它不是广告 Cookie，也不用于跨站追踪。</p>
            </section>

            <section id="models">
              <h2>模型服务与正文传输</h2>
              <p>
                当你发起生成、规划、校验或改写时，完成该请求所需的设定、大纲、章节片段和指令会发送给你在模型设置中选择的模型服务。
                服务商可能位于你所在地区之外，并按照其隐私政策和服务条款处理这些数据。
              </p>
              <p>
                我们优先选择不训练、低保留的模型服务，并会在接入前核对相关条款。你可以随时更换或删除模型配置。
                <strong>
                  平台不会使用你的作品训练模型，也不会把你的作品提供给未选择的模型服务用于训练。
                </strong>
              </p>
              <p>
                模型服务的可用性、费用和数据处理规则由对应服务商决定。发送涉及个人信息、商业秘密或第三方权利的内容前，请你自行确认是否有权提供。
              </p>
            </section>

            <section id="sharing">
              <h2>共享与委托处理</h2>
              <p>
                我们不会出售你的个人信息或作品。为运行服务，仅在必要范围内向托管、数据库、对象存储、邮件和安全运维服务商委托处理数据，
                并要求其只按服务目的处理。发生合并、重组或依法必须提供时，我们会在法律允许的范围内告知你并限制使用范围。
              </p>
            </section>

            <section id="retention">
              <h2>保存期限与账号删除</h2>
              <p>
                账号和作品在你使用期间保存。删除作品或发起账号注销前，请先导出全部作品、设定、大纲、修改记录和其他需要保留的数据。
                导出包不包含模型凭证。
              </p>
              <p>
                提交账号注销后，账号进入 30
                天可恢复保留期。保留期内你可以提出恢复；期满后，账号及其作品、设定、大纲、修改记录和导出文件会从在线系统永久删除。
                为防止故障和误删，滚动备份最多再保留 30
                天，超过期限后按备份周期清除。法律法规另有保存义务的，只保留必要范围并限制访问。
              </p>
              <p>
                如需注销账号或处理无法在界面完成的数据请求，可通过注册邮箱联系平台运营方。我们会在核验账号归属后处理。
              </p>
            </section>

            <section id="rights">
              <h2>你的权利</h2>
              <p>
                你可以访问和更正账号信息、导出创作数据、删除作品、撤回对非必要处理的同意，并就隐私问题提出询问或投诉。
                删除请求不影响删除前已经完成的合法处理，也不影响依法必须保留的信息。
              </p>
              <p>
                关于 AI 内容的发布标识，请同时阅读
                <Link href="/legal/ai-content">《AI 生成内容标识说明》</Link>
                。关于服务使用规则和责任边界，请阅读
                <Link href="/legal/terms">《用户协议》</Link>。
              </p>
            </section>

            <section id="security">
              <h2>安全保护</h2>
              <p>
                我们采用账号隔离、访问控制、模型凭证加密、传输保护和限流等措施，并定期检查日志脱敏、数据隔离和备份恢复。
                互联网服务无法保证绝对安全；如发生可能影响你权益的安全事件，我们会按法律要求采取补救并通知你。
              </p>
              <p>
                本政策更新时，我们会在本页标注新的生效日期。涉及处理目的、数据类型或共享对象的重大变化，会在生效前以显著方式提示。
              </p>
            </section>
          </div>
        </div>
      </article>
    </LegalShell>
  );
}
