import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  chapters,
  createDatabaseClient,
  createDatabasePool,
  entities,
  factProposals,
  modelConfigs,
  outlineNodes,
  sceneCards,
  settingChangeRequests,
  settingProposals,
  storyBibleChangeRequests,
  storyBibles,
  storyBibleVersions,
  storyBibleWorldRules,
  volumeContracts,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import { chapterBriefSchema, type GenerationReadinessQuery } from "@novel-brain/contracts";
import type {
  GenerationReadinessInput,
  GenerationReadinessPendingProposal,
  GenerationReadinessPendingRisk,
} from "@novel-brain/core";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Pool } from "pg";

import { storyBibleReadiness } from "../story-bible/story-bible.service";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface ReadinessSnapshot {
  input: GenerationReadinessInput;
}

const DEFAULT_BUDGET = {
  maxCostCny: 2.5,
  maxTokens: 30_000,
  maxRevisionRounds: 2,
} as const;

@Injectable()
export class ReadinessRepository implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly db: DatabaseClient;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
    this.db = createDatabaseClient(this.pool);
  }

  async load(
    userId: string,
    workId: string,
    branchId: string,
    query: GenerationReadinessQuery,
  ): Promise<ReadinessSnapshot | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [context] = await transaction
        .select({
          workId: works.id,
          chapterLengthTarget: works.chapterLengthTarget,
          branchId: workBranches.id,
          branchHeadNodeId: workBranches.headNodeId,
        })
        .from(works)
        .innerJoin(
          workBranches,
          and(eq(workBranches.workId, works.id), eq(workBranches.userId, works.userId)),
        )
        .where(
          and(
            eq(works.id, workId),
            eq(works.userId, userId),
            eq(workBranches.id, branchId),
            sql`${works.deletedAt} is null`,
          ),
        )
        .limit(1);
      if (!context) {
        return undefined;
      }
      if (!context.branchHeadNodeId) {
        return undefined;
      }
      if (query.chapterId) {
        const [chapter] = await transaction
          .select({ id: chapters.id })
          .from(chapters)
          .where(
            and(
              eq(chapters.id, query.chapterId),
              eq(chapters.userId, userId),
              eq(chapters.workId, workId),
              eq(chapters.branchId, branchId),
            ),
          )
          .limit(1);
        if (!chapter) {
          return undefined;
        }
      }

      const [storyBible] = await transaction
        .select()
        .from(storyBibles)
        .where(
          and(
            eq(storyBibles.userId, userId),
            eq(storyBibles.workId, workId),
            eq(storyBibles.branchId, branchId),
          ),
        )
        .limit(1);
      const [storyBibleVersion] = storyBible
        ? await transaction
            .select({ id: storyBibleVersions.id })
            .from(storyBibleVersions)
            .where(
              and(
                eq(storyBibleVersions.storyBibleId, storyBible.id),
                eq(storyBibleVersions.userId, userId),
                eq(storyBibleVersions.version, storyBible.version),
              ),
            )
            .limit(1)
        : [undefined];
      const worldRules = storyBibleVersion
        ? await transaction
            .select({ id: storyBibleWorldRules.id })
            .from(storyBibleWorldRules)
            .where(
              and(
                eq(storyBibleWorldRules.storyBibleVersionId, storyBibleVersion.id),
                eq(storyBibleWorldRules.userId, userId),
              ),
            )
            .orderBy(asc(storyBibleWorldRules.name))
        : [];
      const settings = await transaction
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.userId, userId),
            eq(entities.workId, workId),
            eq(entities.branchId, branchId),
            isNull(entities.deletedAt),
          ),
        )
        .orderBy(asc(entities.type), asc(entities.name));
      const pendingProposalRecords = await transaction
        .select()
        .from(settingProposals)
        .where(
          and(
            eq(settingProposals.userId, userId),
            eq(settingProposals.workId, workId),
            eq(settingProposals.branchId, branchId),
            eq(settingProposals.status, "pending"),
          ),
        )
        .orderBy(asc(settingProposals.createdAt));
      const settingById = new Map(settings.map((setting) => [setting.id, setting]));
      const pendingSettingProposals: GenerationReadinessPendingProposal[] =
        pendingProposalRecords.map((proposal) => ({
          id: proposal.id,
          entityId: proposal.entityId,
          entityType: settingById.get(proposal.entityId)?.type ?? "world_rule",
          conflictType: proposal.conflictType,
          status: proposal.status,
        }));

      const pendingStoryBibleChanges = storyBible
        ? await transaction
            .select()
            .from(storyBibleChangeRequests)
            .where(
              and(
                eq(storyBibleChangeRequests.userId, userId),
                eq(storyBibleChangeRequests.workId, workId),
                eq(storyBibleChangeRequests.branchId, branchId),
                eq(storyBibleChangeRequests.storyBibleId, storyBible.id),
                inArray(storyBibleChangeRequests.status, ["pending", "analyzing"]),
                eq(storyBibleChangeRequests.risk, "high"),
              ),
            )
            .orderBy(asc(storyBibleChangeRequests.createdAt))
        : [];
      const pendingSettingChanges = await transaction
        .select()
        .from(settingChangeRequests)
        .where(
          and(
            eq(settingChangeRequests.userId, userId),
            eq(settingChangeRequests.workId, workId),
            eq(settingChangeRequests.branchId, branchId),
            eq(settingChangeRequests.status, "pending"),
          ),
        )
        .orderBy(asc(settingChangeRequests.createdAt));
      const pendingFactRisks = query.chapterId
        ? await transaction
            .select()
            .from(factProposals)
            .where(
              and(
                eq(factProposals.userId, userId),
                eq(factProposals.workId, workId),
                eq(factProposals.branchId, branchId),
                eq(factProposals.chapterId, query.chapterId),
                eq(factProposals.status, "proposed"),
                eq(factProposals.risk, "high"),
              ),
            )
            .orderBy(asc(factProposals.createdAt))
        : [];
      const pendingRiskApprovals: GenerationReadinessPendingRisk[] = [
        ...pendingStoryBibleChanges.map((request) => ({
          id: request.id,
          kind: "story_bible_change_request" as const,
          label: request.title,
          resourceId: request.id,
          entityId: null,
          entityType: null,
        })),
        ...pendingSettingChanges.map((request) => ({
          id: request.id,
          kind: "setting_change_request" as const,
          label: request.title,
          resourceId: request.id,
          entityId: request.entityId,
          entityType: settingById.get(request.entityId)?.type ?? null,
        })),
        ...pendingFactRisks.map((proposal) => ({
          id: proposal.id,
          kind: "fact_proposal" as const,
          label: `${proposal.subject} · ${proposal.predicate}`,
          resourceId: proposal.id,
          entityId: null,
          entityType: null,
        })),
      ];

      const outlineRecords = await transaction
        .select({ node: outlineNodes, chapter: chapters })
        .from(outlineNodes)
        .leftJoin(chapters, eq(chapters.id, outlineNodes.chapterId))
        .where(
          and(
            eq(outlineNodes.userId, userId),
            eq(outlineNodes.workId, workId),
            eq(outlineNodes.branchId, branchId),
          ),
        )
        .orderBy(asc(outlineNodes.createdAt));
      const contractRecords = await transaction
        .select({ nodeId: volumeContracts.nodeId })
        .from(volumeContracts)
        .where(
          and(
            eq(volumeContracts.userId, userId),
            eq(volumeContracts.workId, workId),
            eq(volumeContracts.branchId, branchId),
          ),
        );
      const cardRecords = await transaction
        .select()
        .from(sceneCards)
        .where(
          and(
            eq(sceneCards.userId, userId),
            eq(sceneCards.workId, workId),
            eq(sceneCards.branchId, branchId),
          ),
        );

      const chapter = query.chapterId
        ? await transaction
            .select()
            .from(chapters)
            .where(
              and(
                eq(chapters.id, query.chapterId),
                eq(chapters.userId, userId),
                eq(chapters.workId, workId),
                eq(chapters.branchId, branchId),
              ),
            )
            .limit(1)
        : [];
      const currentChapter = chapter[0] ?? null;
      const readyChapterBrief =
        currentChapter !== null
          ? completeChapterBrief(currentChapter.brief) !== null
          : Boolean(
              (
                await transaction
                  .select({ id: chapters.id })
                  .from(chapters)
                  .where(
                    and(
                      eq(chapters.userId, userId),
                      eq(chapters.workId, workId),
                      eq(chapters.branchId, branchId),
                      sql`coalesce(${chapters.brief}->>'goal', '') <> ''`,
                      sql`coalesce(${chapters.brief}->>'pov', '') <> ''`,
                      sql`coalesce(${chapters.brief}->>'location', '') <> ''`,
                      sql`jsonb_typeof(${chapters.brief}->'sceneBeats') = 'array'`,
                      sql`jsonb_array_length(${chapters.brief}->'sceneBeats') > 0`,
                      sql`jsonb_typeof(${chapters.brief}->'requiredFacts') = 'array'`,
                      sql`jsonb_array_length(${chapters.brief}->'requiredFacts') > 0`,
                    ),
                  )
                  .limit(1)
              )[0],
            );

      const configs = query.modelConfigId
        ? await transaction
            .select()
            .from(modelConfigs)
            .where(
              and(
                eq(modelConfigs.id, query.modelConfigId),
                eq(modelConfigs.userId, userId),
                isNull(modelConfigs.deletedAt),
              ),
            )
            .limit(1)
        : await transaction
            .select()
            .from(modelConfigs)
            .where(
              and(
                eq(modelConfigs.userId, userId),
                isNull(modelConfigs.deletedAt),
                sql`${modelConfigs.purposes} @> '["writing"]'::jsonb`,
              ),
            )
            .orderBy(desc(modelConfigs.isDefault), desc(modelConfigs.updatedAt))
            .limit(1);
      const modelConfig = configs[0] ?? null;
      const budgetProvided =
        query.maxCostCny !== undefined ||
        query.maxTokens !== undefined ||
        query.maxRevisionRounds !== undefined;
      const budget = {
        maxCostCny: query.maxCostCny ?? DEFAULT_BUDGET.maxCostCny,
        maxTokens: query.maxTokens ?? DEFAULT_BUDGET.maxTokens,
        maxRevisionRounds: query.maxRevisionRounds ?? DEFAULT_BUDGET.maxRevisionRounds,
      };

      const brief = currentChapter ? completeChapterBrief(currentChapter.brief) : null;
      const storyBibleInput = storyBible
        ? {
            id: storyBible.id,
            version: storyBible.version,
            status: storyBible.status,
            readiness: storyBibleReadiness(
              storyBible.cards as Parameters<typeof storyBibleReadiness>[0],
              storyBible.status as Parameters<typeof storyBibleReadiness>[1],
            ),
            worldRuleIds: worldRules.map((rule) => rule.id),
          }
        : null;
      return {
        input: {
          workId,
          branchId,
          branchHeadNodeId: context.branchHeadNodeId,
          chapterId: query.chapterId ?? null,
          chapterLengthTarget: context.chapterLengthTarget,
          storyBible: storyBibleInput,
          settings: settings.map((setting) => ({
            id: setting.id,
            type: setting.type,
            name: setting.name,
            aliases: setting.aliases,
            status: setting.status,
            version: setting.version,
          })),
          pendingSettingProposals,
          pendingRiskApprovals,
          outline: {
            nodes: outlineRecords.map(({ node }) => ({
              id: node.id,
              workId: node.workId,
              branchId: node.branchId,
              level: node.level as "book" | "volume" | "act" | "chapter" | "scene",
              parentId: node.parentId,
              sortOrder: node.sortOrder,
              locked: node.locked,
              chapterId: node.chapterId,
            })),
            volumeContractNodeIds: contractRecords.map((contract) => contract.nodeId),
            chapterBriefReadyIds: outlineRecords
              .filter(
                ({ node, chapter: linkedChapter }) =>
                  node.level === "chapter" &&
                  linkedChapter !== null &&
                  completeChapterBrief(linkedChapter.brief) !== null,
              )
              .map(({ node }) => node.id),
            sceneCards: cardRecords.map((card) => ({
              nodeId: card.nodeId,
              povReady: Boolean(card.povId),
              locationReady: Boolean(card.locationId),
              storyTimeReady: Boolean(card.storyTimeLabel),
              beatCount: card.beats.length,
              informationReleaseCount: card.informationReleases.length,
            })),
          },
          chapter: currentChapter
            ? {
                id: currentChapter.id,
                version: currentChapter.version,
                status: currentChapter.status,
                brief,
              }
            : null,
          hasReadyChapterBrief: readyChapterBrief,
          unresolvedHighRiskFactIds: pendingFactRisks.map((proposal) => proposal.id),
          config: {
            modelConfig: modelConfig
              ? {
                  id: modelConfig.id,
                  version: modelConfig.version,
                  label: modelConfig.label,
                  model: modelConfig.model,
                  purposes: modelConfig.purposes,
                  lastTestStatus: modelConfig.lastTestStatus,
                }
              : null,
            budget,
            budgetSource: budgetProvided ? "request" : "default",
          },
        },
      };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async withTenant<T>(
    userId: string,
    operation: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return operation(transaction);
    });
  }
}

function completeChapterBrief(value: Record<string, unknown>) {
  const parsed = chapterBriefSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const brief = parsed.data;
  if (
    !brief.goal.trim() ||
    !brief.pov.trim() ||
    !brief.location.trim() ||
    brief.sceneBeats.length === 0 ||
    brief.requiredFacts.length === 0
  ) {
    return null;
  }
  return brief;
}
