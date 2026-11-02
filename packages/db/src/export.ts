import { and, asc, eq } from 'drizzle-orm';
import type { Database } from './client';
import { chapterOutlines, chapterVersions, chapters, workBranches, works } from './schema';

export type ExportSource = {
  work: {
    id: string;
    title: string;
  };
  branch: {
    id: string;
    name: string;
  };
  outlines: Array<{
    id: string;
    parentId: string | null;
    level: 'book' | 'volume' | 'act' | 'chapter' | 'scene';
    chapterNumber: number | null;
    title: string;
  }>;
  chapters: Array<{
    chapterNumber: number;
    title: string;
    content: string;
  }>;
};

export async function loadExportSource(
  database: Database,
  workId: string,
  branchId: string,
): Promise<ExportSource | null> {
  const [work] = await database
    .select({
      id: works.id,
      title: works.title,
    })
    .from(works)
    .where(eq(works.id, workId))
    .limit(1);
  if (!work) {
    return null;
  }
  const [branch] = await database
    .select({ id: workBranches.id, name: workBranches.name })
    .from(workBranches)
    .where(and(eq(workBranches.id, branchId), eq(workBranches.workId, workId)))
    .limit(1);
  if (!branch) {
    return null;
  }

  const [outlineRows, chapterRows] = await Promise.all([
    database
      .select({
        id: chapterOutlines.id,
        parentId: chapterOutlines.parentId,
        level: chapterOutlines.level,
        chapterNumber: chapterOutlines.chapterNumber,
        title: chapterOutlines.title,
      })
      .from(chapterOutlines)
      .where(and(eq(chapterOutlines.workId, workId), eq(chapterOutlines.branchId, branchId)))
      .orderBy(asc(chapterOutlines.orderIndex), asc(chapterOutlines.createdAt)),
    database
      .select({
        chapterNumber: chapters.chapterNumber,
        title: chapters.title,
        autosaveContent: chapters.autosaveContent,
        versionContent: chapterVersions.content,
      })
      .from(chapters)
      .leftJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
      .where(and(eq(chapters.workId, workId), eq(chapters.branchId, branchId)))
      .orderBy(asc(chapters.chapterNumber)),
  ]);

  return {
    work,
    branch,
    outlines: outlineRows,
    chapters: chapterRows.map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      content: chapter.versionContent ?? chapter.autosaveContent,
    })),
  };
}
