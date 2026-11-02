import { and, asc, eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Database } from './client';
import {
  branchCommits,
  canonCommits,
  canonSnapshots,
  chapterOutlines,
  chapterVersions,
  chapters,
  characterArcs,
  characterPresences,
  characterProfiles,
  characterStateRevisions,
  characterStates,
  entities,
  entityRelations,
  factProposals,
  facts,
  foreshadows,
  goldenFingers,
  itemOwnerships,
  itemTechniqueProfiles,
  mapConnections,
  mapImages,
  mapMarkers,
  mapNodes,
  powerSystemProfiles,
  storyBibles,
  storyThreads,
  timelineEras,
  timelineEventNodes,
  workBranches,
  works,
  type BranchCommitRow,
  type ChapterOutlineRow,
} from './schema';

export type OutlineExportSource = {
  work: { id: string; title: string };
  branch: { id: string; name: string };
  outlines: ChapterOutlineRow[];
};

export type BranchSnapshotExportSource = {
  work: { id: string; title: string };
  branch: { id: string; name: string };
  outlines: ChapterOutlineRow[];
  chapters: Array<{
    chapterNumber: number;
    title: string;
    content: string;
    volumeTitle: string;
  }>;
  data: Record<string, unknown>;
};

export async function loadWorkBranchIdentity(
  database: Database,
  workId: string,
  branchId: string,
): Promise<{ work: { id: string; title: string }; branch: { id: string; name: string } } | null> {
  const [row] = await database
    .select({
      workId: works.id,
      workTitle: works.title,
      branchId: workBranches.id,
      branchName: workBranches.name,
    })
    .from(works)
    .innerJoin(workBranches, eq(workBranches.workId, works.id))
    .where(and(eq(works.id, workId), eq(workBranches.id, branchId)))
    .limit(1);
  if (!row) {
    return null;
  }
  return {
    work: { id: row.workId, title: row.workTitle },
    branch: { id: row.branchId, name: row.branchName },
  };
}

export async function loadBranchOutlineExportSource(
  database: Database,
  workId: string,
  branchId: string,
): Promise<OutlineExportSource | null> {
  const identity = await loadWorkBranchIdentity(database, workId, branchId);
  if (!identity) {
    return null;
  }
  const outlines = await loadOutlineRows(database, workId, branchId);
  return {
    ...identity,
    outlines,
  };
}

export async function findHistoricalVersionCommit(
  database: Database,
  workId: string,
  branchId: string,
  versionCommitId: string,
): Promise<BranchCommitRow | null> {
  const [commit] = await database
    .select()
    .from(branchCommits)
    .where(
      and(
        eq(branchCommits.id, versionCommitId),
        eq(branchCommits.workId, workId),
        eq(branchCommits.sourceBranchId, branchId),
      ),
    )
    .limit(1);
  return commit ?? null;
}

export async function loadHistoricalVersionList(
  database: Database,
  workId: string,
  branchId: string,
): Promise<BranchCommitRow[]> {
  return database
    .select()
    .from(branchCommits)
    .where(and(eq(branchCommits.workId, workId), eq(branchCommits.sourceBranchId, branchId)))
    .orderBy(asc(branchCommits.createdAt), asc(branchCommits.id));
}

export async function loadBranchSnapshotExportSource(
  database: Database,
  workId: string,
  snapshotBranchId: string,
): Promise<BranchSnapshotExportSource | null> {
  const identity = await loadWorkBranchIdentity(database, workId, snapshotBranchId);
  if (!identity) {
    return null;
  }

  const [
    outlines,
    chapterRows,
    storyBibleRows,
    entityRows,
    relationRows,
    profileRows,
    stateRows,
    stateRevisionRows,
    powerRows,
    goldenFingerRows,
    itemRows,
    ownershipRows,
    eraRows,
    timelineRows,
    threadRows,
    foreshadowRows,
    arcRows,
    mapNodeRows,
    mapConnectionRows,
    mapImageRows,
    mapMarkerRows,
    presenceRows,
    proposalRows,
    factRows,
    canonCommitRows,
    canonSnapshotRows,
    versionRows,
  ] = await Promise.all([
    loadOutlineRows(database, workId, snapshotBranchId),
    database
      .select({
        chapterNumber: chapters.chapterNumber,
        title: chapters.title,
        autosaveContent: chapters.autosaveContent,
        versionContent: chapterVersions.content,
      })
      .from(chapters)
      .leftJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
      .where(and(eq(chapters.workId, workId), eq(chapters.branchId, snapshotBranchId)))
      .orderBy(asc(chapters.chapterNumber)),
    loadBranchRows(database, storyBibles, workId, snapshotBranchId),
    loadBranchRows(database, entities, workId, snapshotBranchId),
    loadBranchRows(database, entityRelations, workId, snapshotBranchId),
    loadBranchRows(database, characterProfiles, workId, snapshotBranchId),
    loadBranchRows(database, characterStates, workId, snapshotBranchId),
    loadBranchRows(database, characterStateRevisions, workId, snapshotBranchId),
    loadBranchRows(database, powerSystemProfiles, workId, snapshotBranchId),
    loadBranchRows(database, goldenFingers, workId, snapshotBranchId),
    loadBranchRows(database, itemTechniqueProfiles, workId, snapshotBranchId),
    loadBranchRows(database, itemOwnerships, workId, snapshotBranchId),
    loadBranchRows(database, timelineEras, workId, snapshotBranchId),
    loadBranchRows(database, timelineEventNodes, workId, snapshotBranchId),
    loadBranchRows(database, storyThreads, workId, snapshotBranchId),
    loadBranchRows(database, foreshadows, workId, snapshotBranchId),
    loadBranchRows(database, characterArcs, workId, snapshotBranchId),
    loadBranchRows(database, mapNodes, workId, snapshotBranchId),
    loadBranchRows(database, mapConnections, workId, snapshotBranchId),
    loadBranchRows(database, mapImages, workId, snapshotBranchId),
    loadBranchRows(database, mapMarkers, workId, snapshotBranchId),
    loadBranchRows(database, characterPresences, workId, snapshotBranchId),
    loadBranchRows(database, factProposals, workId, snapshotBranchId),
    loadBranchRows(database, facts, workId, snapshotBranchId),
    loadBranchRows(database, canonCommits, workId, snapshotBranchId),
    loadBranchRows(database, canonSnapshots, workId, snapshotBranchId),
    database
      .select({
        id: chapterVersions.id,
        chapterId: chapterVersions.chapterId,
        version: chapterVersions.version,
        content: chapterVersions.content,
        contentHash: chapterVersions.contentHash,
        wordCount: chapterVersions.wordCount,
        modelConfigId: chapterVersions.modelConfigId,
        createdBy: chapterVersions.createdBy,
        source: chapterVersions.source,
        createdAt: chapterVersions.createdAt,
      })
      .from(chapterVersions)
      .innerJoin(chapters, eq(chapters.id, chapterVersions.chapterId))
      .where(and(eq(chapters.workId, workId), eq(chapters.branchId, snapshotBranchId)))
      .orderBy(asc(chapters.chapterNumber), asc(chapterVersions.version)),
  ]);

  const outlineById = new Map(outlines.map((outline) => [outline.id, outline]));
  const chapterOutlineByNumber = new Map<number, ChapterOutlineRow>(
    outlines
      .filter(
        (outline): outline is ChapterOutlineRow & { chapterNumber: number } =>
          outline.level === 'chapter' && outline.chapterNumber !== null,
      )
      .map((outline) => [outline.chapterNumber, outline]),
  );
  const volumeTitleFor = (chapterNumber: number): string => {
    let outline = chapterOutlineByNumber.get(chapterNumber);
    const seen = new Set<string>();
    while (outline?.parentId && !seen.has(outline.parentId)) {
      seen.add(outline.parentId);
      outline = outlineById.get(outline.parentId);
      if (outline?.level === 'volume') {
        return outline.title;
      }
    }
    return '';
  };

  return {
    ...identity,
    outlines,
    chapters: chapterRows.map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      content: chapter.versionContent ?? chapter.autosaveContent,
      volumeTitle: volumeTitleFor(chapter.chapterNumber),
    })),
    data: {
      'story-bible': storyBibleRows,
      entities: entityRows,
      relations: relationRows,
      characters: {
        profiles: profileRows,
        states: stateRows,
        stateRevisions: stateRevisionRows,
      },
      'power-items': {
        powerSystems: powerRows,
        goldenFingers: goldenFingerRows,
        items: itemRows,
        ownerships: ownershipRows,
      },
      timeline: { eras: eraRows, events: timelineRows },
      'story-ledger': {
        threads: threadRows,
        foreshadows: foreshadowRows,
        characterArcs: arcRows,
      },
      maps: {
        nodes: mapNodeRows,
        connections: mapConnectionRows,
        images: mapImageRows,
        markers: mapMarkerRows,
        presences: presenceRows,
      },
      facts: {
        proposals: proposalRows,
        confirmed: factRows,
        canonCommits: canonCommitRows,
        canonSnapshots: canonSnapshotRows,
      },
      'chapter-versions': versionRows,
    },
  };
}

function loadOutlineRows(database: Database, workId: string, branchId: string) {
  return database
    .select()
    .from(chapterOutlines)
    .where(and(eq(chapterOutlines.workId, workId), eq(chapterOutlines.branchId, branchId)))
    .orderBy(asc(chapterOutlines.orderIndex), asc(chapterOutlines.createdAt));
}

function loadBranchRows<T extends PgTable & { workId: PgColumn; branchId: PgColumn }>(
  database: Database,
  table: T,
  workId: string,
  branchId: string,
) {
  return database
    .select()
    .from(table as PgTable)
    .where(and(eq(table.workId, workId), eq(table.branchId, branchId))) as Promise<
    Array<Record<string, unknown>>
  >;
}
