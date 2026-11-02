import type { Metadata } from 'next';
import { TaskCenter } from './task-center';

export const metadata: Metadata = {
  title: '批量创作 · NovelBrain',
};

export default async function TaskCenterPage({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return <TaskCenter workId={workId} />;
}
