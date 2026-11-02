'use client';

import { MAP_LEVEL_LABELS, MAP_LEVEL_ORDER } from '@novel/contracts';
import { useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { ApiError, friendlyError } from '../../../lib/auth-api';
import { createRelation, type Entity } from '../../../lib/entities-api';
import {
  createCharacterPresence,
  createMapConnection,
  createMapMarker,
  createMapNode,
  deleteCharacterPresence,
  loadMapOverview,
  uploadMapImage,
  type MapLevel,
  type MapOverview,
} from '../../../lib/maps-api';

type ActionState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string };

const MAP_LEVELS = MAP_LEVEL_ORDER.map((level) => [level, MAP_LEVEL_LABELS[level]] as const);

function mapError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'MAP_PARENT_INVALID') {
      return '上级地点必须比当前层级更广。';
    }
    if (error.code === 'MAP_PARENT_REQUIRED') {
      return '请先选择上级地点。';
    }
    if (error.code === 'MAP_WORLD_EXISTS') {
      return '这条创作线已经有一个世界层级。';
    }
    if (error.code === 'MAP_NAME_CONFLICT') {
      return '已经有一个同名地点。';
    }
    if (error.code === 'MAP_CONNECTION_EXISTS') {
      return '这两个地点已经连接过了。';
    }
    if (error.code === 'MAP_CONNECTION_INVALID') {
      return '请选择两个不同的地点。';
    }
    if (error.code === 'MAP_IMAGE_INVALID') {
      return '请选择清晰的 PNG、JPEG 或 WebP 图片。';
    }
    if (error.code === 'MAP_PRESENCE_EXISTS') {
      return '这个地点在这个时间点已经有一条记录了。';
    }
    if (error.code === 'MAP_PRESENCE_INVALID') {
      return '请选择当前作品里的人物和地点。';
    }
    if (error.code === 'MAP_MARKER_INVALID') {
      return '请选择地图图片里的地点。';
    }
  }
  return friendlyError(error);
}

function placeDepth(nodes: MapOverview['nodes'], nodeId: string): number {
  let depth = 0;
  let current = nodes.find((node) => node.id === nodeId);
  const seen = new Set<string>();
  while (current?.parentNodeId && !seen.has(current.id)) {
    seen.add(current.id);
    depth += 1;
    current = nodes.find((node) => node.id === current?.parentNodeId);
  }
  return depth;
}

function placePath(nodes: MapOverview['nodes'], nodeId: string): string {
  const parts: string[] = [];
  let current = nodes.find((node) => node.id === nodeId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parentNodeId
      ? nodes.find((node) => node.id === current?.parentNodeId)
      : undefined;
  }
  return parts.join(' / ');
}

export function MapFactionPanel({
  workId,
  branchId,
  entities,
  initialOverview,
}: {
  workId: string;
  branchId: string;
  entities: Entity[];
  initialOverview: MapOverview;
}) {
  const [map, setMap] = useState(initialOverview);
  const [selectedNodeId, setSelectedNodeId] = useState(initialOverview.nodes[0]?.id ?? '');
  const [placeState, setPlaceState] = useState<ActionState>({ status: 'idle' });
  const [connectionState, setConnectionState] = useState<ActionState>({ status: 'idle' });
  const [imageState, setImageState] = useState<ActionState>({ status: 'idle' });
  const [markerState, setMarkerState] = useState<ActionState>({ status: 'idle' });
  const [controlState, setControlState] = useState<ActionState>({ status: 'idle' });
  const [presenceState, setPresenceState] = useState<ActionState>({ status: 'idle' });
  const [placeDraft, setPlaceDraft] = useState({
    name: '',
    level: 'world' as MapLevel,
    parentNodeId: '',
    summary: '',
  });
  const [connectionDraft, setConnectionDraft] = useState({
    fromNodeId: '',
    toNodeId: '',
    travelMinutes: '30',
    label: '',
  });
  const [markerNodeId, setMarkerNodeId] = useState('');
  const [fileInputKey, setFileInputKey] = useState(0);
  const [controlDraft, setControlDraft] = useState({
    factionId: '',
    nodeId: '',
    validFrom: '',
    validTo: '',
    source: '作者录入',
  });
  const [presenceDraft, setPresenceDraft] = useState({
    characterEntityId: '',
    locationNodeId: '',
    storyTime: '',
    source: '作者录入',
  });

  const factions = entities.filter((entity) => entity.type === 'faction');
  const characters = entities.filter((entity) => entity.type === 'character');
  const selectedNode = map.nodes.find((node) => node.id === selectedNodeId);
  const selectedImage = map.images.find((image) => image.nodeId === selectedNodeId);
  const selectedLevelIndex = MAP_LEVEL_ORDER.indexOf(placeDraft.level);
  const parentOptions = map.nodes.filter(
    (node) => MAP_LEVEL_ORDER.indexOf(node.level) < selectedLevelIndex,
  );
  const roots = map.nodes.filter((node) => node.parentNodeId === null);

  async function refreshMap(): Promise<void> {
    setMap(await loadMapOverview(workId, branchId));
  }

  async function onCreatePlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPlaceState({ status: 'saving' });
    try {
      const created = await createMapNode(workId, branchId, {
        name: placeDraft.name,
        level: placeDraft.level,
        parentNodeId: placeDraft.level === 'world' ? null : placeDraft.parentNodeId,
        summary: placeDraft.summary,
      });
      await refreshMap();
      setSelectedNodeId(created.id);
      setPlaceDraft({
        name: '',
        level: 'world',
        parentNodeId: '',
        summary: '',
      });
      setPlaceState({ status: 'saved', message: '地点已添加' });
    } catch (error) {
      setPlaceState({ status: 'error', message: mapError(error) });
    }
  }

  async function onCreateConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const travelMinutes = Number(connectionDraft.travelMinutes);
    if (!connectionDraft.fromNodeId || !connectionDraft.toNodeId || !travelMinutes) {
      return;
    }
    setConnectionState({ status: 'saving' });
    try {
      await createMapConnection(workId, branchId, {
        fromNodeId: connectionDraft.fromNodeId,
        toNodeId: connectionDraft.toNodeId,
        travelMinutes,
        label: connectionDraft.label,
      });
      await refreshMap();
      setConnectionDraft((current) => ({
        ...current,
        toNodeId: '',
        label: '',
      }));
      setConnectionState({ status: 'saved', message: '连接已添加' });
    } catch (error) {
      setConnectionState({ status: 'error', message: mapError(error) });
    }
  }

  async function onUploadImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file || !selectedNodeId) {
      return;
    }
    setImageState({ status: 'saving' });
    try {
      await uploadMapImage(workId, branchId, selectedNodeId, file);
      await refreshMap();
      setFileInputKey((current) => current + 1);
      setImageState({ status: 'saved', message: '地图图片已保存' });
    } catch (error) {
      setImageState({ status: 'error', message: mapError(error) });
    }
  }

  async function onMapClick(event: ReactMouseEvent<HTMLDivElement>) {
    const nodeId = markerNodeId || map.nodes[0]?.id;
    if (!selectedImage || !nodeId) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const xPercent = Math.round(((event.clientX - bounds.left) / bounds.width) * 1_000) / 10;
    const yPercent = Math.round(((event.clientY - bounds.top) / bounds.height) * 1_000) / 10;
    setMarkerState({ status: 'saving' });
    try {
      await createMapMarker(workId, branchId, selectedImage.id, {
        nodeId,
        xPercent: Math.max(0, Math.min(100, xPercent)),
        yPercent: Math.max(0, Math.min(100, yPercent)),
      });
      await refreshMap();
      setMarkerState({ status: 'saved', message: '标记点已添加' });
    } catch (error) {
      setMarkerState({ status: 'error', message: mapError(error) });
    }
  }

  async function onCreateControl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const node = map.nodes.find((candidate) => candidate.id === controlDraft.nodeId);
    if (!controlDraft.factionId || !node) {
      return;
    }
    setControlState({ status: 'saving' });
    try {
      await createRelation(workId, branchId, {
        fromEntityId: controlDraft.factionId,
        predicate: 'controls',
        toEntityId: node.entityId,
        validFrom: controlDraft.validFrom.trim() || null,
        validTo: controlDraft.validTo.trim() || null,
        source: controlDraft.source.trim() || '作者录入',
      });
      await refreshMap();
      setControlDraft((current) => ({
        ...current,
        validFrom: '',
        validTo: '',
      }));
      setControlState({ status: 'saved', message: '控制范围已添加' });
    } catch (error) {
      setControlState({ status: 'error', message: mapError(error) });
    }
  }

  async function onCreatePresence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPresenceState({ status: 'saving' });
    try {
      await createCharacterPresence(workId, branchId, {
        characterEntityId: presenceDraft.characterEntityId,
        locationNodeId: presenceDraft.locationNodeId,
        storyTime: presenceDraft.storyTime,
        source: presenceDraft.source.trim() || '作者录入',
      });
      await refreshMap();
      setPresenceDraft((current) => ({
        ...current,
        storyTime: '',
      }));
      setPresenceState({ status: 'saved', message: '所在地已记录' });
    } catch (error) {
      setPresenceState({ status: 'error', message: mapError(error) });
    }
  }

  async function onDeletePresence(presenceId: string) {
    setPresenceState({ status: 'saving' });
    try {
      await deleteCharacterPresence(workId, branchId, presenceId);
      await refreshMap();
      setPresenceState({ status: 'saved', message: '所在地记录已删除' });
    } catch (error) {
      setPresenceState({ status: 'error', message: mapError(error) });
    }
  }

  function renderTree(parentNodeId: string | null) {
    return map.nodes
      .filter((node) => node.parentNodeId === parentNodeId)
      .map((node) => (
        <li key={node.id}>
          <button
            aria-current={selectedNodeId === node.id ? 'page' : undefined}
            onClick={() => setSelectedNodeId(node.id)}
            style={{ paddingLeft: `${10 + placeDepth(map.nodes, node.id) * 14}px` }}
            type="button"
          >
            <span>{node.name}</span>
            <small>{node.levelLabel}</small>
          </button>
          {map.nodes.some((candidate) => candidate.parentNodeId === node.id) ? (
            <ul>{renderTree(node.id)}</ul>
          ) : null}
        </li>
      ));
  }

  return (
    <section className="map-faction-board" aria-labelledby="map-faction-title">
      <div className="map-faction-heading">
        <div>
          <p className="workspace-step">地点层级与势力范围</p>
          <h2 id="map-faction-title">地图与势力</h2>
          <p>从世界向下拆分地点，记录路上的时间、控制范围、地图标记和人物所在地。</p>
        </div>
        <div className="map-faction-summary" aria-label="地图概况">
          <strong>{map.nodes.length}</strong>
          <span>个地点 · {map.connections.length} 条连接</span>
        </div>
      </div>

      <div className="map-faction-layout">
        <aside className="map-place-browser" aria-label="地点树">
          <div className="map-section-heading">
            <div>
              <h3>地点层级</h3>
              <p>世界、界面、大陆、区域、城市、地点可以逐层展开。</p>
            </div>
            <span>{map.nodes.length}</span>
          </div>

          {roots.length === 0 ? (
            <p className="map-empty">还没有地点。先建立世界，再向下添加。</p>
          ) : (
            <ul className="map-place-tree">{renderTree(null)}</ul>
          )}

          <form className="map-place-form" onSubmit={onCreatePlace}>
            <label className="field">
              <span>地点名称</span>
              <input
                aria-label="地点名称"
                maxLength={200}
                onChange={(event) => {
                  const name = event.currentTarget.value;
                  setPlaceDraft((current) => ({ ...current, name }));
                }}
                placeholder="例如：断碑古寺"
                required
                value={placeDraft.name}
              />
            </label>
            <div className="map-form-row">
              <label className="field">
                <span>层级</span>
                <select
                  aria-label="地点层级"
                  onChange={(event) => {
                    const level = event.currentTarget.value as MapLevel;
                    setPlaceDraft((current) => ({
                      ...current,
                      level,
                      parentNodeId: level === 'world' ? '' : current.parentNodeId,
                    }));
                  }}
                  value={placeDraft.level}
                >
                  {MAP_LEVELS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>上级地点</span>
                <select
                  aria-label="上级地点"
                  disabled={placeDraft.level === 'world'}
                  onChange={(event) => {
                    const parentNodeId = event.currentTarget.value;
                    setPlaceDraft((current) => ({
                      ...current,
                      parentNodeId,
                    }));
                  }}
                  required={placeDraft.level !== 'world'}
                  value={placeDraft.parentNodeId}
                >
                  <option value="">
                    {placeDraft.level === 'world' ? '世界没有上级' : '选择上级地点'}
                  </option>
                  {parentOptions.map((node) => (
                    <option key={node.id} value={node.id}>
                      {placePath(map.nodes, node.id)} · {node.levelLabel}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>一句话说明</span>
              <input
                aria-label="地点说明"
                maxLength={2_000}
                onChange={(event) => {
                  const summary = event.currentTarget.value;
                  setPlaceDraft((current) => ({ ...current, summary }));
                }}
                placeholder="这个地点在故事里承担什么作用"
                value={placeDraft.summary}
              />
            </label>
            <button
              className="secondary-button"
              disabled={placeState.status === 'saving'}
              type="submit"
            >
              {placeState.status === 'saving' ? '正在添加…' : '添加地点'}
            </button>
            <ActionMessage state={placeState} />
          </form>
        </aside>

        <div className="map-canvas-column">
          <div className="map-section-heading">
            <div>
              <h3>{selectedNode ? selectedNode.name : '地图图片'}</h3>
              <p>
                {selectedNode
                  ? `${selectedNode.levelLabel} · ${placePath(map.nodes, selectedNode.id)}`
                  : '从左侧选择一个地点。'}
              </p>
            </div>
            {selectedImage ? (
              <span>
                {selectedImage.width} × {selectedImage.height}
              </span>
            ) : null}
          </div>

          <div className="map-image-controls">
            <label className="field">
              <span>上传地图图片</span>
              <input
                accept="image/png,image/jpeg,image/webp"
                aria-label="上传地图图片"
                disabled={!selectedNodeId || imageState.status === 'saving'}
                key={fileInputKey}
                onChange={(event) => void onUploadImage(event)}
                type="file"
              />
            </label>
            <label className="field">
              <span>要标记的地点</span>
              <select
                aria-label="要标记的地点"
                onChange={(event) => setMarkerNodeId(event.currentTarget.value)}
                value={markerNodeId || map.nodes[0]?.id || ''}
              >
                {map.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {placePath(map.nodes, node.id)} · {node.levelLabel}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ActionMessage state={imageState} />

          {selectedImage ? (
            <div
              aria-label={`${selectedImage.placeName}地图标记区`}
              className="map-image-stage"
              onClick={(event) => void onMapClick(event)}
              role="presentation"
              style={{ aspectRatio: `${selectedImage.width} / ${selectedImage.height}` }}
            >
              <img alt={`${selectedImage.placeName}地图`} src={selectedImage.contentUrl} />
              {selectedImage.markers.map((marker) => (
                <button
                  aria-label={`${marker.node.name}标记点`}
                  className="map-marker"
                  key={marker.id}
                  onClick={(event) => event.stopPropagation()}
                  style={{
                    left: `${marker.xPercent}%`,
                    top: `${marker.yPercent}%`,
                  }}
                  title={`${marker.node.name} · ${marker.node.levelLabel}`}
                  type="button"
                >
                  {marker.node.name.slice(0, 1)}
                </button>
              ))}
            </div>
          ) : (
            <div className="map-image-empty">
              <p>这个地点还没有地图图片。上传后可在地图上点选标记地点。</p>
            </div>
          )}
          {selectedImage ? (
            <p className="map-hint">选择标记地点后，在图片上点一下即可添加或移动标记。</p>
          ) : null}
          <ActionMessage state={markerState} />

          <div className="map-connection-section">
            <div className="map-section-heading">
              <div>
                <h3>路程与旅行时间</h3>
                <p>连接两个地点，并记下作者会在正文里用到的时间。</p>
              </div>
              <span>{map.connections.length}</span>
            </div>
            {map.connections.length === 0 ? (
              <p className="map-empty">还没有地点连接。</p>
            ) : (
              <ul className="map-connection-list">
                {map.connections.map((connection) => (
                  <li key={connection.id}>
                    <strong>
                      {connection.fromNode.name} 至 {connection.toNode.name}
                    </strong>
                    <span>{connection.travelMinutes} 分钟</span>
                    {connection.label ? <small>{connection.label}</small> : null}
                  </li>
                ))}
              </ul>
            )}
            <form className="map-connection-form" onSubmit={onCreateConnection}>
              <div className="map-form-row">
                <label className="field">
                  <span>起点</span>
                  <select
                    aria-label="连接起点"
                    onChange={(event) => {
                      const fromNodeId = event.currentTarget.value;
                      setConnectionDraft((current) => ({
                        ...current,
                        fromNodeId,
                      }));
                    }}
                    required
                    value={connectionDraft.fromNodeId}
                  >
                    <option value="">选择起点</option>
                    {map.nodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {placePath(map.nodes, node.id)} · {node.levelLabel}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>终点</span>
                  <select
                    aria-label="连接终点"
                    onChange={(event) => {
                      const toNodeId = event.currentTarget.value;
                      setConnectionDraft((current) => ({
                        ...current,
                        toNodeId,
                      }));
                    }}
                    required
                    value={connectionDraft.toNodeId}
                  >
                    <option value="">选择终点</option>
                    {map.nodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {placePath(map.nodes, node.id)} · {node.levelLabel}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="map-form-row">
                <label className="field">
                  <span>旅行时间（分钟）</span>
                  <input
                    aria-label="旅行时间"
                    min={1}
                    onChange={(event) => {
                      const travelMinutes = event.currentTarget.value;
                      setConnectionDraft((current) => ({
                        ...current,
                        travelMinutes,
                      }));
                    }}
                    required
                    type="number"
                    value={connectionDraft.travelMinutes}
                  />
                </label>
                <label className="field">
                  <span>路线说明</span>
                  <input
                    aria-label="路线说明"
                    onChange={(event) => {
                      const label = event.currentTarget.value;
                      setConnectionDraft((current) => ({
                        ...current,
                        label,
                      }));
                    }}
                    placeholder="例如：沿河官道"
                    value={connectionDraft.label}
                  />
                </label>
              </div>
              <button
                className="secondary-button"
                disabled={connectionState.status === 'saving'}
                type="submit"
              >
                {connectionState.status === 'saving' ? '正在添加…' : '添加连接'}
              </button>
              <ActionMessage state={connectionState} />
            </form>
          </div>
        </div>

        <aside className="map-context-column">
          <section aria-labelledby="map-control-title">
            <div className="map-section-heading">
              <div>
                <h3 id="map-control-title">势力控制范围</h3>
                <p>控制关系带时间窗口，领地变化可以追溯。</p>
              </div>
              <span>{map.factionControls.length}</span>
            </div>
            {map.factionControls.length === 0 ? (
              <p className="map-empty">还没有势力控制地点。</p>
            ) : (
              <ul className="map-control-list">
                {map.factionControls.map((control) => (
                  <li key={control.id}>
                    <strong>
                      {control.faction.name} 控制 {control.place.name}
                    </strong>
                    <span>
                      {control.validFrom || '起点未定'} 至 {control.validTo || '至今'}
                    </span>
                    <small>{control.source}</small>
                  </li>
                ))}
              </ul>
            )}
            {factions.length === 0 ? (
              <p className="map-empty">先在设定中心建立一个势力，再回来添加控制范围。</p>
            ) : (
              <form className="map-control-form" onSubmit={onCreateControl}>
                <label className="field">
                  <span>势力</span>
                  <select
                    aria-label="控制势力"
                    onChange={(event) => {
                      const factionId = event.currentTarget.value;
                      setControlDraft((current) => ({
                        ...current,
                        factionId,
                      }));
                    }}
                    required
                    value={controlDraft.factionId}
                  >
                    <option value="">选择势力</option>
                    {factions.map((faction) => (
                      <option key={faction.id} value={faction.id}>
                        {faction.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>地点</span>
                  <select
                    aria-label="控制地点"
                    onChange={(event) => {
                      const nodeId = event.currentTarget.value;
                      setControlDraft((current) => ({
                        ...current,
                        nodeId,
                      }));
                    }}
                    required
                    value={controlDraft.nodeId}
                  >
                    <option value="">选择地点</option>
                    {map.nodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {placePath(map.nodes, node.id)} · {node.levelLabel}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="map-form-row">
                  <label className="field">
                    <span>有效起点</span>
                    <input
                      aria-label="控制起点"
                      onChange={(event) => {
                        const validFrom = event.currentTarget.value;
                        setControlDraft((current) => ({
                          ...current,
                          validFrom,
                        }));
                      }}
                      placeholder="例如：玄元三年"
                      value={controlDraft.validFrom}
                    />
                  </label>
                  <label className="field">
                    <span>有效结束</span>
                    <input
                      aria-label="控制终点"
                      onChange={(event) => {
                        const validTo = event.currentTarget.value;
                        setControlDraft((current) => ({
                          ...current,
                          validTo,
                        }));
                      }}
                      placeholder="留空表示至今"
                      value={controlDraft.validTo}
                    />
                  </label>
                </div>
                <button
                  className="secondary-button"
                  disabled={controlState.status === 'saving'}
                  type="submit"
                >
                  {controlState.status === 'saving' ? '正在添加…' : '添加控制范围'}
                </button>
                <ActionMessage state={controlState} />
              </form>
            )}
          </section>

          <section aria-labelledby="map-presence-title">
            <div className="map-section-heading">
              <div>
                <h3 id="map-presence-title">人物行踪</h3>
                <p>按故事时间记录人物位置，系统会找出同一时刻出现在两地的情况。</p>
              </div>
              <span>{map.presences.length}</span>
            </div>
            <div className="map-conflict-list" aria-label="位置冲突">
              {map.conflicts.length === 0 ? (
                <p className="map-conflict-empty">目前没有人物同时出现在两地的记录。</p>
              ) : (
                <ul>
                  {map.conflicts.map((conflict) => (
                    <li key={`${conflict.character.id}-${conflict.storyTime}`}>
                      <strong>同时出现在两地</strong>
                      <p>
                        {conflict.character.name} 在 {conflict.storyTime} 同时出现在{' '}
                        {conflict.locations.map((location) => location.name).join('、')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {map.presences.length === 0 ? (
              <p className="map-empty">还没有人物所在地记录。</p>
            ) : (
              <ul className="map-presence-list">
                {map.presences.map((presence) => (
                  <li key={presence.id}>
                    <div>
                      <strong>
                        {presence.character.name} · {presence.location.name}
                      </strong>
                      <span>{presence.storyTime}</span>
                      <small>{presence.source}</small>
                    </div>
                    <button
                      aria-label={`删除 ${presence.character.name} 在 ${presence.location.name} 的记录`}
                      className="text-button"
                      disabled={presenceState.status === 'saving'}
                      onClick={() => void onDeletePresence(presence.id)}
                      type="button"
                    >
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {characters.length === 0 ? (
              <p className="map-empty">先在设定中心建立人物，再记录所在地。</p>
            ) : (
              <form className="map-presence-form" onSubmit={onCreatePresence}>
                <label className="field">
                  <span>人物</span>
                  <select
                    aria-label="行踪人物"
                    onChange={(event) => {
                      const characterEntityId = event.currentTarget.value;
                      setPresenceDraft((current) => ({
                        ...current,
                        characterEntityId,
                      }));
                    }}
                    required
                    value={presenceDraft.characterEntityId}
                  >
                    <option value="">选择人物</option>
                    {characters.map((character) => (
                      <option key={character.id} value={character.id}>
                        {character.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>地点</span>
                  <select
                    aria-label="行踪地点"
                    onChange={(event) => {
                      const locationNodeId = event.currentTarget.value;
                      setPresenceDraft((current) => ({
                        ...current,
                        locationNodeId,
                      }));
                    }}
                    required
                    value={presenceDraft.locationNodeId}
                  >
                    <option value="">选择地点</option>
                    {map.nodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {placePath(map.nodes, node.id)} · {node.levelLabel}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>故事时间</span>
                  <input
                    aria-label="行踪故事时间"
                    onChange={(event) => {
                      const storyTime = event.currentTarget.value;
                      setPresenceDraft((current) => ({
                        ...current,
                        storyTime,
                      }));
                    }}
                    placeholder="例如：第三章清晨"
                    required
                    value={presenceDraft.storyTime}
                  />
                </label>
                <button
                  className="secondary-button"
                  disabled={presenceState.status === 'saving'}
                  type="submit"
                >
                  {presenceState.status === 'saving' ? '正在记录…' : '记录所在地'}
                </button>
                <ActionMessage state={presenceState} />
              </form>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}

function ActionMessage({ state }: { state: ActionState }) {
  if (state.status === 'error') {
    return (
      <p className="form-message form-message-error" role="alert">
        {state.message}
      </p>
    );
  }
  if (state.status === 'saved') {
    return (
      <p className="form-message form-message-success" role="status">
        {state.message}
      </p>
    );
  }
  return null;
}
