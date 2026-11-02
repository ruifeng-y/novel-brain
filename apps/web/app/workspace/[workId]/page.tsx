import type { Metadata } from 'next';
import { WorkspaceWork } from './workspace-work';

export const metadata: Metadata = {
  title: '作品 · NovelBrain',
};

export default async function WorkPage({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return <WorkspaceWork workId={workId} />;
}
