'use client';

import Link from 'next/link';
import { WorkShell } from '../../../_components/app-shell';

const states = [
  {
    key: 'normal',
    kicker: '正常',
    title: '数据已加载',
    detail: '页面可编辑、可导航，所有主操作都有明确结果。',
    exit: '回到作品总览',
    href: 'overview',
  },
  {
    key: 'empty',
    kicker: '空状态',
    title: '还没有内容',
    detail: '从一句话想法或空白作品开始，先建一个故事蓝图。',
    exit: '新建作品',
    href: '/workspace/new-project',
  },
  {
    key: 'loading',
    kicker: '加载',
    title: '正在整理内容',
    detail: '列表使用骨架屏，局部操作使用行内进度，不会锁死页面。',
    exit: '刷新页面',
    href: 'states',
  },
  {
    key: 'error',
    kicker: '错误',
    title: '模型连接失败',
    detail: '检查 Base URL、模型名和 Key 后重试，或先换一套配置。',
    exit: '打开模型设置',
    href: '/workspace/settings',
  },
  {
    key: 'locked',
    kicker: '锁定',
    title: '故事圣经已锁定',
    detail: '锁定后的修改会触发影响分析，并要求填写原因和保留回滚点。',
    exit: '去故事圣经',
    href: 'bible',
  },
  {
    key: 'readonly',
    kicker: '只读',
    title: '已完本，默认只读',
    detail: '要接着写，可以恢复连载，或从平行版本继续。',
    exit: '打开作品设置',
    href: 'work-settings',
  },
  {
    key: 'conflict',
    kicker: '冲突',
    title: '左臂骨折，但正文出现双手结印',
    detail: '连续性检查会指出冲突章节，可以选择修改、拉平行版本或记录忽略原因。',
    exit: '去写作台处理',
    href: 'write',
  },
];

export function StatesPage({ workId }: { workId: string }) {
  return (
    <WorkShell active="overview" workId={workId}>
      <section className="state-demo-page">
        <header className="state-demo-header">
          <div>
            <p className="workspace-step">全局状态</p>
            <h1>七类状态都有明确出口</h1>
            <p>正常、空、加载、错误、锁定、只读和冲突不是死路，每一种都给出下一步。</p>
          </div>
          <Link className="secondary-button" href={`/workspace/${workId}/overview`}>
            返回作品总览
          </Link>
        </header>
        <div className="state-demo-grid">
          {states.map((state) => (
            <article className={`state-demo-card state-${state.key}`} key={state.key}>
              <span>{state.kicker}</span>
              <h2>{state.title}</h2>
              <p>{state.detail}</p>
              <Link
                className="text-button"
                href={
                  state.href.startsWith('/')
                    ? state.href
                    : `/workspace/${workId}/${state.href === 'states' ? 'states' : state.href}`
                }
              >
                {state.exit}
              </Link>
            </article>
          ))}
        </div>
      </section>
    </WorkShell>
  );
}
