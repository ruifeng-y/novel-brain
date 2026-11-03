import { BiblePage } from './bible-page';

export default async function BibleRoute({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return <BiblePage workId={workId} />;
}
