import { WorkSettingsPage } from './work-settings-page';

export default async function WorkSettingsRoute({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const { workId } = await params;
  return <WorkSettingsPage workId={workId} />;
}
