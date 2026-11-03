import { WorkShellPage } from '../../../_components/work-shell-page';

export default async function WorkSettingsPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const { workId } = await params;
  return (
    <WorkShellPage
      active="work-settings"
      description="书名、笔名、题材、读者、规模、节奏、简介、标签和封面会在这里维护。"
      eyebrow="作品边界"
      title="作品设置"
      workId={workId}
    />
  );
}
