import type { Metadata } from 'next';
import { WritingDesk } from './writing-desk';

export const metadata: Metadata = {
  title: '写作台 · NovelBrain',
};

export default async function WritingDeskPage({
  params,
  searchParams,
}: {
  params: Promise<{ workId: string }>;
  searchParams: Promise<{ chapter?: string }>;
}) {
  const { workId } = await params;
  const { chapter } = await searchParams;
  const chapterNumber = chapter ? Number.parseInt(chapter, 10) : undefined;
  return (
    <WritingDesk
      initialChapterNumber={
        Number.isFinite(chapterNumber) && chapterNumber && chapterNumber > 0
          ? chapterNumber
          : undefined
      }
      workId={workId}
    />
  );
}
