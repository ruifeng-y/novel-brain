import { WorkShellPage } from '../../../_components/work-shell-page';

export default async function BiblePage({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return (
    <WorkShellPage
      active="bible"
      description="九张故事圣经卡、完成度、健康提醒和修改记录会在这里汇总。"
      eyebrow="创作骨架"
      title="故事圣经"
      workId={workId}
    />
  );
}
