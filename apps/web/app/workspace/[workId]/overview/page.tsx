import { WorkOverview } from './work-overview';

export default async function OverviewPage({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return <WorkOverview workId={workId} />;
}
