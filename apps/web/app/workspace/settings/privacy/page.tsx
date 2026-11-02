import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '隐私与合规 · NovelBrain',
};

const dataItems = [
  {
    label: '账号',
    detail: '邮箱、显示名称、密码摘要和登录所需的安全信息。',
  },
  {
    label: '创作内容',
    detail: '作品资料、故事圣经、设定、大纲、章节、版本、修改记录和导出文件。',
  },
  {
    label: '模型连接',
    detail: '服务名称、地址、模型名称和用途。模型凭证加密保存，之后只显示掩码。',
  },
  {
    label: '运行信息',
    detail: '生成任务状态、错误提示和会话信息。正文和模型凭证不会写进日志。',
  },
];

export default function PrivacySettingsPage() {
  return (
    <main className="workspace-shell settings-shell">
      <header className="workspace-header">
        <Link className="workspace-brand" href="/workspace">
          NovelBrain
        </Link>
        <nav className="workspace-nav" aria-label="账号导航">
          <Link href="/workspace">作品书架</Link>
          <Link href="/workspace/settings">模型设置</Link>
          <Link aria-current="page" href="/workspace/settings/privacy">
            隐私与合规
          </Link>
        </nav>
      </header>

      <section className="settings-hero">
        <div>
          <p className="workspace-step">账号设置</p>
          <h1>隐私与合规</h1>
        </div>
        <p>看清哪些数据会被保存、正文会发送到哪里，以及导出和删除前需要做什么。</p>
      </section>

      <div className="privacy-center-layout">
        <div className="privacy-center-main">
          <section className="privacy-center-section" id="data">
            <div className="privacy-center-heading">
              <div>
                <p className="workspace-step">数据说明</p>
                <h2>你的数据</h2>
              </div>
              <span>只处理创作所需的范围</span>
            </div>
            <dl className="privacy-data-list">
              {dataItems.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.detail}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="privacy-center-section" id="models">
            <div className="privacy-center-heading">
              <div>
                <p className="workspace-step">正文去向</p>
                <h2>模型服务</h2>
              </div>
            </div>
            <p>
              生成、规划和校验时，完成请求所需的设定、大纲、正文片段和指令会发送给你选择的模型服务。
              你可以随时更换或删除模型配置。
            </p>
            <p className="privacy-emphasis">
              平台不会使用你的作品训练模型，也不会把作品提供给未选择的模型服务用于训练。
            </p>
            <Link className="privacy-inline-link" href="/workspace/settings">
              管理模型设置
            </Link>
          </section>

          <section className="privacy-center-section" id="deletion">
            <div className="privacy-center-heading">
              <div>
                <p className="workspace-step">离开之前</p>
                <h2>导出、恢复与删除</h2>
              </div>
              <span>先导出，再注销</span>
            </div>
            <ol className="privacy-steps">
              <li>
                <strong>先导出</strong>
                <span>下载全部作品、设定、大纲和修改记录。导出包不包含模型凭证。</span>
              </li>
              <li>
                <strong>再发起注销</strong>
                <span>账号进入 30 天可恢复期。期间可以提出恢复，期满后在线数据永久删除。</span>
              </li>
              <li>
                <strong>等待备份到期</strong>
                <span>滚动备份最多再保留 30 天，超过期限后按备份周期清除。</span>
              </li>
            </ol>
            <p>
              当前如需注销或恢复账号，可通过注册邮箱联系平台运营方。第三方模型服务中的历史记录需要按对应服务的规则另行处理。
            </p>
          </section>

          <section className="privacy-center-section" id="ai">
            <div className="privacy-center-heading">
              <div>
                <p className="workspace-step">发布之前</p>
                <h2>AI 创作标识</h2>
              </div>
            </div>
            <p>
              AI 对公开内容有实质贡献时，请按发布平台和适用法律的要求说明。可以直接使用“本文使用 AI
              辅助生成，经作者编辑、校对并承担内容责任。”这样的可见文字，不要只写在隐藏备注里。
            </p>
            <Link className="privacy-inline-link" href="/legal/ai-content">
              查看 AI 标识说明
            </Link>
          </section>
        </div>

        <aside className="privacy-legal-links" aria-labelledby="privacy-legal-title">
          <p className="workspace-step">法律文件</p>
          <h2 id="privacy-legal-title">完整说明</h2>
          <Link href="/legal/privacy">查看隐私政策</Link>
          <Link href="/legal/terms">查看用户协议</Link>
          <Link href="/legal/ai-content">查看 AI 标识说明</Link>
          <p>这些页面说明作者权利、第三方模型服务和账号删除规则。</p>
        </aside>
      </div>
    </main>
  );
}
