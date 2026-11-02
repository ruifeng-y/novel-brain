'use client';

import { useRef, useState, type FormEvent } from 'react';
import { ApiError, friendlyError } from '../../../lib/auth-api';
import {
  createOutlineNode,
  deleteOutlineNode,
  loadOutlineReadiness,
  lockOutlineNode,
  regenerateOutlineNode,
  reorderOutlineNodes,
  unlockOutlineNode,
  updateOutlineNode,
  type OutlineLevel,
  type OutlineNode,
  type OutlineNodeUpdate,
  type OutlineReadiness,
} from '../../../lib/story-planning-api';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string };

type EditorMode =
  | { kind: 'create'; level: OutlineLevel; parentId: string | null }
  | { kind: 'edit'; nodeId: string };

type OutlineDraft = {
  title: string;
  summary: string;
  details: string;
  parentId: string;
  chapterGoal: string;
  pov: string;
  sceneBeats: string;
  chapterEndHook: string;
};

type PendingLockedAction =
  | { kind: 'save'; node: OutlineNode; input: OutlineNodeUpdate }
  | { kind: 'regenerate'; node: OutlineNode; instruction: string }
  | { kind: 'delete'; node: OutlineNode }
  | {
      kind: 'reorder';
      node: OutlineNode;
      parentId: string | null;
      orderedIds: string[];
    };

const LEVEL_LABELS: Record<OutlineLevel, string> = {
  book: '全书',
  volume: '卷',
  act: '幕',
  chapter: '章',
  scene: '场景',
};

const CHILD_LEVEL: Partial<Record<OutlineLevel, OutlineLevel>> = {
  book: 'volume',
  volume: 'act',
  act: 'chapter',
  chapter: 'scene',
};

const PARENT_LEVEL: Partial<Record<OutlineLevel, OutlineLevel>> = {
  volume: 'book',
  act: 'volume',
  chapter: 'act',
  scene: 'chapter',
};

function blankDraft(): OutlineDraft {
  return {
    title: '',
    summary: '',
    details: '',
    parentId: '',
    chapterGoal: '',
    pov: '',
    sceneBeats: '',
    chapterEndHook: '',
  };
}

function draftForNode(node: OutlineNode): OutlineDraft {
  return {
    title: node.title,
    summary: node.summary,
    details: node.details,
    parentId: node.parentId ?? '',
    chapterGoal: node.chapterGoal,
    pov: node.pov,
    sceneBeats: node.sceneBeats.join('\n'),
    chapterEndHook: node.chapterEndHook,
  };
}

function childrenOf(nodes: OutlineNode[], parentId: string | null): OutlineNode[] {
  return nodes
    .filter((node) => node.parentId === parentId)
    .sort((left, right) => left.orderIndex - right.orderIndex);
}

function outlineInput(draft: OutlineDraft, level: OutlineLevel, parentId: string | null) {
  const sceneBeats = draft.sceneBeats
    .split(/\r?\n/)
    .map((beat) => beat.trim())
    .filter(Boolean);
  return {
    level,
    parentId,
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    details: draft.details.trim(),
    chapterGoal: draft.chapterGoal.trim(),
    pov: draft.pov.trim(),
    sceneBeats,
    chapterEndHook: draft.chapterEndHook.trim(),
  };
}

export function OutlineWorkspacePanel({
  workId,
  branchId,
  initialNodes,
  initialReadiness,
}: {
  workId: string;
  branchId: string;
  initialNodes: OutlineNode[];
  initialReadiness: OutlineReadiness;
}) {
  const [nodes, setNodes] = useState(initialNodes);
  const [readiness, setReadiness] = useState(initialReadiness);
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [draft, setDraft] = useState<OutlineDraft>(blankDraft);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [pendingLocked, setPendingLocked] = useState<PendingLockedAction | null>(null);
  const [changeReason, setChangeReason] = useState('');
  const [regeneration, setRegeneration] = useState<{ nodeId: string; instruction: string } | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<OutlineNode | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);
  const draggedNodeRef = useRef<string | null>(null);

  const book = childrenOf(nodes, null).find((node) => node.level === 'book') ?? null;
  const editorNode =
    editor?.kind === 'edit' ? (nodes.find((node) => node.id === editor.nodeId) ?? null) : null;
  const editorLevel = editor?.kind === 'create' ? editor.level : (editorNode?.level ?? 'book');
  const editorParentLevel = PARENT_LEVEL[editorLevel];
  const editorParentOptions = editorParentLevel
    ? nodes
        .filter((node) => node.level === editorParentLevel)
        .sort((left, right) => left.orderIndex - right.orderIndex)
    : [];

  function applyNode(saved: OutlineNode) {
    setNodes((current) => {
      const exists = current.some((node) => node.id === saved.id);
      return exists
        ? current.map((node) => (node.id === saved.id ? saved : node))
        : [...current, saved];
    });
  }

  function removeNode(outlineId: string) {
    const descendants = new Set<string>([outlineId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes) {
        if (node.parentId && descendants.has(node.parentId) && !descendants.has(node.id)) {
          descendants.add(node.id);
          changed = true;
        }
      }
    }
    setNodes((current) => current.filter((node) => !descendants.has(node.id)));
    if (editor?.kind === 'edit' && descendants.has(editor.nodeId)) {
      setEditor(null);
      setDraft(blankDraft());
    }
  }

  async function refreshReadiness() {
    setReadinessLoading(true);
    try {
      setReadiness(await loadOutlineReadiness(workId, branchId));
    } catch (error) {
      setSaveState({ status: 'error', message: friendlyError(error) });
    } finally {
      setReadinessLoading(false);
    }
  }

  function openCreate(level: OutlineLevel, parentId: string | null) {
    setEditor({ kind: 'create', level, parentId });
    setDraft({ ...blankDraft(), parentId: parentId ?? '' });
    setSaveState({ status: 'idle' });
  }

  function openEdit(node: OutlineNode) {
    setEditor({ kind: 'edit', nodeId: node.id });
    setDraft(draftForNode(node));
    setSaveState({ status: 'idle' });
    setPendingDelete(null);
    setPendingLocked(null);
  }

  function updateDraft(field: keyof OutlineDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function saveEdit(input: OutlineNodeUpdate) {
    if (editor?.kind !== 'edit') {
      return;
    }
    const node = nodes.find((candidate) => candidate.id === editor.nodeId);
    if (!node) {
      return;
    }
    setSaveState({ status: 'saving' });
    try {
      const saved = await updateOutlineNode(workId, branchId, node.id, input);
      applyNode(saved);
      setSaveState({ status: 'saved', message: '大纲节点已保存' });
      setPendingLocked(null);
      setChangeReason('');
      setEditor(null);
      setDraft(blankDraft());
      await refreshReadiness();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'OUTLINE_LOCKED') {
        setPendingLocked({ kind: 'save', node, input });
        setSaveState({ status: 'idle' });
        return;
      }
      setSaveState({ status: 'error', message: friendlyError(error) });
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) {
      return;
    }
    const input = outlineInput(
      draft,
      editorLevel,
      editor.kind === 'create' ? draft.parentId || editor.parentId : null,
    );
    if (editor.kind === 'create') {
      setSaveState({ status: 'saving' });
      try {
        const created = await createOutlineNode(workId, branchId, input);
        applyNode(created);
        setEditor(null);
        setDraft(blankDraft());
        setSaveState({ status: 'saved', message: '大纲节点已创建' });
        await refreshReadiness();
      } catch (error) {
        setSaveState({ status: 'error', message: friendlyError(error) });
      }
      return;
    }

    await saveEdit({
      title: input.title,
      summary: input.summary,
      details: input.details,
      ...(editorLevel === 'book' ? {} : { parentId: draft.parentId || null }),
      chapterGoal: input.chapterGoal,
      pov: input.pov,
      sceneBeats: input.sceneBeats,
      chapterEndHook: input.chapterEndHook,
    });
  }

  async function confirmLockedAction() {
    if (!pendingLocked || !changeReason.trim()) {
      return;
    }
    setSaveState({ status: 'saving' });
    try {
      if (pendingLocked.kind === 'save') {
        const saved = await updateOutlineNode(workId, branchId, pendingLocked.node.id, {
          ...pendingLocked.input,
          confirmLockedChange: true,
          changeReason: changeReason.trim(),
        });
        applyNode(saved);
        setEditor(null);
        setDraft(blankDraft());
        setSaveState({ status: 'saved', message: '锁定节点修改已确认并保存' });
      } else if (pendingLocked.kind === 'regenerate') {
        const saved = await regenerateOutlineNode(workId, branchId, pendingLocked.node.id, {
          instruction: pendingLocked.instruction,
          confirmLockedChange: true,
          changeReason: changeReason.trim(),
        });
        applyNode(saved);
        setRegeneration(null);
        setSaveState({ status: 'saved', message: '锁定节点已重新生成' });
      } else if (pendingLocked.kind === 'delete') {
        await deleteOutlineNode(workId, branchId, pendingLocked.node.id, {
          confirmLockedChange: true,
          changeReason: changeReason.trim(),
        });
        removeNode(pendingLocked.node.id);
        setSaveState({ status: 'saved', message: '大纲节点已删除' });
      } else if (pendingLocked.kind === 'reorder') {
        const result = await reorderOutlineNodes(
          workId,
          branchId,
          pendingLocked.parentId,
          pendingLocked.orderedIds,
          {
            confirmLockedChange: true,
            changeReason: changeReason.trim(),
          },
        );
        applyReorderedNodes(result.items);
        setSaveState({ status: 'saved', message: '大纲顺序已调整' });
      }
      setPendingLocked(null);
      setChangeReason('');
      await refreshReadiness();
    } catch (error) {
      setSaveState({ status: 'error', message: friendlyError(error) });
    }
  }

  async function toggleLock(node: OutlineNode) {
    setSaveState({ status: 'saving' });
    try {
      const saved = node.locked
        ? await unlockOutlineNode(workId, branchId, node.id)
        : await lockOutlineNode(workId, branchId, node.id);
      applyNode(saved);
      setSaveState({
        status: 'saved',
        message: saved.locked ? '大纲节点已锁定' : '大纲节点已解锁',
      });
    } catch (error) {
      setSaveState({ status: 'error', message: friendlyError(error) });
    }
  }

  async function moveNode(node: OutlineNode, direction: -1 | 1) {
    const siblings = childrenOf(nodes, node.parentId);
    const index = siblings.findIndex((candidate) => candidate.id === node.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) {
      return;
    }
    const reordered = [...siblings];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    await requestReorder(node, reordered);
  }

  function applyReorderedNodes(savedNodes: OutlineNode[]) {
    setNodes((current) => {
      const byId = new Map(savedNodes.map((saved) => [saved.id, saved]));
      return current.map((candidate) => byId.get(candidate.id) ?? candidate);
    });
  }

  async function requestReorder(node: OutlineNode, reordered: OutlineNode[]) {
    const orderedIds = reordered.map((sibling) => sibling.id);
    if (reordered.some((sibling) => sibling.locked)) {
      setPendingLocked({
        kind: 'reorder',
        node,
        parentId: node.parentId,
        orderedIds,
      });
      setChangeReason('');
      setSaveState({ status: 'idle' });
      return;
    }
    setSaveState({ status: 'saving' });
    try {
      const result = await reorderOutlineNodes(workId, branchId, node.parentId, orderedIds);
      applyReorderedNodes(result.items);
      setSaveState({ status: 'saved', message: '大纲顺序已调整' });
    } catch (error) {
      setSaveState({ status: 'error', message: friendlyError(error) });
    }
  }

  async function startRegeneration(node: OutlineNode) {
    if (!regeneration || regeneration.nodeId !== node.id) {
      return;
    }
    setSaveState({ status: 'saving' });
    try {
      const saved = await regenerateOutlineNode(workId, branchId, node.id, {
        instruction: regeneration.instruction.trim(),
      });
      applyNode(saved);
      setRegeneration(null);
      setSaveState({ status: 'saved', message: '大纲节点已重新生成' });
      await refreshReadiness();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'OUTLINE_LOCKED') {
        setPendingLocked({
          kind: 'regenerate',
          node,
          instruction: regeneration.instruction.trim(),
        });
        setSaveState({ status: 'idle' });
        return;
      }
      setSaveState({ status: 'error', message: friendlyError(error) });
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) {
      return;
    }
    setSaveState({ status: 'saving' });
    try {
      await deleteOutlineNode(workId, branchId, pendingDelete.id);
      removeNode(pendingDelete.id);
      setPendingDelete(null);
      setSaveState({ status: 'saved', message: '大纲节点已删除' });
      await refreshReadiness();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'OUTLINE_LOCKED') {
        setPendingLocked({ kind: 'delete', node: pendingDelete });
        setPendingDelete(null);
        setSaveState({ status: 'idle' });
        return;
      }
      setSaveState({ status: 'error', message: friendlyError(error) });
    }
  }

  function dropNode(target: OutlineNode) {
    const draggedId = draggedNodeRef.current;
    if (!draggedId || draggedId === target.id) {
      draggedNodeRef.current = null;
      setDragOverNodeId(null);
      return;
    }
    const dragged = nodes.find((node) => node.id === draggedId);
    if (!dragged || dragged.parentId !== target.parentId) {
      draggedNodeRef.current = null;
      setDragOverNodeId(null);
      return;
    }
    const siblings = childrenOf(nodes, dragged.parentId);
    const targetIndex = siblings.findIndex((sibling) => sibling.id === target.id);
    const reordered = siblings.filter((sibling) => sibling.id !== dragged.id);
    reordered.splice(targetIndex, 0, dragged);
    draggedNodeRef.current = null;
    setDragOverNodeId(null);
    void requestReorder(dragged, reordered);
  }

  function renderNode(node: OutlineNode): React.ReactNode {
    const childLevel = CHILD_LEVEL[node.level];
    const siblings = childrenOf(nodes, node.parentId);
    const index = siblings.findIndex((candidate) => candidate.id === node.id);
    return (
      <li
        aria-label={`${node.levelLabel}：${node.title}`}
        className={`outline-tree-node outline-tree-${node.level}${
          dragOverNodeId === node.id ? ' drag-over' : ''
        }`}
        data-outline-level={node.level}
        key={node.id}
        onDragLeave={() => setDragOverNodeId(null)}
        onDragOver={(event) => {
          if (draggedNodeRef.current && draggedNodeRef.current !== node.id) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDragOverNodeId(node.id);
          }
        }}
        onPointerEnter={() => {
          if (draggedNodeRef.current && draggedNodeRef.current !== node.id) {
            setDragOverNodeId(node.id);
          }
        }}
        onPointerUp={(event) => {
          if (!draggedNodeRef.current) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          dropNode(node);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          dropNode(node);
        }}
      >
        <div className="outline-node-main">
          <div className="outline-node-heading">
            <span
              aria-label={`拖动《${node.title}》`}
              className="outline-drag-handle"
              draggable
              onDragEnd={() => {
                draggedNodeRef.current = null;
                setDragOverNodeId(null);
              }}
              onDragStart={(event) => {
                draggedNodeRef.current = node.id;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', node.id);
              }}
              onPointerDown={() => {
                draggedNodeRef.current = node.id;
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  void moveNode(node, -1);
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  void moveNode(node, 1);
                }
              }}
              role="button"
              tabIndex={0}
              title="拖动调整同层顺序"
            >
              拖动
            </span>
            <span className="outline-level-badge">{node.levelLabel}</span>
            <strong className="outline-node-title">{node.title}</strong>
            <span className={node.locked ? 'outline-lock-state locked' : 'outline-lock-state'}>
              {node.locked ? '已锁定' : '编辑中'}
            </span>
            {node.level === 'chapter' && node.chapterNumber !== null ? (
              <span className="outline-chapter-number">第 {node.chapterNumber} 章</span>
            ) : null}
          </div>
          {node.summary ? <p>{node.summary}</p> : null}
          {node.details ? <small>{node.details}</small> : null}
          {node.level === 'chapter' && node.chapterGoal ? (
            <dl className="outline-chapter-facts">
              <div>
                <dt>章目标</dt>
                <dd>{node.chapterGoal}</dd>
              </div>
              <div>
                <dt>叙事视角</dt>
                <dd>{node.pov}</dd>
              </div>
              <div>
                <dt>章末钩子</dt>
                <dd>{node.chapterEndHook}</dd>
              </div>
            </dl>
          ) : null}
        </div>

        <div className="outline-node-actions">
          <button
            aria-label={`编辑《${node.title}》`}
            className="text-button"
            onClick={() => openEdit(node)}
            type="button"
          >
            编辑
          </button>
          {childLevel ? (
            <button
              aria-label={`为《${node.title}》添加${LEVEL_LABELS[childLevel]}`}
              className="text-button"
              onClick={() => openCreate(childLevel, node.id)}
              type="button"
            >
              添加{LEVEL_LABELS[childLevel]}
            </button>
          ) : null}
          <button
            aria-label={`上移《${node.title}》`}
            className="text-button"
            disabled={index <= 0}
            onClick={() => void moveNode(node, -1)}
            type="button"
          >
            上移
          </button>
          <button
            aria-label={`下移《${node.title}》`}
            className="text-button"
            disabled={index < 0 || index >= siblings.length - 1}
            onClick={() => void moveNode(node, 1)}
            type="button"
          >
            下移
          </button>
          <button
            aria-label={`${node.locked ? '解锁' : '锁定'}《${node.title}》`}
            className="text-button"
            disabled={saveState.status === 'saving'}
            onClick={() => void toggleLock(node)}
            type="button"
          >
            {node.locked ? '解锁' : '锁定'}
          </button>
          <button
            aria-label={`重新生成《${node.title}》`}
            className="text-button"
            onClick={() => setRegeneration({ nodeId: node.id, instruction: '增强冲突和可执行性' })}
            type="button"
          >
            重新生成
          </button>
          <button
            aria-label={`删除《${node.title}》`}
            className="text-button danger-text"
            onClick={() => setPendingDelete(node)}
            type="button"
          >
            删除
          </button>
        </div>

        {regeneration?.nodeId === node.id ? (
          <div className="outline-regenerate-form">
            <label className="field">
              <span>重生成要求</span>
              <textarea
                aria-label="重生成要求"
                onChange={(event) =>
                  setRegeneration({ nodeId: node.id, instruction: event.currentTarget.value })
                }
                rows={2}
                value={regeneration.instruction}
              />
            </label>
            <div className="outline-inline-actions">
              <button
                className="primary-button"
                disabled={saveState.status === 'saving'}
                onClick={() => void startRegeneration(node)}
                type="button"
              >
                {saveState.status === 'saving' ? '正在重生成…' : '开始重生成'}
              </button>
              <button className="text-button" onClick={() => setRegeneration(null)} type="button">
                取消
              </button>
            </div>
          </div>
        ) : null}

        {pendingDelete?.id === node.id ? (
          <div className="outline-inline-confirm" role="alert">
            <p>删除后会同时移除它下面的所有大纲节点。</p>
            <div className="outline-inline-actions">
              <button
                className="danger-button"
                disabled={saveState.status === 'saving'}
                onClick={() => void confirmDelete()}
                type="button"
              >
                确认删除
              </button>
              <button className="text-button" onClick={() => setPendingDelete(null)} type="button">
                取消
              </button>
            </div>
          </div>
        ) : null}

        {childrenOf(nodes, node.id).length > 0 ? (
          <ol className="outline-children">
            {childrenOf(nodes, node.id).map((child) => renderNode(child))}
          </ol>
        ) : null}
      </li>
    );
  }

  return (
    <>
      <section
        aria-labelledby="full-outline-title"
        className="planning-section outline-workspace"
        id="full-outline"
      >
        <div className="planning-section-heading outline-workspace-heading">
          <div>
            <p className="workspace-step">从全书到场景</p>
            <h2 id="full-outline-title">完整大纲</h2>
            <p>先把全书、卷、幕、章和场景逐层拆开，再单独调整某一层。</p>
          </div>
          {!book ? (
            <button
              className="primary-button"
              onClick={() => openCreate('book', null)}
              type="button"
            >
              创建全书总纲
            </button>
          ) : null}
        </div>

        {saveState.status === 'saved' ? (
          <p className="form-message form-message-success" role="status">
            {saveState.message}
          </p>
        ) : null}
        {saveState.status === 'error' ? (
          <p className="form-message form-message-error" role="alert">
            {saveState.message}
          </p>
        ) : null}

        {editor ? (
          <form
            aria-label={editor.kind === 'create' ? '新建大纲节点' : '编辑大纲节点'}
            className="auth-form outline-editor"
            onSubmit={onSubmit}
          >
            <div className="outline-editor-heading">
              <div>
                <p className="workspace-step">
                  {editor.kind === 'create' ? '新增' : '编辑'}
                  {LEVEL_LABELS[editorLevel]}
                </p>
                <h3>
                  {editor.kind === 'create'
                    ? `添加${LEVEL_LABELS[editorLevel]}`
                    : editorNode?.title}
                </h3>
              </div>
              {editorNode?.locked ? (
                <span className="outline-lock-state locked">保存时需要确认修改原因</span>
              ) : null}
            </div>
            <div className="outline-editor-grid">
              <label className="field">
                <span>节点标题</span>
                <input
                  maxLength={200}
                  onChange={(event) => updateDraft('title', event.currentTarget.value)}
                  required
                  value={draft.title}
                />
              </label>
              <label className="field outline-editor-wide">
                <span>节点摘要</span>
                <textarea
                  maxLength={2_000}
                  onChange={(event) => updateDraft('summary', event.currentTarget.value)}
                  rows={3}
                  value={draft.summary}
                />
              </label>
              <label className="field outline-editor-wide">
                <span>节点细节</span>
                <textarea
                  maxLength={12_000}
                  onChange={(event) => updateDraft('details', event.currentTarget.value)}
                  placeholder="写清目标、阻碍、转折、代价和不能违背的边界"
                  rows={4}
                  value={draft.details}
                />
              </label>
              {editorParentOptions.length > 0 ? (
                <label className="field">
                  <span>上级节点</span>
                  <select
                    onChange={(event) => updateDraft('parentId', event.currentTarget.value)}
                    required
                    value={draft.parentId}
                  >
                    <option value="">选择上级{LEVEL_LABELS[editorParentLevel ?? 'book']}</option>
                    {editorParentOptions.map((parent) => (
                      <option key={parent.id} value={parent.id}>
                        {parent.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            {editorLevel === 'chapter' ? (
              <div className="outline-editor-grid chapter-outline-grid">
                <label className="field">
                  <span>章目标</span>
                  <textarea
                    maxLength={1_000}
                    onChange={(event) => updateDraft('chapterGoal', event.currentTarget.value)}
                    rows={3}
                    value={draft.chapterGoal}
                  />
                </label>
                <label className="field">
                  <span>叙事视角</span>
                  <input
                    maxLength={120}
                    onChange={(event) => updateDraft('pov', event.currentTarget.value)}
                    value={draft.pov}
                  />
                </label>
                <label className="field chapter-outline-beats">
                  <span>场景节拍</span>
                  <textarea
                    onChange={(event) => updateDraft('sceneBeats', event.currentTarget.value)}
                    placeholder={'一行一个节拍，例如：\n荒寺避雨\n断碑剑鸣'}
                    rows={5}
                    value={draft.sceneBeats}
                  />
                </label>
                <label className="field">
                  <span>章末钩子</span>
                  <textarea
                    maxLength={500}
                    onChange={(event) => updateDraft('chapterEndHook', event.currentTarget.value)}
                    rows={5}
                    value={draft.chapterEndHook}
                  />
                </label>
              </div>
            ) : null}

            <div className="planning-actions">
              <button
                className="primary-button"
                disabled={saveState.status === 'saving'}
                type="submit"
              >
                {saveState.status === 'saving'
                  ? '正在保存…'
                  : editor.kind === 'create'
                    ? '保存节点'
                    : '保存修改'}
              </button>
              <button
                className="text-button"
                onClick={() => {
                  setEditor(null);
                  setDraft(blankDraft());
                  setSaveState({ status: 'idle' });
                }}
                type="button"
              >
                取消
              </button>
            </div>
          </form>
        ) : null}

        {pendingLocked ? (
          <div className="locked-change-confirm" role="alertdialog" aria-modal="false">
            <p className="workspace-step">需要确认</p>
            <h3>
              {pendingLocked.kind === 'reorder'
                ? '这次调整会修改已锁定的大纲节点'
                : '这次保存会修改已锁定的大纲节点'}
            </h3>
            <p>将修改《{pendingLocked.node.title}》。保存后节点仍保持锁定，并保留本次修改原因。</p>
            <label className="field">
              <span>修改原因</span>
              <textarea
                aria-label="修改原因"
                maxLength={500}
                onChange={(event) => setChangeReason(event.currentTarget.value)}
                placeholder="说明为什么必须修改，以及是否已处理对后文的影响"
                rows={3}
                value={changeReason}
              />
            </label>
            <div className="locked-change-actions">
              <button
                className="primary-button"
                disabled={!changeReason.trim() || saveState.status === 'saving'}
                onClick={() => void confirmLockedAction()}
                type="button"
              >
                {saveState.status === 'saving'
                  ? '正在确认…'
                  : pendingLocked.kind === 'delete'
                    ? '确认并删除'
                    : pendingLocked.kind === 'reorder'
                      ? '确认并调整顺序'
                      : '确认并保存修改'}
              </button>
              <button
                className="text-button"
                onClick={() => {
                  setPendingLocked(null);
                  setChangeReason('');
                }}
                type="button"
              >
                取消
              </button>
            </div>
          </div>
        ) : null}

        {nodes.length === 0 ? (
          <div className="planning-empty">
            <h3>还没有大纲</h3>
            <p>先写全书总纲，再一层层补出卷、幕、章和场景。</p>
          </div>
        ) : (
          <ol className="outline-tree">
            {childrenOf(nodes, null).map((node) => renderNode(node))}
          </ol>
        )}
      </section>

      <section aria-label="生成准备度" className="outline-readiness">
        <div className="outline-readiness-heading">
          <div>
            <p className="workspace-step">开始生成前</p>
            <h2>生成准备度</h2>
            <p>缺什么会直接列出来，补齐后再开始写正文。</p>
          </div>
          <div className="outline-readiness-summary">
            <strong>{readiness.ready ? '可以开始生成' : '还需补齐'}</strong>
            <button
              className="text-button"
              disabled={readinessLoading}
              onClick={() => void refreshReadiness()}
              type="button"
            >
              {readinessLoading ? '正在检查…' : '刷新准备度'}
            </button>
          </div>
        </div>
        <div className="outline-readiness-grid">
          {Object.values(readiness.checks).map((check) => (
            <article
              className={check.ready ? 'readiness-item ready' : 'readiness-item'}
              key={check.label}
            >
              <div className="readiness-item-heading">
                <strong>{check.label}</strong>
                <span>{check.ready ? '已就绪' : '待补齐'}</span>
              </div>
              <p>{check.detail}</p>
              {check.missing.length > 0 ? <small>缺少：{check.missing.join('、')}</small> : null}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
