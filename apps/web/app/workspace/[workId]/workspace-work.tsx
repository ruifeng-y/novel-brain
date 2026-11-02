'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, apiRequest, friendlyError, type User } from '../../../lib/auth-api';
import {
  loadEntityCenter,
  type CustomFieldDefinition,
  type Entity,
  type Relation,
} from '../../../lib/entities-api';
import { loadMapOverview, type MapOverview } from '../../../lib/maps-api';
import {
  loadOutlineNodes,
  loadOutlineReadiness,
  loadStoryBibleInsights,
  loadStoryBible,
  type OutlineNode,
  type OutlineReadiness,
  type StoryBible,
  type StoryBibleInsights,
} from '../../../lib/story-planning-api';
import { loadStoryLedger, type StoryLedger } from '../../../lib/story-ledger-api';
import { GENRE_LABELS, SCALE_LABELS, formatWorkDate, type Work } from '../../../lib/works-api';
import { SettingsCenterPanel } from './settings-center-panel';
import { HistoryRulePanel } from './history-rule-panel';
import { MapFactionPanel } from './map-faction-panel';
import { OutlineWorkspacePanel } from './outline-workspace-panel';
import { StoryPlanningPanel } from './story-planning-panel';
import { StoryLedgerPanel } from './story-ledger-panel';

type LoadState =
  | { status: 'loading' }
  | {
      status: 'ready';
      user: User;
      work: Work;
      storyBible: StoryBible | null;
      outlineNodes: OutlineNode[];
      outlineReadiness: OutlineReadiness | null;
      storyBibleInsights: StoryBibleInsights | null;
      storyLedger: StoryLedger | null;
      entities: Entity[];
      customFields: CustomFieldDefinition[];
      relations: Relation[];
      mapOverview: MapOverview;
    }
  | { status: 'error'; message: string; notFound: boolean };

export function WorkspaceWork({ workId }: { workId: string }) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    Promise.all([apiRequest<User>('/api/v1/auth/me'), apiRequest<Work>(`/api/v1/works/${workId}`)])
      .then(async ([user, work]) => {
        if (!work.mainBranch) {
          setState({
            status: 'ready',
            user,
            work,
            storyBible: null,
            outlineNodes: [],
            outlineReadiness: null,
            storyBibleInsights: null,
            storyLedger: null,
            entities: [],
            customFields: [],
            relations: [],
            mapOverview: {
              nodes: [],
              connections: [],
              factionControls: [],
              images: [],
              presences: [],
              conflicts: [],
            },
          });
          return;
        }

        const [
          storyBible,
          outlineResponse,
          outlineReadiness,
          storyBibleInsights,
          storyLedger,
          entityCenter,
          mapOverview,
        ] = await Promise.all([
          loadStoryBible(work.id, work.mainBranch.id),
          loadOutlineNodes(work.id, work.mainBranch.id),
          loadOutlineReadiness(work.id, work.mainBranch.id),
          loadStoryBibleInsights(work.id, work.mainBranch.id),
          loadStoryLedger(work.id, work.mainBranch.id),
          loadEntityCenter(work.id, work.mainBranch.id),
          loadMapOverview(work.id, work.mainBranch.id),
        ]);
        setState({
          status: 'ready',
          user,
          work,
          storyBible,
          outlineNodes: outlineResponse.items,
          outlineReadiness,
          storyBibleInsights,
          storyLedger,
          entities: entityCenter.entities,
          customFields: entityCenter.customFields,
          relations: entityCenter.relations,
          mapOverview,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          router.replace('/login');
          return;
        }
        setState({
          status: 'error',
          message: friendlyError(error),
          notFound: error instanceof ApiError && error.code === 'WORK_NOT_FOUND',
        });
      });
  }, [router, workId]);

  if (state.status === 'loading') {
    return (
      <main className="workspace-shell">
        <p className="workspace-loading">正在打开作品…</p>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="workspace-shell">
        <section className="workspace-error">
          <h1>{state.notFound ? '没有找到这部作品' : '暂时无法打开作品'}</h1>
          <p>{state.message}</p>
          <Link className="secondary-button back-button" href="/workspace">
            返回作品列表
          </Link>
        </section>
      </main>
    );
  }

  const { work } = state;

  return (
    <main className="workspace-shell work-detail-shell">
      <header className="workspace-header">
        <Link className="workspace-brand" href="/workspace">
          NovelBrain
        </Link>
        <div className="workspace-account">
          <span>{state.user.displayName}</span>
          <Link className="text-button" href={`/workspace/${work.id}/write`}>
            写作台
          </Link>
          <Link className="text-button" href="/workspace/settings">
            模型设置
          </Link>
          <Link className="text-button" href="/workspace">
            返回作品列表
          </Link>
        </div>
      </header>

      <nav className="work-breadcrumb" aria-label="作品导航">
        <Link href="/workspace">作品</Link>
        <span>/</span>
        <span>{work.title}</span>
      </nav>

      <section className="work-detail-hero">
        <div>
          <p className="workspace-step">
            {GENRE_LABELS[work.genrePack] ?? work.genrePack}
            {work.genreVariantLabel ? ` · ${work.genreVariantLabel}` : ''}
          </p>
          <h1>{work.title}</h1>
          <p>
            {work.penName} · {SCALE_LABELS[work.scale] ?? work.scale} · {work.targetPlatform}
          </p>
        </div>
        <span className={`work-status work-status-${work.status}`}>{work.statusLabel}</span>
      </section>

      <section className="work-stat-strip" aria-label="作品数据">
        <div>
          <span>创作进度</span>
          <strong>{work.progressPercent}%</strong>
        </div>
        <div>
          <span>累计字数</span>
          <strong>{work.wordCount.toLocaleString('zh-CN')}</strong>
        </div>
        <div>
          <span>最近编辑</span>
          <strong>{formatWorkDate(work.lastEditedAt)}</strong>
        </div>
      </section>

      <section className="planning-board" aria-labelledby="planning-board-title">
        <div className="planning-board-heading">
          <div>
            <p className="workspace-step">创作骨架</p>
            <h2 id="planning-board-title">先把故事站稳</h2>
          </div>
          <p>故事圣经定方向，完整大纲定节奏。保存后随时回来接着写。</p>
        </div>

        {state.storyBible && state.storyBibleInsights && work.mainBranch ? (
          <StoryPlanningPanel
            branchId={work.mainBranch.id}
            initialInsights={state.storyBibleInsights}
            storyBible={state.storyBible}
            workId={work.id}
          />
        ) : (
          <p className="planning-unavailable">这个故事暂时还没有可编辑的创作线。</p>
        )}
      </section>

      {state.storyLedger && work.mainBranch ? (
        <StoryLedgerPanel
          branchId={work.mainBranch.id}
          initialLedger={state.storyLedger}
          workId={work.id}
        />
      ) : null}

      {state.outlineReadiness && work.mainBranch ? (
        <OutlineWorkspacePanel
          branchId={work.mainBranch.id}
          initialNodes={state.outlineNodes}
          initialReadiness={state.outlineReadiness}
          workId={work.id}
        />
      ) : null}

      {work.mainBranch ? (
        <SettingsCenterPanel
          branchId={work.mainBranch.id}
          genrePack={work.genrePack}
          initialCustomFields={state.customFields}
          initialEntities={state.entities}
          initialRelations={state.relations}
          workId={work.id}
        />
      ) : null}

      {work.mainBranch ? (
        <MapFactionPanel
          branchId={work.mainBranch.id}
          entities={state.entities}
          initialOverview={state.mapOverview}
          workId={work.id}
        />
      ) : null}

      {work.mainBranch && work.genrePack === 'history' ? (
        <HistoryRulePanel
          branchId={work.mainBranch.id}
          entities={state.entities}
          mapOverview={state.mapOverview}
          workId={work.id}
        />
      ) : null}

      <div className="work-detail-grid">
        <section className="work-detail-section">
          <p className="workspace-step">作品信息</p>
          <h2>这本书的起点</h2>
          <dl className="work-facts">
            <div>
              <dt>笔名</dt>
              <dd>{work.penName}</dd>
            </div>
            <div>
              <dt>题材</dt>
              <dd>
                {GENRE_LABELS[work.genrePack] ?? work.genrePack}
                {work.genreVariantLabel ? ` · ${work.genreVariantLabel}` : ''}
              </dd>
            </div>
            <div>
              <dt>规模</dt>
              <dd>{SCALE_LABELS[work.scale] ?? work.scale}</dd>
            </div>
            <div>
              <dt>目标平台</dt>
              <dd>{work.targetPlatform}</dd>
            </div>
          </dl>
        </section>

        <section className="work-readiness">
          <p className="workspace-step">当前状态</p>
          <h2>主创作线已就绪</h2>
          <p>作品已经建立。故事圣经和完整大纲准备好后，就可以继续准备正文。</p>
          <Link className="secondary-button back-button" href={`/workspace/${work.id}/write`}>
            进入写作台
          </Link>
        </section>
      </div>
    </main>
  );
}
