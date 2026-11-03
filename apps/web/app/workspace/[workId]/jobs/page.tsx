import { redirect } from 'next/navigation';

export default async function TaskCenterPage({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  redirect(`/workspace/${workId}/batch`);
}
