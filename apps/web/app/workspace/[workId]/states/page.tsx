import type { Metadata } from 'next';
import { StatesPage } from './states-page';

export const metadata: Metadata = {
  title: '状态演示 · NovelBrain',
};

export default async function StatesRoute({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return <StatesPage workId={workId} />;
}
