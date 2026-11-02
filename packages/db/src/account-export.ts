import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from './client';
import {
  accountExportJobs,
  annotations,
  auditLogs,
  branchCommits,
  branchIdMappings,
  canonCommits,
  canonSnapshots,
  changeImpactReports,
  changeRequests,
  changeValidations,
  chapterOutlines,
  chapterVersions,
  chapters,
  characterArcs,
  characterPresences,
  characterProfiles,
  characterStateRevisions,
  characterStates,
  contextPacks,
  drafts,
  entities,
  entityCustomFields,
  entityRelations,
  exportJobs,
  factProposals,
  facts,
  foreshadows,
  generationRequests,
  goldenFingers,
  itemOwnerships,
  itemTechniqueProfiles,
  jobChapters,
  jobCheckpoints,
  jobEvents,
  jobReports,
  jobSteps,
  jobs,
  mapConnections,
  mapImages,
  mapMarkers,
  mapNodes,
  modelConfigs,
  powerSystemProfiles,
  qualityReports,
  storyBibleRevisions,
  storyBibles,
  storyThreads,
  timelineEras,
  timelineEventNodes,
  users,
  workBranches,
  works,
} from './schema';

export async function loadAccountExportData(database: Database, userId: string) {
  const [account] = await database
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
      deletedAt: users.deletedAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!account) {
    return null;
  }

  const [modelRows, workRows, accountAuditRows, accountExportRows] = await Promise.all([
    database
      .select({
        id: modelConfigs.id,
        name: modelConfigs.name,
        provider: modelConfigs.provider,
        baseUrl: modelConfigs.baseUrl,
        model: modelConfigs.model,
        purpose: modelConfigs.purpose,
        isDefault: modelConfigs.isDefault,
        createdAt: modelConfigs.createdAt,
        updatedAt: modelConfigs.updatedAt,
      })
      .from(modelConfigs)
      .where(eq(modelConfigs.userId, userId)),
    database.select().from(works).where(eq(works.userId, userId)),
    database
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, userId), isNull(auditLogs.workId))),
    database.select().from(accountExportJobs).where(eq(accountExportJobs.userId, userId)),
  ]);

  const workIds = workRows.map((work) => work.id);
  const empty = Promise.resolve([]);

  const [branchRows, workAuditRows, exportRows] = await Promise.all([
    workIds.length
      ? database.select().from(workBranches).where(inArray(workBranches.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(auditLogs).where(inArray(auditLogs.workId, workIds))
      : empty,
    workIds.length
      ? database
          .select()
          .from(exportJobs)
          .where(and(eq(exportJobs.userId, userId), inArray(exportJobs.workId, workIds)))
      : empty,
  ]);
  const branchIds = branchRows.map((branch) => branch.id);

  const [
    storyBibleRows,
    storyBibleRevisionRows,
    foreshadowRows,
    threadRows,
    arcRows,
    outlineRows,
    customFieldRows,
    entityRows,
    profileRows,
    stateRows,
    stateRevisionRows,
    relationRows,
    powerRows,
    goldenFingerRows,
    itemTechniqueRows,
    ownershipRows,
    eraRows,
    timelineNodeRows,
    chapterRows,
    branchCommitRows,
    mappingRows,
    generationRows,
    proposalRows,
    factRows,
    annotationRows,
    qualityRows,
    canonCommitRows,
    canonSnapshotRows,
    jobRows,
    jobChapterRows,
    changeRows,
    mapNodeRows,
    mapConnectionRows,
    mapImageRows,
    mapMarkerRows,
    presenceRows,
  ] = await Promise.all([
    workIds.length
      ? database.select().from(storyBibles).where(inArray(storyBibles.workId, workIds))
      : empty,
    workIds.length
      ? database
          .select()
          .from(storyBibleRevisions)
          .where(inArray(storyBibleRevisions.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(foreshadows).where(inArray(foreshadows.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(storyThreads).where(inArray(storyThreads.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(characterArcs).where(inArray(characterArcs.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(chapterOutlines).where(inArray(chapterOutlines.workId, workIds))
      : empty,
    workIds.length
      ? database
          .select()
          .from(entityCustomFields)
          .where(inArray(entityCustomFields.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(entities).where(inArray(entities.workId, workIds))
      : empty,
    workIds.length
      ? database
          .select()
          .from(characterProfiles)
          .where(inArray(characterProfiles.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(characterStates).where(inArray(characterStates.workId, workIds))
      : empty,
    workIds.length
      ? database
          .select()
          .from(characterStateRevisions)
          .where(inArray(characterStateRevisions.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(entityRelations).where(inArray(entityRelations.workId, workIds))
      : empty,
    workIds.length
      ? database
          .select()
          .from(powerSystemProfiles)
          .where(inArray(powerSystemProfiles.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(goldenFingers).where(inArray(goldenFingers.workId, workIds))
      : empty,
    workIds.length
      ? database
          .select()
          .from(itemTechniqueProfiles)
          .where(inArray(itemTechniqueProfiles.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(itemOwnerships).where(inArray(itemOwnerships.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(timelineEras).where(inArray(timelineEras.workId, workIds))
      : empty,
    workIds.length
      ? database
          .select()
          .from(timelineEventNodes)
          .where(inArray(timelineEventNodes.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(chapters).where(inArray(chapters.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(branchCommits).where(inArray(branchCommits.workId, workIds))
      : empty,
    branchIds.length
      ? database
          .select()
          .from(branchIdMappings)
          .where(inArray(branchIdMappings.forkBranchId, branchIds))
      : empty,
    workIds.length
      ? database
          .select()
          .from(generationRequests)
          .where(inArray(generationRequests.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(factProposals).where(inArray(factProposals.workId, workIds))
      : empty,
    workIds.length ? database.select().from(facts).where(inArray(facts.workId, workIds)) : empty,
    workIds.length
      ? database.select().from(annotations).where(inArray(annotations.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(qualityReports).where(inArray(qualityReports.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(canonCommits).where(inArray(canonCommits.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(canonSnapshots).where(inArray(canonSnapshots.workId, workIds))
      : empty,
    workIds.length
      ? database
          .select()
          .from(jobs)
          .where(and(eq(jobs.userId, userId), inArray(jobs.workId, workIds)))
      : empty,
    workIds.length
      ? database.select().from(jobChapters).where(inArray(jobChapters.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(changeRequests).where(inArray(changeRequests.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(mapNodes).where(inArray(mapNodes.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(mapConnections).where(inArray(mapConnections.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(mapImages).where(inArray(mapImages.workId, workIds))
      : empty,
    workIds.length
      ? database.select().from(mapMarkers).where(inArray(mapMarkers.workId, workIds))
      : empty,
    workIds.length
      ? database
          .select()
          .from(characterPresences)
          .where(inArray(characterPresences.workId, workIds))
      : empty,
  ]);

  const chapterIds = chapterRows.map((chapter) => chapter.id);
  const generationIds = generationRows.map((generation) => generation.id);
  const jobIds = jobRows.map((job) => job.id);
  const changeIds = changeRows.map((change) => change.id);
  const [versionRows, contextRows, draftRows, stepRows, checkpointRows, jobEventRows, reportRows, impactRows, validationRows] =
    await Promise.all([
      chapterIds.length
        ? database
            .select()
            .from(chapterVersions)
            .where(inArray(chapterVersions.chapterId, chapterIds))
        : empty,
      generationIds.length
        ? database
            .select()
            .from(contextPacks)
            .where(inArray(contextPacks.generationRequestId, generationIds))
        : empty,
      generationIds.length
        ? database
            .select()
            .from(drafts)
            .where(inArray(drafts.generationRequestId, generationIds))
        : empty,
      jobIds.length
        ? database.select().from(jobSteps).where(inArray(jobSteps.jobId, jobIds))
        : empty,
      jobIds.length
        ? database
            .select()
            .from(jobCheckpoints)
            .where(inArray(jobCheckpoints.jobId, jobIds))
        : empty,
      jobIds.length
        ? database.select().from(jobEvents).where(inArray(jobEvents.jobId, jobIds))
        : empty,
      jobIds.length
        ? database.select().from(jobReports).where(inArray(jobReports.jobId, jobIds))
        : empty,
      changeIds.length
        ? database
            .select()
            .from(changeImpactReports)
            .where(inArray(changeImpactReports.changeRequestId, changeIds))
        : empty,
      changeIds.length
        ? database
            .select()
            .from(changeValidations)
            .where(inArray(changeValidations.changeRequestId, changeIds))
        : empty,
    ]);

  return {
    exportVersion: 2,
    exportedAt: new Date().toISOString(),
    account,
    modelConfigs: modelRows,
    works: workRows,
    branches: branchRows,
    settings: {
      storyBibles: storyBibleRows,
      storyBibleRevisions: storyBibleRevisionRows,
      foreshadows: foreshadowRows,
      threads: threadRows,
      characterArcs: arcRows,
      outlines: outlineRows,
      customFields: customFieldRows,
      entities: entityRows.filter((entity) => entity.deletedAt === null),
      deletedEntities: entityRows.filter((entity) => entity.deletedAt !== null),
      relations: relationRows,
      powerSystems: powerRows,
      goldenFingers: goldenFingerRows,
      itemTechniques: itemTechniqueRows,
      itemOwnerships: ownershipRows,
      timelineEras: eraRows,
      timelineEvents: timelineNodeRows,
    },
    characters: {
      profiles: profileRows,
      states: stateRows,
      stateRevisions: stateRevisionRows,
    },
    maps: {
      nodes: mapNodeRows,
      connections: mapConnectionRows,
      images: mapImageRows,
      markers: mapMarkerRows,
      presences: presenceRows,
    },
    text: {
      chapters: chapterRows,
      versions: versionRows,
      branchCommits: branchCommitRows,
      branchIdMappings: mappingRows,
    },
    facts: {
      proposals: proposalRows,
      confirmed: factRows,
      canonCommits: canonCommitRows,
      canonSnapshots: canonSnapshotRows,
    },
    changes: {
      requests: changeRows,
      impactReports: impactRows,
      validations: validationRows,
    },
    generation: {
      requests: generationRows,
      contextPacks: contextRows,
      drafts: draftRows,
      jobs: jobRows,
      jobSteps: stepRows,
      jobCheckpoints: checkpointRows,
      jobEvents: jobEventRows,
      jobChapters: jobChapterRows,
      jobReports: reportRows,
      annotations: annotationRows,
      qualityReports: qualityRows,
    },
    audit: {
      work: workAuditRows,
      account: accountAuditRows,
    },
    exports: {
      workExports: exportRows,
      accountExports: accountExportRows,
    },
  };
}

export type AccountExportData = NonNullable<Awaited<ReturnType<typeof loadAccountExportData>>>;
