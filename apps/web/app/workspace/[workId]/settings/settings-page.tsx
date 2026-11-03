'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { WorkShell } from '../../../_components/app-shell';
import { ApiError, apiRequest, type User } from '../../../../lib/auth-api';
import {
  loadEntityCenter,
  type CustomFieldDefinition,
  type Entity,
  type EntityType,
  type Relation,
} from '../../../../lib/entities-api';
import { loadMapOverview, type MapOverview } from '../../../../lib/maps-api';
import type { Work } from '../../../../lib/works-api';
import { MapFactionPanel } from '../map-faction-panel';
import { SettingsCenterPanel } from '../settings-center-panel';
import { ConfirmedFactsPanel } from './confirmed-facts-panel';
import { GoldenFingerOverview } from './golden-finger-overview';

type SettingsTab =
  | 'world'
  | 'character'
  | 'faction'
  | 'map'
  | 'power'
  | 'item'
  | 'golden'
  | 'timeline'
  | 'confirmed'
  | 'custom';

type SettingsState =
  | { status: 'loading' }
  | {
      status: 'ready';
      user: User;
      work: Work;
      entities: Entity[];
      customFields: CustomFieldDefinition[];
      relations: Relation[];
      mapOverview: MapOverview;
    }
  | { status: 'error'; message: string };

const SECTIONS: Array<{
  key: SettingsTab;
  label: string;
  type?: EntityType;
}> = [
  { key: 'world', label: '世界规则', type: 'world' },
  { key: 'character', label: '人物档案', type: 'character' },
  { key: 'faction', label: '势力', type: 'faction' },
  { key: 'map', label: '地图', type: 'map' },
  { key: 'power', label: '力量体系', type: 'power_system' },
  { key: 'item', label: '物品功法', type: 'item_technique' },
  { key: 'golden', label: '金手指' },
  { key: 'timeline', label: '时间线', type: 'timeline' },
  { key: 'confirmed', label: '已确认设定' },
  { key: 'custom', label: '自定义字段' },
];

export function SettingsPage({ workId }: { workId: string }) {
  const router = useRouter();
  const [state, setState] = useState<SettingsState>({ status: 'loading' });
  const [tab, setTab] = useState<SettingsTab>('world');
  const [initialEntityId, setInitialEntityId] = useState<string>();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('tab');
    const tabs: SettingsTab[] = [
      'world',
      'character',
      'faction',
      'map',
      'power',
      'item',
      'golden',
      'timeline',
      'confirmed',
      'custom',
    ];
    if (requested && tabs.includes(requested as SettingsTab)) {
      setTab(requested as SettingsTab);
    }
    setInitialEntityId(params.get('entity') ?? undefined);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest<User>('/api/v1/auth/me'),
      apiRequest<Work>(`/api/v1/works/${workId}`),
    ])
      .then(async ([user, work]) => {
        if (!work.mainBranch) {
          throw new Error('这个故事还没有可编辑的创作线。');
        }
        const [center, mapOverview] = await Promise.all([
          loadEntityCenter(work.id, work.mainBranch.id),
          loadMapOverview(work.id, work.mainBranch.id),
        ]);
        if (active) {
          setState({
            status: 'ready',
            user,
            work,
            entities: center.entities,
            customFields: center.customFields,
            relations: center.relations,
            mapOverview,
          });
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          router.replace('/login');
          return;
        }
        setState({
          status: 'error',
          message:
            error instanceof ApiError
              ? error.message
              : error instanceof Error
                ? error.message
                : '暂时无法打开设定中心。',
        });
      });
    return () => {
      active = false;
    };
  }, [router, workId]);

  if (state.status === 'loading') {
    return <main className="app-shell-loading">正在打开设定中心…</main>;
  }

  if (state.status === 'error') {
    return (
      <main className="app-shell-error">
        <section>
          <h1>暂时无法打开设定中心</h1>
          <p>{state.message}</p>
          <Link className="secondary-button" href="/workspace">
            返回作品列表
          </Link>
        </section>
      </main>
    );
  }

  const { user, work, entities, customFields, relations, mapOverview } = state;
  const activeSection = SECTIONS.find((section) => section.key === tab) ?? SECTIONS[0];

  return (
    <WorkShell active="settings" user={user} work={work} workId={work.id}>
      <main className="workspace-shell settings-page-shell">
        <section className="settings-page-hero">
          <p className="workspace-step">世界设定</p>
          <h1>设定中心</h1>
          <p>世界不是一张表，是一张网。地图、势力、人物和规则彼此关联。</p>
        </section>

        <nav aria-label="设定中心栏目" className="settings-section-tabs">
          {SECTIONS.map((section) => (
            <button
              aria-current={tab === section.key ? 'page' : undefined}
              key={section.key}
              onClick={() => setTab(section.key)}
              type="button"
            >
              {section.label}
            </button>
          ))}
        </nav>

        {tab === 'map' ? (
          <MapFactionPanel
            branchId={work.mainBranch!.id}
            entities={entities}
            initialOverview={mapOverview}
            workId={work.id}
          />
        ) : tab === 'confirmed' ? (
          <ConfirmedFactsPanel branchId={work.mainBranch!.id} workId={work.id} />
        ) : tab === 'golden' ? (
          <GoldenFingerOverview
            branchId={work.mainBranch!.id}
            entities={entities}
            workId={work.id}
          />
        ) : (
          <SettingsCenterPanel
            branchId={work.mainBranch!.id}
            fieldsInitiallyOpen={tab === 'custom'}
            genrePack={work.genrePack}
            initialCustomFields={customFields}
            initialEntityId={initialEntityId}
            initialEntities={entities}
            initialRelations={relations}
            initialType={activeSection.type}
            key={tab}
            onCustomFieldsChange={(fields) =>
              setState((current) =>
                current.status === 'ready' ? { ...current, customFields: fields } : current,
              )
            }
            title={tab === 'custom' ? '自定义字段' : '设定档案'}
            workId={work.id}
          />
        )}
      </main>
    </WorkShell>
  );
}
