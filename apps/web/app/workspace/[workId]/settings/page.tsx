import { WorkShellPage } from '../../../_components/work-shell-page';

export default async function SettingsCenterPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const { workId } = await params;
  return (
    <WorkShellPage
      active="settings"
      description="世界规则、人物、势力、地图、力量体系和已确认设定会在这里统一管理。"
      eyebrow="世界设定"
      title="设定中心"
      workId={workId}
    />
  );
}
