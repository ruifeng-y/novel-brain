import { BatchPage } from './batch-page';

export default async function BatchRoute({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return <BatchPage workId={workId} />;
}
