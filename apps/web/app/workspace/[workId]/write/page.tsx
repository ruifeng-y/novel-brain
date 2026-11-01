import type { Metadata } from 'next';
import { WritingDesk } from './writing-desk';

export const metadata: Metadata = {
  title: '写作台 · NovelBrain',
};

export default async function WritingDeskPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const { workId } = await params;
  return <WritingDesk workId={workId} />;
}
