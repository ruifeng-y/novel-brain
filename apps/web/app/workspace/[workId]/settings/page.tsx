import { SettingsPage } from './settings-page';

export default async function SettingsCenterRoute({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const { workId } = await params;
  return <SettingsPage workId={workId} />;
}
