import { ExportPage } from './export-page';

export default async function ExportRoute({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return <ExportPage workId={workId} />;
}
