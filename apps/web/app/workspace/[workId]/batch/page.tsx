import { WorkShellPage } from '../../../_components/work-shell-page';

export default async function BatchPage({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return (
    <WorkShellPage
      active="batch"
      description="按章、按卷、自定义区间和全本的批量任务，以及审核队列和任务报告会在这里管理。"
      eyebrow="生产"
      title="批量生产"
      workId={workId}
    />
  );
}
