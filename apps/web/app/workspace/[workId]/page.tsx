import { redirect } from 'next/navigation';

export default async function WorkPage({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  redirect(`/workspace/${workId}/overview`);
}
