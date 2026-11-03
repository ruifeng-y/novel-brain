import { OutlinePage } from './outline-page';

export default async function OutlineRoute({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return <OutlinePage workId={workId} />;
}
