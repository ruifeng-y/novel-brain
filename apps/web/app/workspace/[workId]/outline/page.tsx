import { WorkShellPage } from '../../../_components/work-shell-page';

export default async function OutlinePage({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return (
    <WorkShellPage
      active="outline"
      description="全书、卷、幕、章、场景五层结构，以及看板、张力曲线和剧情账本会在这里展开。"
      eyebrow="创作骨架"
      title="大纲工作台"
      workId={workId}
    />
  );
}
