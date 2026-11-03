import { ForeshadowsPage } from './foreshadows-page';

export default async function ForeshadowsRoute({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return <ForeshadowsPage workId={workId} />;
}
