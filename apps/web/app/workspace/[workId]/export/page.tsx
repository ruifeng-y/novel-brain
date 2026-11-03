import { WorkShellPage } from '../../../_components/work-shell-page';

export default async function ExportPage({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return (
    <WorkShellPage
      active="export"
      description="正文与设定导出、平台预设、发布检查和读者预览会在这里完成。"
      eyebrow="交付"
      title="导出与发布"
      workId={workId}
    />
  );
}
