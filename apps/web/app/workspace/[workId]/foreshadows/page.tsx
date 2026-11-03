import { WorkShellPage } from '../../../_components/work-shell-page';

export default async function ForeshadowsPage({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return (
    <WorkShellPage
      active="foreshadows"
      description="埋设章、计划回收章、状态、关联人物和风险检查会在这里统一记录。"
      eyebrow="长线线索"
      title="伏笔账本"
      workId={workId}
    />
  );
}
