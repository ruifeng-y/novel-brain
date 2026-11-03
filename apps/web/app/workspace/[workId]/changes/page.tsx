import { ChangesPage } from './changes-page';

export default async function ChangesRoute({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return <ChangesPage workId={workId} />;
}
