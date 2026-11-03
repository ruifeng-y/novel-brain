import { WorkShellPage } from '../../../_components/work-shell-page';

export default async function OverviewPage({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return (
    <WorkShellPage
      active="overview"
      description="作品状态、准备度、最近章节和待处理提醒会在这里汇总。"
      eyebrow="作品"
      title="作品总览"
      workId={workId}
    />
  );
}
