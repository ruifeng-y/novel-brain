"use client";

import {
  Activity,
  ArrowDown,
  ArrowUp,
  BookMarked,
  BookOpen,
  Check,
  Circle,
  Clapperboard,
  FilePlus2,
  FileText,
  GitCommitHorizontal,
  GripVertical,
  Layers3,
  LayoutGrid,
  ListTree,
  LoaderCircle,
  Lock,
  LockOpen,
  PanelTop,
  PenLine,
  Plus,
  Save,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import {
  apiErrorSchema,
  chapterWorkspaceResponseSchema,
  outlineNodeMutationResponseSchema,
  outlineWorkspaceResponseSchema,
  settingEntityListResponseSchema,
  storyLedgerWorkspaceResponseSchema,
  workResponseSchema,
  type ChapterBrief,
  type ChapterStatus,
  type DomainRef,
  type OutlineLevel,
  type OutlineNode,
  type OutlineNodeMutationData,
  type OutlineReadiness,
  type OutlineWorkspace,
  type SettingEntity,
  type StoryLedgerEntry,
  type StoryLedgerWorkspace,
  type VolumePlotLine,
  type WorkOverview,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";
import { fetchAllCursorPages } from "../lib/cursor-pagination";
import { GoldenThreePanel } from "./golden-three-panel";

type OutlineView = "tree" | "board" | "tension" | "ledger";

interface CreateForm {
  level: OutlineLevel;
  parentId: string;
  title: string;
  summary: string;
  order: string;
  tension: string;
  chapterNumber: string;
  chapterTitle: string;
  goal: string;
  pov: string;
  location: string;
  sceneBeats: string;
  requiredFacts: string;
  scenePovId: string;
  sceneLocationId: string;
  era: string;
  timeLabel: string;
  sortKey: string;
  beats: string;
  releases: string;
  sceneTension: string;
}

interface NodeEditForm {
  title: string;
  summary: string;
  status: OutlineNode["status"];
  tension: string;
}

interface BriefForm {
  title: string;
  goal: string;
  pov: string;
  location: string;
  sceneBeats: string;
  requiredFacts: string;
}

interface VolumeForm {
  objective: string;
  conflict: string;
  turningPoints: string;
  exitConditions: string;
  plotLines: string;
}

interface SceneForm {
  title: string;
  povId: string;
  locationId: string;
  era: string;
  timeLabel: string;
  sortKey: string;
  beats: string;
  releases: string;
  tension: string;
}

const initialCreateForm: CreateForm = {
  level: "volume",
  parentId: "",
  title: "",
  summary: "",
  order: "",
  tension: "",
  chapterNumber: "1",
  chapterTitle: "",
  goal: "",
  pov: "",
  location: "",
  sceneBeats: "",
  requiredFacts: "",
  scenePovId: "",
  sceneLocationId: "",
  era: "",
  timeLabel: "",
  sortKey: "0",
  beats: "",
  releases: "",
  sceneTension: "",
};

const levelLabels: Record<OutlineLevel, string> = {
  book: "全书",
  volume: "卷",
  act: "幕",
  chapter: "章",
  scene: "场景",
};

const chapterStatusLabels: Record<ChapterStatus, string> = {
  planned: "待写",
  writing: "写作中",
  waiting_review: "待审",
  changes_requested: "要求修改",
  approved: "已批准",
  locked: "已锁定",
  published: "已发布",
  rejected: "已驳回",
};

const nodeStatusLabels: Record<OutlineNode["status"], string> = {
  planned: "待写",
  active: "进行中",
  done: "已完成",
};

export function OutlineWorkspace({
  initialNodeId,
  workId,
}: {
  initialNodeId?: string | undefined;
  workId: string;
}) {
  const [work, setWork] = useState<WorkOverview | null>(null);
  const [workspace, setWorkspace] = useState<OutlineWorkspace | null>(null);
  const [ledger, setLedger] = useState<StoryLedgerWorkspace | null>(null);
  const [entities, setEntities] = useState<SettingEntity[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<OutlineView>("tree");
  const [createForm, setCreateForm] = useState<CreateForm>(initialCreateForm);
  const [nodeEdit, setNodeEdit] = useState<NodeEditForm | null>(null);
  const [briefForm, setBriefForm] = useState<BriefForm | null>(null);
  const [volumeForm, setVolumeForm] = useState<VolumeForm | null>(null);
  const [sceneForm, setSceneForm] = useState<SceneForm | null>(null);
  const [newBookTitle, setNewBookTitle] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  const basePath = work ? `/api/v1/works/${work.id}/branches/${work.mainBranch.id}` : "";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const workResponse = await fetch(`/api/v1/works/${workId}`, { cache: "no-store" });
      if (!workResponse.ok) {
        throw new Error(await readError(workResponse, "作品加载失败。"));
      }
      const workData = workResponseSchema.parse(await workResponse.json()).data;
      const branchPath = `/api/v1/works/${workData.id}/branches/${workData.mainBranch.id}`;
      const [outlineResponse, entityData, ledgerResponse] = await Promise.all([
        fetch(`${branchPath}/outline`, { cache: "no-store" }),
        fetchAllCursorPages(
          `${branchPath}/entities`,
          settingEntityListResponseSchema.parse,
          "设定加载失败。",
        ),
        fetch(`${branchPath}/ledger`, { cache: "no-store" }),
      ]);
      if (!outlineResponse.ok) {
        throw new Error(await readError(outlineResponse, "大纲加载失败。"));
      }
      if (!ledgerResponse.ok) {
        throw new Error(await readError(ledgerResponse, "伏笔账本加载失败。"));
      }
      const outline = outlineWorkspaceResponseSchema.parse(await outlineResponse.json()).data;
      setWork(workData);
      setWorkspace(outline);
      setEntities(entityData);
      setLedger(storyLedgerWorkspaceResponseSchema.parse(await ledgerResponse.json()).data);
      setSelectedId((current) =>
        current && outline.nodes.some((node) => node.id === current)
          ? current
          : initialNodeId && outline.nodes.some((node) => node.id === initialNodeId)
            ? initialNodeId
            : (outline.nodes.find((node) => node.level === "volume")?.id ??
              outline.nodes[0]?.id ??
              null),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "大纲加载失败。");
    } finally {
      setLoading(false);
    }
  }, [initialNodeId, workId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    if (!basePath) {
      return;
    }
    const [response, ledgerResponse] = await Promise.all([
      fetch(`${basePath}/outline`, { cache: "no-store" }),
      fetch(`${basePath}/ledger`, { cache: "no-store" }),
    ]);
    if (!response.ok) {
      throw new Error(await readError(response, "大纲刷新失败。"));
    }
    if (!ledgerResponse.ok) {
      throw new Error(await readError(ledgerResponse, "伏笔账本刷新失败。"));
    }
    const outline = outlineWorkspaceResponseSchema.parse(await response.json()).data;
    setWorkspace(outline);
    setLedger(storyLedgerWorkspaceResponseSchema.parse(await ledgerResponse.json()).data);
    setSelectedId((current) =>
      current && outline.nodes.some((node) => node.id === current)
        ? current
        : initialNodeId && outline.nodes.some((node) => node.id === initialNodeId)
          ? initialNodeId
          : (outline.nodes.find((node) => node.level === "volume")?.id ??
            outline.nodes[0]?.id ??
            null),
    );
  }, [basePath, initialNodeId]);

  const selected = useMemo(
    () => workspace?.nodes.find((node) => node.id === selectedId) ?? null,
    [workspace?.nodes, selectedId],
  );
  const selectedContract = useMemo(
    () => workspace?.volumeContracts.find((contract) => contract.nodeId === selectedId) ?? null,
    [workspace?.volumeContracts, selectedId],
  );
  const selectedScene = useMemo(
    () => workspace?.sceneCards.find((card) => card.nodeId === selectedId) ?? null,
    [workspace?.sceneCards, selectedId],
  );
  const selectedChapter = selected?.chapter ?? null;
  const lockedByAncestor = useMemo(
    () => (selected && workspace ? isLockedByAncestor(workspace.nodes, selected.id) : false),
    [selected, workspace],
  );
  const editable = Boolean(selected && !lockedByAncestor);

  useEffect(() => {
    if (!selected) {
      setNodeEdit(null);
      return;
    }
    setNodeEdit({
      title: selected.title,
      summary: selected.summary,
      status: selected.status,
      tension: selected.tension === null ? "" : String(selected.tension),
    });
  }, [selected]);

  useEffect(() => {
    if (!selectedChapter) {
      setBriefForm(null);
      return;
    }
    setBriefForm({
      title: selectedChapter.title,
      goal: selectedChapter.brief?.goal ?? "",
      pov: selectedChapter.brief?.pov ?? "",
      location: selectedChapter.brief?.location ?? "",
      sceneBeats: joinLines(selectedChapter.brief?.sceneBeats ?? []),
      requiredFacts: joinLines(selectedChapter.brief?.requiredFacts ?? []),
    });
  }, [selectedChapter]);

  useEffect(() => {
    if (!selected || selected.level !== "volume") {
      setVolumeForm(null);
      return;
    }
    setVolumeForm(
      selectedContract
        ? {
            objective: selectedContract.objective,
            conflict: selectedContract.conflict,
            turningPoints: joinLines(selectedContract.turningPoints),
            exitConditions: joinLines(selectedContract.exitConditions),
            plotLines: formatPlotLines(selectedContract.plotLines),
          }
        : { objective: "", conflict: "", turningPoints: "", exitConditions: "", plotLines: "" },
    );
  }, [selected, selectedContract]);

  useEffect(() => {
    if (!selected || selected.level !== "scene") {
      setSceneForm(null);
      return;
    }
    setSceneForm(
      selectedScene
        ? {
            title: selectedScene.title,
            povId: selectedScene.pov?.id ?? "",
            locationId: selectedScene.location?.id ?? "",
            era: selectedScene.storyTime?.era ?? "",
            timeLabel: selectedScene.storyTime?.label ?? "",
            sortKey: String(selectedScene.storyTime?.sortKey ?? 0),
            beats: joinLines(selectedScene.beats.map((beat) => beat.description)),
            releases: selectedScene.informationReleases
              .map((release) =>
                release.constraint
                  ? `${release.description} | ${release.constraint}`
                  : release.description,
              )
              .join("\n"),
            tension: selectedScene.tension === null ? "" : String(selectedScene.tension),
          }
        : {
            title: selected.title,
            povId: "",
            locationId: "",
            era: "",
            timeLabel: "",
            sortKey: "0",
            beats: "",
            releases: "",
            tension: "",
          },
    );
  }, [selected, selectedScene]);

  useEffect(() => {
    const expected = outlineParentLevelFor(createForm.level);
    if (!workspace || expected === null) {
      return;
    }
    const exists = workspace.nodes.some(
      (node) => node.id === createForm.parentId && node.level === expected,
    );
    if (!exists) {
      const first = workspace.nodes.find((node) => node.level === expected);
      const nextParentId = first?.id ?? "";
      setCreateForm((current) =>
        current.parentId === nextParentId ? current : { ...current, parentId: nextParentId },
      );
    }
  }, [createForm.level, createForm.parentId, workspace]);

  if (loading) {
    return (
      <section className="panel works-loading" aria-label="正在加载大纲工作台">
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
        正在加载大纲工作台
      </section>
    );
  }

  if (error || !work || !workspace) {
    return (
      <section className="works-error" role="alert">
        <TriangleAlert size={18} aria-hidden="true" />
        <span>{error || "大纲工作台加载失败。"}</span>
        <button className="text-btn small" onClick={load} type="button">
          重试
        </button>
      </section>
    );
  }

  const chapterNodes = workspace.nodes
    .filter((node) => node.level === "chapter")
    .sort(
      (left, right) =>
        (left.chapter?.number ?? 0) - (right.chapter?.number ?? 0) ||
        left.sortOrder - right.sortOrder,
    );
  const volumeNodes = workspace.nodes
    .filter((node) => node.level === "volume")
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const selectedVolume = findVolumeAncestor(workspace.nodes, selected?.id ?? null);
  const activeVolume = selectedVolume ?? volumeNodes[0] ?? null;
  const activeVolumeChapters = activeVolume
    ? descendantChapterNodes(workspace.nodes, activeVolume.id)
    : [];
  const activeVolumeWordCount = activeVolumeChapters.reduce(
    (sum, node) => sum + (node.chapter?.wordCount ?? 0),
    0,
  );
  const activeVolumeIndex = activeVolume
    ? volumeNodes.findIndex((node) => node.id === activeVolume.id) + 1
    : 0;
  const tensionNodes = chapterNodes.filter((node) => node.tension !== null);
  const expectedParent = outlineParentLevelFor(createForm.level);
  const parentOptions = workspace.nodes.filter((node) => node.level === expectedParent);
  const characterOptions = entities.filter((entity) => entity.type === "character");
  const locationOptions = entities.filter((entity) => entity.type === "map");
  const empty = workspace.nodes.length === 0;
  const outline = workspace;

  return (
    <div className="outline-plan-page">
      <section className="page-head outline-page-head">
        <div>
          <p className="eyebrow">章节规划</p>
          <h1>大纲工作台</h1>
          <p className="page-sub">
            {work.title} · 全书、卷、幕、章、场景逐层展开；已锁定部分保留版本，后续改动需要先解锁。
          </p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-ghost" href={`/workspace/${work.id}/settings`}>
            <BookMarked size={15} aria-hidden="true" />
            检查已确认设定
          </Link>
        </div>
      </section>

      {actionError ? (
        <div className="story-bible-notice danger" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="story-bible-notice" role="status">
          <Check size={16} aria-hidden="true" />
          <span>{notice}</span>
        </div>
      ) : null}

      <div className="outline-plan-toolbar">
        <div className="segmented outline-view-tabs" role="tablist" aria-label="大纲视图">
          <button
            className={`seg${view === "tree" ? " active" : ""}`}
            onClick={() => setView("tree")}
            role="tab"
            type="button"
          >
            <ListTree size={14} aria-hidden="true" />
            树状大纲
          </button>
          <button
            className={`seg${view === "board" ? " active" : ""}`}
            onClick={() => setView("board")}
            role="tab"
            type="button"
          >
            <LayoutGrid size={14} aria-hidden="true" />
            章节看板
          </button>
          <button
            className={`seg${view === "tension" ? " active" : ""}`}
            onClick={() => setView("tension")}
            role="tab"
            type="button"
          >
            <Activity size={14} aria-hidden="true" />
            张力曲线
          </button>
          <button
            className={`seg${view === "ledger" ? " active" : ""}`}
            onClick={() => setView("ledger")}
            role="tab"
            type="button"
          >
            <GitCommitHorizontal size={14} aria-hidden="true" />
            剧情账本
          </button>
        </div>
        <div className="outline-plan-stats">
          <span>{workspace.stats.totalNodes} 个节点</span>
          <span>{workspace.stats.chapterCount} 章</span>
          <span>{workspace.stats.wordCount.toLocaleString("zh-CN")} 字</span>
          <span className={`outline-readiness-${workspace.readiness.status}`}>
            {readinessLabel(workspace.readiness.status)}
          </span>
        </div>
      </div>

      {empty ? (
        <section className="panel outline-empty-state" aria-labelledby="outline-empty-title">
          <span className="empty-icon">
            <FilePlus2 size={22} aria-hidden="true" />
          </span>
          <div>
            <h2 id="outline-empty-title">还没有全书大纲</h2>
            <p>先创建全书根节点，再依次补卷、幕、章和场景。</p>
            <div className="outline-plan-inline-form">
              <label>
                <span>全书标题</span>
                <input
                  maxLength={200}
                  onChange={(event) => setNewBookTitle(event.target.value)}
                  placeholder="例如：忘川书"
                  value={newBookTitle}
                />
              </label>
              <button
                className="btn btn-primary"
                disabled={!newBookTitle.trim() || busy === "create"}
                onClick={() => void createBook()}
                type="button"
              >
                {busy === "create" ? (
                  <LoaderCircle className="spin" size={15} aria-hidden="true" />
                ) : (
                  <Plus size={15} aria-hidden="true" />
                )}
                创建全书大纲
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {view === "tree" ? (
        <>
          <div className="outline-plan-grid">
            <aside className="panel outline-plan-panel outline-plan-tree-panel">
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">五层结构</span>
                  <h2>全书到场景</h2>
                </div>
                <span className="badge">{workspace.stats.totalNodes}</span>
              </div>
              <div className="outline-plan-tree" role="tree" aria-label="五层大纲树">
                {renderTree(null, 0)}
              </div>
              {volumeNodes.length > 0 ? (
                <div className="outline-plan-volume-list">
                  <div className="panel-head">
                    <div>
                      <span className="panel-kicker">全书结构</span>
                      <h3>卷列表</h3>
                    </div>
                    <span className="badge">{volumeNodes.length} 卷</span>
                  </div>
                  {volumeNodes.map((volume, index) => {
                    const chapters = descendantChapterNodes(workspace.nodes, volume.id);
                    const words = chapters.reduce(
                      (sum, node) => sum + (node.chapter?.wordCount ?? 0),
                      0,
                    );
                    return (
                      <button
                        className={`outline-plan-volume-item${volume.id === activeVolume?.id ? " active" : ""}`}
                        key={volume.id}
                        onClick={() => setSelectedId(volume.id)}
                        type="button"
                      >
                        <span className="outline-plan-volume-index">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="outline-plan-volume-copy">
                          <strong>{volume.title}</strong>
                          <small>
                            {chapters.length} 章 · {words.toLocaleString("zh-CN")} 字
                          </small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </aside>

            <main className="outline-plan-panel outline-plan-main">
              {activeVolume ? (
                <section className="outline-plan-volume-plan" aria-label="当前卷章节">
                  <div className="outline-plan-volume-head">
                    <div>
                      <span className="panel-kicker">第 {activeVolumeIndex} 卷</span>
                      <h2>{activeVolume.title}</h2>
                      <p>{activeVolume.summary || "还没有卷摘要。"}</p>
                    </div>
                    <div className="outline-plan-volume-stats">
                      <span>{activeVolumeChapters.length} 章</span>
                      <span>{activeVolumeWordCount.toLocaleString("zh-CN")} 字</span>
                    </div>
                  </div>
                  {activeVolumeChapters.length === 0 ? (
                    <p className="outline-plan-note">这一卷还没有章节。先在树中新增章节节点。</p>
                  ) : (
                    <div className="outline-plan-chapter-list">
                      {activeVolumeChapters.map((chapter) => (
                        <button
                          className={`outline-plan-chapter-item${chapter.id === selectedId ? " active" : ""}${chapter.locked ? " locked" : ""}`}
                          key={chapter.id}
                          onClick={() => setSelectedId(chapter.id)}
                          type="button"
                        >
                          <span className="chapter-no">{chapter.chapter?.number ?? "-"}</span>
                          <span className="outline-plan-chapter-copy">
                            <strong>{chapter.title}</strong>
                            <small>
                              {chapter.chapter?.brief?.goal ||
                                chapter.summary ||
                                "还没有章纲摘要。"}
                            </small>
                          </span>
                          <span className="badge">
                            {chapter.chapter
                              ? chapterStatusLabels[chapter.chapter.status]
                              : "未关联章节"}
                          </span>
                          <small className="outline-plan-chapter-words">
                            {(chapter.chapter?.wordCount ?? 0).toLocaleString("zh-CN")} 字
                          </small>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}
              {selected ? renderSelected() : null}
            </main>

            <aside className="panel outline-plan-panel outline-plan-side">
              {renderReadiness()}
              {renderCreate()}
            </aside>
          </div>
          <GoldenThreePanel branchId={work.mainBranch.id} workId={work.id} />
        </>
      ) : null}

      {view === "board" ? (
        <section className="outline-plan-board" aria-label="章节看板">
          {renderBoard()}
        </section>
      ) : null}

      {view === "tension" ? (
        <section className="panel tension-panel" aria-label="张力曲线">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">张力曲线</span>
              <h2>按章查看推进强度</h2>
            </div>
            <span className="badge">{tensionNodes.length} 个数据点</span>
          </div>
          {tensionNodes.length === 0 ? (
            <p className="outline-plan-note">
              还没有张力数据。选中章节点，填写张力后即可看到曲线。
            </p>
          ) : (
            <>
              <div className="tension-chart">
                <svg viewBox="0 0 900 260" role="img" aria-label="章节张力曲线">
                  {tensionNodes.length > 1 ? (
                    <polyline
                      fill="none"
                      points={tensionNodes
                        .map((node, index) => {
                          const x = chartX(index, tensionNodes.length);
                          const y = chartY(node.tension ?? 0);
                          return `${x},${y}`;
                        })
                        .join(" ")}
                      stroke="#b23a2b"
                      strokeWidth="3"
                    />
                  ) : null}
                  {tensionNodes.map((node, index) => {
                    const x = chartX(index, tensionNodes.length);
                    const y = chartY(node.tension ?? 0);
                    return (
                      <g key={node.id}>
                        <circle cx={x} cy={y} fill="#b23a2b" r="4" />
                        <text fill="#77817b" fontSize="12" textAnchor="middle" x={x} y={252}>
                          {node.chapter?.number ?? index + 1}
                        </text>
                      </g>
                    );
                  })}
                  {selected?.level === "chapter" && selected.tension !== null ? (
                    <line
                      stroke="#2f6f5e"
                      strokeDasharray="5 5"
                      x1={chartX(
                        Math.max(
                          0,
                          tensionNodes.findIndex((node) => node.id === selected.id),
                        ),
                        tensionNodes.length,
                      )}
                      x2={chartX(
                        Math.max(
                          0,
                          tensionNodes.findIndex((node) => node.id === selected.id),
                        ),
                        tensionNodes.length,
                      )}
                      y1={30}
                      y2={240}
                    />
                  ) : null}
                </svg>
              </div>
              <div className="tension-events">
                {tensionNodes.map((node) => (
                  <button
                    className={node.id === selectedId ? "active" : ""}
                    key={node.id}
                    onClick={() => setSelectedId(node.id)}
                    type="button"
                  >
                    <span>第 {node.chapter?.number ?? "-"} 章</span>
                    <strong>{node.title}</strong>
                    <small>张力 {node.tension}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      ) : null}

      {view === "ledger" ? (
        <section className="panel outline-ledger-panel" data-outline-ledger>
          <div className="panel-head">
            <div>
              <span className="panel-kicker">剧情账本</span>
              <h2>剧情线、伏笔与人物弧</h2>
            </div>
            <Link className="btn btn-ghost" href={`/workspace/${work.id}/foreshadows`}>
              管理伏笔账本
            </Link>
          </div>
          {renderLedger()}
        </section>
      ) : null}
    </div>
  );

  function renderTree(parentId: string | null, depth: number) {
    const children = outline.nodes
      .filter((node) => node.parentId === parentId)
      .sort((left, right) => left.sortOrder - right.sortOrder);
    return children.map((node) => (
      <Fragment key={node.id}>
        <button
          aria-selected={node.id === selectedId}
          className={`outline-plan-tree-item level-${node.level}${node.id === selectedId ? " active" : ""}${node.locked ? " locked" : ""}`}
          data-outline-node-id={node.id}
          draggable={!isLockedByAncestor(outline.nodes, node.id)}
          onClick={() => setSelectedId(node.id)}
          onDragOver={(event) => event.preventDefault()}
          onDragStart={() => setDragId(node.id)}
          onDrop={(event) => void handleDrop(event, node)}
          role="treeitem"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          type="button"
        >
          <GripVertical className="outline-plan-grip" size={13} aria-hidden="true" />
          <span className="outline-plan-node-icon">{levelIcon(node.level)}</span>
          <span className="outline-plan-node-copy">
            <strong>{node.title}</strong>
            <small>
              {node.level === "chapter" && node.chapter
                ? `第 ${node.chapter.number} 章 · ${chapterStatusLabels[node.chapter.status]}`
                : node.summary || levelLabels[node.level]}
            </small>
          </span>
          {node.locked ? <Lock size={13} aria-label="已锁定" /> : null}
        </button>
        {renderTree(node.id, depth + 1)}
      </Fragment>
    ));
  }

  function renderSelected() {
    if (!selected) {
      return null;
    }
    const locked = lockedByAncestor || selected.locked;
    return (
      <>
        <div className="outline-plan-detail-head">
          <div>
            <span className="panel-kicker">
              {levelLabels[selected.level]}
              {selected.chapter ? ` · 第 ${selected.chapter.number} 章` : ""}
            </span>
            <h2>{selected.title}</h2>
            <p>
              {selected.chapter
                ? `${chapterStatusLabels[selected.chapter.status]} · ${selected.chapter.wordCount.toLocaleString("zh-CN")} 字`
                : selected.summary || "还没有摘要。"}
            </p>
          </div>
          <div className="outline-plan-detail-badges">
            <span className={`badge${selected.locked ? " gold-badge" : ""}`}>
              {selected.locked ? "已锁定" : "可编辑"}
            </span>
            <span className="badge">第 {selected.version} 版</span>
          </div>
        </div>

        {locked ? (
          <div className="outline-lock-notice">
            <Lock size={15} aria-hidden="true" />
            <span>这个节点或它的上级已锁定。解锁后才能继续修改。</span>
          </div>
        ) : null}

        <div className="outline-plan-actions">
          <button
            className="btn btn-ghost"
            disabled={!editable || busy === "move"}
            onClick={() => void moveRelative(-1)}
            type="button"
          >
            <ArrowUp size={14} aria-hidden="true" />
            上移
          </button>
          <button
            className="btn btn-ghost"
            disabled={!editable || busy === "move"}
            onClick={() => void moveRelative(1)}
            type="button"
          >
            <ArrowDown size={14} aria-hidden="true" />
            下移
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy === "lock"}
            onClick={() => void toggleLock()}
            type="button"
          >
            {selected.locked ? (
              <LockOpen size={14} aria-hidden="true" />
            ) : (
              <Lock size={14} aria-hidden="true" />
            )}
            {selected.locked ? "解锁" : "锁定"}
          </button>
          {selected.chapter ? (
            <Link
              className="btn btn-primary"
              href={`/workspace/${work?.id}/write?chapterId=${selected.chapter.id}`}
            >
              <PenLine size={14} aria-hidden="true" />
              去写这一章
            </Link>
          ) : null}
        </div>

        {selected.level === "chapter" ? renderChapterBrief() : null}
        {selected.level === "volume" ? renderVolumeContract() : null}
        {selected.level === "scene" ? renderSceneCard() : null}
        {selected.level !== "chapter" ? renderNodeEditor() : renderChapterNodeSettings()}
      </>
    );
  }

  function renderNodeEditor() {
    if (!selected || !nodeEdit) {
      return null;
    }
    return (
      <form
        className="outline-plan-form"
        onSubmit={(event) => {
          event.preventDefault();
          void saveNode();
        }}
      >
        <div className="panel-head">
          <h3>节点信息</h3>
        </div>
        <div className="outline-form-grid">
          <label>
            <span>标题</span>
            <input
              disabled={!editable}
              maxLength={200}
              onChange={(event) =>
                setNodeEdit((current) =>
                  current ? { ...current, title: event.target.value } : current,
                )
              }
              required
              value={nodeEdit.title}
            />
          </label>
          <label>
            <span>状态</span>
            <select
              disabled={!editable}
              onChange={(event) =>
                setNodeEdit((current) =>
                  current
                    ? { ...current, status: event.target.value as OutlineNode["status"] }
                    : current,
                )
              }
              value={nodeEdit.status}
            >
              {Object.entries(nodeStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="outline-form-wide">
            <span>摘要</span>
            <textarea
              disabled={!editable}
              maxLength={2000}
              onChange={(event) =>
                setNodeEdit((current) =>
                  current ? { ...current, summary: event.target.value } : current,
                )
              }
              rows={3}
              value={nodeEdit.summary}
            />
          </label>
          <label>
            <span>规划张力（0–100）</span>
            <input
              disabled={!editable}
              max="100"
              min="0"
              onChange={(event) =>
                setNodeEdit((current) =>
                  current ? { ...current, tension: event.target.value } : current,
                )
              }
              type="number"
              value={nodeEdit.tension}
            />
          </label>
        </div>
        <div className="outline-form-actions">
          <span>
            {editable
              ? "规划张力用于观察节奏起伏，不是质量评分；保存后会追加一条版本记录。"
              : "解锁后才能保存。"}
          </span>
          <button className="btn btn-primary" disabled={!editable || busy === "node"} type="submit">
            <Save size={14} aria-hidden="true" />
            保存节点
          </button>
        </div>
      </form>
    );
  }

  function renderChapterNodeSettings() {
    if (!selected || !nodeEdit) {
      return null;
    }
    return (
      <form
        className="outline-plan-form"
        onSubmit={(event) => {
          event.preventDefault();
          void saveNode();
        }}
      >
        <div className="panel-head">
          <h3>章节规划强度</h3>
        </div>
        <div className="outline-form-grid">
          <label>
            <span>规划张力（0–100）</span>
            <input
              disabled={!editable}
              max="100"
              min="0"
              onChange={(event) =>
                setNodeEdit((current) =>
                  current ? { ...current, tension: event.target.value } : current,
                )
              }
              type="number"
              value={nodeEdit.tension}
            />
          </label>
        </div>
        <div className="outline-form-actions">
          <span>章节正文状态由写作台管理；规划张力用于观察节奏起伏，不是质量评分。</span>
          <button className="btn btn-primary" disabled={!editable || busy === "node"} type="submit">
            <Save size={14} aria-hidden="true" />
            保存
          </button>
        </div>
      </form>
    );
  }

  function renderChapterBrief() {
    if (!selectedChapter || !briefForm) {
      return null;
    }
    const chapterEditable = ["planned", "writing", "changes_requested"].includes(
      selectedChapter.status,
    );
    const canSave = editable && chapterEditable;
    return (
      <form
        className="outline-plan-form"
        onSubmit={(event) => {
          event.preventDefault();
          void saveChapterBrief();
        }}
      >
        <div className="panel-head">
          <div>
            <span className="panel-kicker">章纲</span>
            <h3>这一章要完成什么</h3>
          </div>
          <span className="badge">{chapterStatusLabels[selectedChapter.status]}</span>
        </div>
        <div className="outline-form-grid">
          <label>
            <span>章节标题</span>
            <input
              disabled={!canSave}
              maxLength={200}
              onChange={(event) =>
                setBriefForm((current) =>
                  current ? { ...current, title: event.target.value } : current,
                )
              }
              required
              value={briefForm.title}
            />
          </label>
          <label className="outline-form-wide">
            <span>章目标</span>
            <textarea
              disabled={!canSave}
              onChange={(event) =>
                setBriefForm((current) =>
                  current ? { ...current, goal: event.target.value } : current,
                )
              }
              required
              rows={3}
              value={briefForm.goal}
            />
          </label>
          <label>
            <span>视角人物</span>
            <input
              disabled={!canSave}
              maxLength={200}
              onChange={(event) =>
                setBriefForm((current) =>
                  current ? { ...current, pov: event.target.value } : current,
                )
              }
              required
              value={briefForm.pov}
            />
          </label>
          <label>
            <span>地点</span>
            <input
              disabled={!canSave}
              maxLength={200}
              onChange={(event) =>
                setBriefForm((current) =>
                  current ? { ...current, location: event.target.value } : current,
                )
              }
              required
              value={briefForm.location}
            />
          </label>
          <label className="outline-form-wide">
            <span>场景节拍（一行一个）</span>
            <textarea
              disabled={!canSave}
              onChange={(event) =>
                setBriefForm((current) =>
                  current ? { ...current, sceneBeats: event.target.value } : current,
                )
              }
              required
              rows={5}
              value={briefForm.sceneBeats}
            />
          </label>
          <label className="outline-form-wide">
            <span>必用事实（一行一个）</span>
            <textarea
              disabled={!canSave}
              onChange={(event) =>
                setBriefForm((current) =>
                  current ? { ...current, requiredFacts: event.target.value } : current,
                )
              }
              required
              rows={3}
              value={briefForm.requiredFacts}
            />
          </label>
        </div>
        <div className="outline-form-actions">
          <span>
            {canSave
              ? "修改章纲会保留旧版本。"
              : "章节已进入审核或锁定状态，章纲暂时不能原地修改。"}
          </span>
          <button className="btn btn-primary" disabled={!canSave || busy === "brief"} type="submit">
            <Save size={14} aria-hidden="true" />
            保存章纲
          </button>
        </div>
      </form>
    );
  }

  function renderVolumeContract() {
    if (!volumeForm) {
      return null;
    }
    return (
      <form
        className="outline-plan-form"
        onSubmit={(event) => {
          event.preventDefault();
          void saveVolumeContract();
        }}
      >
        <div className="panel-head">
          <div>
            <span className="panel-kicker">卷契约</span>
            <h3>本卷的目标和退出条件</h3>
          </div>
          <span className="badge">
            {selectedContract ? `第 ${selectedContract.version} 版` : "未保存"}
          </span>
        </div>
        <div className="outline-form-grid">
          <label className="outline-form-wide">
            <span>卷目标</span>
            <textarea
              disabled={!editable}
              onChange={(event) =>
                setVolumeForm((current) =>
                  current ? { ...current, objective: event.target.value } : current,
                )
              }
              required
              rows={2}
              value={volumeForm.objective}
            />
          </label>
          <label className="outline-form-wide">
            <span>核心冲突</span>
            <textarea
              disabled={!editable}
              onChange={(event) =>
                setVolumeForm((current) =>
                  current ? { ...current, conflict: event.target.value } : current,
                )
              }
              required
              rows={2}
              value={volumeForm.conflict}
            />
          </label>
          <label className="outline-form-wide">
            <span>关键转折（一行一个）</span>
            <textarea
              disabled={!editable}
              onChange={(event) =>
                setVolumeForm((current) =>
                  current ? { ...current, turningPoints: event.target.value } : current,
                )
              }
              rows={3}
              value={volumeForm.turningPoints}
            />
          </label>
          <label className="outline-form-wide">
            <span>退出条件（一行一个）</span>
            <textarea
              disabled={!editable}
              onChange={(event) =>
                setVolumeForm((current) =>
                  current ? { ...current, exitConditions: event.target.value } : current,
                )
              }
              rows={3}
              value={volumeForm.exitConditions}
            />
          </label>
          <label className="outline-form-wide">
            <span>相关剧情线（名称｜状态｜备注）</span>
            <textarea
              disabled={!editable}
              onChange={(event) =>
                setVolumeForm((current) =>
                  current ? { ...current, plotLines: event.target.value } : current,
                )
              }
              placeholder="天门将开｜active｜主线"
              rows={3}
              value={volumeForm.plotLines}
            />
          </label>
        </div>
        <div className="outline-form-actions">
          <span>{editable ? "卷契约保存后会进入准备度检查。" : "解锁后才能保存。"}</span>
          <button
            className="btn btn-primary"
            disabled={!editable || busy === "volume"}
            type="submit"
          >
            <Save size={14} aria-hidden="true" />
            保存卷契约
          </button>
        </div>
      </form>
    );
  }

  function renderSceneCard() {
    if (!sceneForm) {
      return null;
    }
    return (
      <form
        className="outline-plan-form"
        onSubmit={(event) => {
          event.preventDefault();
          void saveSceneCard();
        }}
      >
        <div className="panel-head">
          <div>
            <span className="panel-kicker">场景卡</span>
            <h3>POV、地点、时间和信息释放</h3>
          </div>
          <span className="badge">
            {selectedScene ? `第 ${selectedScene.version} 版` : "未保存"}
          </span>
        </div>
        <div className="outline-form-grid">
          <label>
            <span>场景标题</span>
            <input
              disabled={!editable}
              maxLength={200}
              onChange={(event) =>
                setSceneForm((current) =>
                  current ? { ...current, title: event.target.value } : current,
                )
              }
              required
              value={sceneForm.title}
            />
          </label>
          <label>
            <span>视角人物</span>
            <select
              disabled={!editable}
              onChange={(event) =>
                setSceneForm((current) =>
                  current ? { ...current, povId: event.target.value } : current,
                )
              }
              value={sceneForm.povId}
            >
              <option value="">未指定</option>
              {characterOptions.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>地点</span>
            <select
              disabled={!editable}
              onChange={(event) =>
                setSceneForm((current) =>
                  current ? { ...current, locationId: event.target.value } : current,
                )
              }
              value={sceneForm.locationId}
            >
              <option value="">未指定</option>
              {locationOptions.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>故事纪元</span>
            <input
              disabled={!editable}
              onChange={(event) =>
                setSceneForm((current) =>
                  current ? { ...current, era: event.target.value } : current,
                )
              }
              placeholder="例如：大玄历"
              value={sceneForm.era}
            />
          </label>
          <label>
            <span>故事时间</span>
            <input
              disabled={!editable}
              onChange={(event) =>
                setSceneForm((current) =>
                  current ? { ...current, timeLabel: event.target.value } : current,
                )
              }
              placeholder="例如：雨夜"
              value={sceneForm.timeLabel}
            />
          </label>
          <label>
            <span>时间排序值</span>
            <input
              disabled={!editable}
              onChange={(event) =>
                setSceneForm((current) =>
                  current ? { ...current, sortKey: event.target.value } : current,
                )
              }
              type="number"
              value={sceneForm.sortKey}
            />
          </label>
          <label className="outline-form-wide">
            <span>场景节拍（一行一个）</span>
            <textarea
              disabled={!editable}
              onChange={(event) =>
                setSceneForm((current) =>
                  current ? { ...current, beats: event.target.value } : current,
                )
              }
              rows={4}
              value={sceneForm.beats}
            />
          </label>
          <label className="outline-form-wide">
            <span>信息释放（一行一个，可用“｜”补充知情边界）</span>
            <textarea
              disabled={!editable}
              onChange={(event) =>
                setSceneForm((current) =>
                  current ? { ...current, releases: event.target.value } : current,
                )
              }
              rows={3}
              value={sceneForm.releases}
            />
          </label>
          <label>
            <span>规划张力（0–100）</span>
            <input
              disabled={!editable}
              max="100"
              min="0"
              onChange={(event) =>
                setSceneForm((current) =>
                  current ? { ...current, tension: event.target.value } : current,
                )
              }
              type="number"
              value={sceneForm.tension}
            />
          </label>
        </div>
        <div className="outline-form-actions">
          <span>
            {editable
              ? "规划张力用于观察节奏起伏，不是质量评分；场景卡保存后会进入准备度检查。"
              : "解锁后才能保存。"}
          </span>
          <button
            className="btn btn-primary"
            disabled={!editable || busy === "scene"}
            type="submit"
          >
            <Save size={14} aria-hidden="true" />
            保存场景卡
          </button>
        </div>
      </form>
    );
  }

  function renderReadiness() {
    return (
      <div className="outline-plan-readiness">
        <div className="panel-head">
          <div>
            <span className="panel-kicker">写前检查</span>
            <h2>生成准备度</h2>
          </div>
          <span className={`badge outline-readiness-${outline.readiness.status}`}>
            {readinessLabel(outline.readiness.status)}
          </span>
        </div>
        <p className="outline-plan-note">
          {outline.readiness.canProceed
            ? "关键项已经齐备，可以继续推进写作。"
            : "先补齐标记为“需补齐”的项目。"}
        </p>
        <div className="outline-readiness-list">
          {outline.readiness.items.map((item) => (
            <div
              className={`outline-readiness-item${item.ready ? " ready" : ""} severity-${item.severity}`}
              key={item.key}
            >
              <span>
                {item.ready ? (
                  <Check size={14} aria-hidden="true" />
                ) : item.severity === "blocker" ? (
                  <TriangleAlert size={14} aria-hidden="true" />
                ) : (
                  <Circle size={11} aria-hidden="true" />
                )}
              </span>
              <div>
                <strong>{item.label}</strong>
                <small>
                  {item.ready ? "已就绪" : `${severityLabel(item.severity)} · ${item.remediation}`}
                </small>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderCreate() {
    return (
      <details className="outline-plan-create" open={outline.nodes.length === 0}>
        <summary>
          <Plus size={14} aria-hidden="true" />
          新增节点
        </summary>
        <form
          className="outline-plan-form"
          onSubmit={(event) => {
            event.preventDefault();
            void createNode();
          }}
        >
          <div className="outline-form-grid">
            <label>
              <span>层级</span>
              <select
                onChange={(event) => changeCreateLevel(event.target.value as OutlineLevel)}
                value={createForm.level}
              >
                {(["book", "volume", "act", "chapter", "scene"] as OutlineLevel[]).map((level) => (
                  <option key={level} value={level}>
                    {levelLabels[level]}
                  </option>
                ))}
              </select>
            </label>
            {expectedParent ? (
              <label>
                <span>上级{levelLabels[expectedParent]}</span>
                <select
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, parentId: event.target.value }))
                  }
                  required
                  value={createForm.parentId}
                >
                  <option value="">请选择</option>
                  {parentOptions.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              <span>顺序（可选）</span>
              <input
                min="0"
                onChange={(event) =>
                  setCreateForm((current) => ({ ...current, order: event.target.value }))
                }
                type="number"
                value={createForm.order}
              />
            </label>
            {createForm.level === "chapter" ? (
              <>
                <label>
                  <span>章节序号</span>
                  <input
                    min="1"
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        chapterNumber: event.target.value,
                      }))
                    }
                    required
                    type="number"
                    value={createForm.chapterNumber}
                  />
                </label>
                <label>
                  <span>章节标题</span>
                  <input
                    maxLength={200}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        chapterTitle: event.target.value,
                      }))
                    }
                    required
                    value={createForm.chapterTitle}
                  />
                </label>
                <label className="outline-form-wide">
                  <span>章目标</span>
                  <textarea
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, goal: event.target.value }))
                    }
                    required
                    rows={2}
                    value={createForm.goal}
                  />
                </label>
                <label>
                  <span>视角人物</span>
                  <input
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, pov: event.target.value }))
                    }
                    required
                    value={createForm.pov}
                  />
                </label>
                <label>
                  <span>地点</span>
                  <input
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, location: event.target.value }))
                    }
                    required
                    value={createForm.location}
                  />
                </label>
                <label className="outline-form-wide">
                  <span>场景节拍（一行一个）</span>
                  <textarea
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        sceneBeats: event.target.value,
                      }))
                    }
                    required
                    rows={3}
                    value={createForm.sceneBeats}
                  />
                </label>
                <label className="outline-form-wide">
                  <span>必用事实（一行一个）</span>
                  <textarea
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        requiredFacts: event.target.value,
                      }))
                    }
                    required
                    rows={2}
                    value={createForm.requiredFacts}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="outline-form-wide">
                  <span>标题</span>
                  <input
                    maxLength={200}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, title: event.target.value }))
                    }
                    required
                    value={createForm.title}
                  />
                </label>
                <label className="outline-form-wide">
                  <span>摘要</span>
                  <textarea
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, summary: event.target.value }))
                    }
                    rows={2}
                    value={createForm.summary}
                  />
                </label>
                <label>
                  <span>规划张力（0–100）</span>
                  <input
                    max="100"
                    min="0"
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, tension: event.target.value }))
                    }
                    type="number"
                    value={createForm.tension}
                  />
                </label>
              </>
            )}
            {createForm.level === "scene" ? (
              <>
                <label>
                  <span>场景视角</span>
                  <select
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        scenePovId: event.target.value,
                      }))
                    }
                    value={createForm.scenePovId}
                  >
                    <option value="">未指定</option>
                    {characterOptions.map((entity) => (
                      <option key={entity.id} value={entity.id}>
                        {entity.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>场景地点</span>
                  <select
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        sceneLocationId: event.target.value,
                      }))
                    }
                    value={createForm.sceneLocationId}
                  >
                    <option value="">未指定</option>
                    {locationOptions.map((entity) => (
                      <option key={entity.id} value={entity.id}>
                        {entity.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>故事纪元</span>
                  <input
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, era: event.target.value }))
                    }
                    value={createForm.era}
                  />
                </label>
                <label>
                  <span>故事时间</span>
                  <input
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, timeLabel: event.target.value }))
                    }
                    value={createForm.timeLabel}
                  />
                </label>
                <label>
                  <span>时间排序值</span>
                  <input
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, sortKey: event.target.value }))
                    }
                    type="number"
                    value={createForm.sortKey}
                  />
                </label>
                <label className="outline-form-wide">
                  <span>场景节拍（一行一个）</span>
                  <textarea
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, beats: event.target.value }))
                    }
                    rows={3}
                    value={createForm.beats}
                  />
                </label>
                <label className="outline-form-wide">
                  <span>信息释放（一行一个，可用“｜”补充知情边界）</span>
                  <textarea
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, releases: event.target.value }))
                    }
                    rows={2}
                    value={createForm.releases}
                  />
                </label>
                <label>
                  <span>场景规划张力（0–100）</span>
                  <input
                    max="100"
                    min="0"
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        sceneTension: event.target.value,
                      }))
                    }
                    type="number"
                    value={createForm.sceneTension}
                  />
                </label>
              </>
            ) : null}
          </div>
          <div className="outline-form-actions">
            <span>
              拖动树节点可以调整顺序或移动到新的上级下；规划张力用于观察节奏起伏，不是质量评分。
            </span>
            <button className="btn btn-primary" disabled={busy === "create"} type="submit">
              {busy === "create" ? (
                <LoaderCircle className="spin" size={14} aria-hidden="true" />
              ) : (
                <Plus size={14} aria-hidden="true" />
              )}
              创建节点
            </button>
          </div>
        </form>
      </details>
    );
  }

  function renderLedger() {
    if (!work) {
      return null;
    }
    const entries = ledger?.entries ?? [];
    const kinds: Array<{ kind: StoryLedgerEntry["kind"]; label: string }> = [
      { kind: "plot_thread", label: "剧情线" },
      { kind: "foreshadow", label: "伏笔" },
      { kind: "character_arc", label: "人物弧" },
    ];
    if (entries.length === 0) {
      return (
        <div className="outline-ledger-empty">
          <GitCommitHorizontal size={24} aria-hidden="true" />
          <strong>还没有账本记录</strong>
          <p>先从主线、伏笔或人物弧中选一项，写清来源和目标窗口。</p>
          <Link className="btn btn-primary" href={`/workspace/${work.id}/foreshadows`}>
            新增记录
          </Link>
        </div>
      );
    }
    return (
      <>
        <div className="outline-ledger-summary">
          <span>{ledger?.summary.open ?? 0} 条未收束</span>
          <span>{ledger?.summary.overdue ?? 0} 条逾期</span>
          <span>{ledger?.summary.paidOff ?? 0} 条已回收</span>
          <span>写到第 {ledger?.writtenThroughChapter ?? 0} 章</span>
        </div>
        <div className="outline-ledger-grid">
          {kinds.map(({ kind, label }) => {
            const items = entries.filter((entry) => entry.kind === kind).slice(0, 5);
            return (
              <div className="outline-ledger-column" data-ledger-kind={kind} key={kind}>
                <div className="outline-ledger-column-head">
                  <strong>{label}</strong>
                  <span>{entries.filter((entry) => entry.kind === kind).length}</span>
                </div>
                {items.length === 0 ? (
                  <p className="outline-plan-note">暂无记录</p>
                ) : (
                  items.map((entry) => (
                    <div className="outline-ledger-row" key={entry.id}>
                      <span className={`ledger-dot status-${entry.status}`} />
                      <div>
                        <strong>{entry.title}</strong>
                        <small>
                          第 {entry.targetWindow.fromChapter}–{entry.targetWindow.toChapter} 章 ·{" "}
                          {ledgerStatusLabel(entry.status)}
                        </small>
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
        {ledger?.findings.length ? (
          <div className="outline-ledger-findings">
            <span className="panel-kicker">需要处理</span>
            {ledger.findings.slice(0, 4).map((finding) => (
              <Link
                href={`/workspace/${work.id}/foreshadows`}
                key={`${finding.entryId}:${finding.code}`}
              >
                <TriangleAlert size={14} aria-hidden="true" />
                <span>{finding.message}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="outline-plan-note">目前没有逾期、重复或回收依据不足。</p>
        )}
      </>
    );
  }

  function renderBoard() {
    const columns: Array<{
      key: string;
      label: string;
      statuses: ChapterStatus[];
    }> = [
      { key: "planned", label: "待写", statuses: ["planned"] },
      {
        key: "active",
        label: "进行中",
        statuses: ["writing", "waiting_review", "changes_requested", "rejected"],
      },
      { key: "locked", label: "已锁定", statuses: ["approved", "locked", "published"] },
    ];
    return columns.map((column) => {
      const cards = chapterNodes.filter(
        (node) => node.chapter && column.statuses.includes(node.chapter.status),
      );
      return (
        <section className="panel board-column" key={column.key}>
          <div className="board-column-head">
            <strong>{column.label}</strong>
            <span>{cards.length} 章</span>
          </div>
          {cards.length === 0 ? <p className="outline-plan-note">暂无章节</p> : null}
          {cards.map((node) => (
            <button
              className={`board-card${node.id === selectedId ? " active" : ""}${node.locked ? " done" : ""}`}
              key={node.id}
              onClick={() => setSelectedId(node.id)}
              type="button"
            >
              <span>第 {node.chapter?.number} 章</span>
              <strong>{node.title}</strong>
              <small>
                {node.chapter ? chapterStatusLabels[node.chapter.status] : ""}
                {node.chapter?.brief?.sceneBeats.length
                  ? ` · ${node.chapter.brief.sceneBeats.length} 个节拍`
                  : ""}
              </small>
            </button>
          ))}
        </section>
      );
    });
  }

  async function createBook() {
    const title = newBookTitle.trim();
    if (!title) {
      return;
    }
    setBusy("create");
    setActionError("");
    setNotice("");
    try {
      const data = await callMutation(`${basePath}/outline/nodes`, "POST", {
        level: "book",
        parentId: null,
        title,
        summary: "",
      });
      applyMutation(data);
      setNewBookTitle("");
      setNotice("全书大纲已创建。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "创建失败。");
    } finally {
      setBusy("");
    }
  }

  async function createNode() {
    if (!work) {
      return;
    }
    setActionError("");
    setNotice("");
    const parentId = createForm.level === "book" ? null : createForm.parentId || null;
    if (createForm.level !== "book" && !parentId) {
      setActionError("请选择上级节点。");
      return;
    }
    const body: Record<string, unknown> = {
      level: createForm.level,
      parentId,
      summary: createForm.summary.trim(),
      tension: optionalNumber(createForm.tension),
    };
    if (createForm.order.trim()) {
      body.sortOrder = Number(createForm.order);
    }
    if (createForm.level === "chapter") {
      if (!createForm.chapterTitle.trim() || !createForm.goal.trim()) {
        setActionError("请补全章节标题和章目标。");
        return;
      }
      const sceneBeats = splitLines(createForm.sceneBeats);
      const requiredFacts = splitLines(createForm.requiredFacts);
      if (sceneBeats.length === 0 || requiredFacts.length === 0) {
        setActionError("章纲至少需要一个场景节拍和一条必用事实。");
        return;
      }
      body.chapterCreate = {
        number: Number(createForm.chapterNumber),
        title: createForm.chapterTitle.trim(),
        brief: {
          goal: createForm.goal.trim(),
          pov: createForm.pov.trim(),
          location: createForm.location.trim(),
          sceneBeats,
          requiredFacts,
        } satisfies ChapterBrief,
      };
    } else {
      if (!createForm.title.trim()) {
        setActionError("请填写节点标题。");
        return;
      }
      body.title = createForm.title.trim();
      body.status = "planned";
    }
    if (createForm.level === "scene") {
      body.sceneCard = {
        title: createForm.title.trim(),
        pov: entityRef(entities, createForm.scenePovId, "character"),
        location: entityRef(entities, createForm.sceneLocationId, "map"),
        storyTime:
          createForm.era.trim() && createForm.timeLabel.trim()
            ? {
                era: createForm.era.trim(),
                label: createForm.timeLabel.trim(),
                sortKey: Number(createForm.sortKey || 0),
              }
            : null,
        beats: splitLines(createForm.beats).map((description) => ({ description })),
        informationReleases: parseReleases(createForm.releases),
        tension: optionalNumber(createForm.sceneTension),
      };
    }
    setBusy("create");
    try {
      const data = await callMutation(`${basePath}/outline/nodes`, "POST", body);
      applyMutation(data);
      setCreateForm((current) => ({
        ...initialCreateForm,
        level: current.level,
        parentId: current.parentId,
      }));
      setNotice("节点已创建。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "创建失败。");
    } finally {
      setBusy("");
    }
  }

  async function saveNode() {
    if (!selected || !nodeEdit) {
      return;
    }
    setBusy("node");
    setActionError("");
    try {
      const body: Record<string, unknown> = {
        version: selected.version,
        summary: nodeEdit.summary,
        tension: optionalNumber(nodeEdit.tension),
      };
      if (selected.level !== "chapter") {
        body.title = nodeEdit.title.trim();
        body.status = nodeEdit.status;
      }
      const data = await callMutation(`${basePath}/outline/nodes/${selected.id}`, "PATCH", body);
      applyMutation(data);
      setNotice("节点已保存。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function saveChapterBrief() {
    if (!selectedChapter || !briefForm) {
      return;
    }
    const sceneBeats = splitLines(briefForm.sceneBeats);
    const requiredFacts = splitLines(briefForm.requiredFacts);
    if (sceneBeats.length === 0 || requiredFacts.length === 0) {
      setActionError("章纲至少需要一个场景节拍和一条必用事实。");
      return;
    }
    setBusy("brief");
    setActionError("");
    try {
      const response = await fetch(`${basePath}/chapters/${selectedChapter.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await getCsrfToken(),
        },
        body: JSON.stringify({
          version: selectedChapter.version,
          title: briefForm.title.trim(),
          brief: {
            goal: briefForm.goal.trim(),
            pov: briefForm.pov.trim(),
            location: briefForm.location.trim(),
            sceneBeats,
            requiredFacts,
          },
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "章纲保存失败。"));
      }
      chapterWorkspaceResponseSchema.parse(await response.json());
      await refresh();
      setNotice("章纲已保存。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "章纲保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function saveVolumeContract() {
    if (!selected || !volumeForm) {
      return;
    }
    setBusy("volume");
    setActionError("");
    try {
      const data = await callMutation(
        `${basePath}/outline/nodes/${selected.id}/volume-contract`,
        "PUT",
        {
          version: selectedContract?.version,
          objective: volumeForm.objective.trim(),
          conflict: volumeForm.conflict.trim(),
          turningPoints: splitLines(volumeForm.turningPoints),
          exitConditions: splitLines(volumeForm.exitConditions),
          plotLines: parsePlotLines(volumeForm.plotLines),
        },
      );
      applyMutation(data);
      setNotice("卷契约已保存。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "卷契约保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function saveSceneCard() {
    if (!selected || !sceneForm) {
      return;
    }
    setBusy("scene");
    setActionError("");
    try {
      const data = await callMutation(
        `${basePath}/outline/nodes/${selected.id}/scene-card`,
        "PUT",
        {
          version: selectedScene?.version,
          title: sceneForm.title.trim(),
          pov: entityRef(entities, sceneForm.povId, "character"),
          location: entityRef(entities, sceneForm.locationId, "map"),
          storyTime:
            sceneForm.era.trim() && sceneForm.timeLabel.trim()
              ? {
                  era: sceneForm.era.trim(),
                  label: sceneForm.timeLabel.trim(),
                  sortKey: Number(sceneForm.sortKey || 0),
                }
              : null,
          beats: splitLines(sceneForm.beats).map((description) => ({ description })),
          informationReleases: parseReleases(sceneForm.releases),
          tension: optionalNumber(sceneForm.tension),
        },
      );
      applyMutation(data);
      setNotice("场景卡已保存。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "场景卡保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function toggleLock() {
    if (!selected) {
      return;
    }
    setBusy("lock");
    setActionError("");
    try {
      const action = selected.locked ? "unlock" : "lock";
      const data = await callMutation(
        `${basePath}/outline/nodes/${selected.id}/${action}`,
        "POST",
        { version: selected.version },
      );
      applyMutation(data);
      setNotice(selected.locked ? "节点已解锁。" : "节点已锁定。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "状态更新失败。");
    } finally {
      setBusy("");
    }
  }

  async function moveRelative(delta: number) {
    if (!selected) {
      return;
    }
    const siblings = outline.nodes
      .filter((node) => node.parentId === selected.parentId)
      .sort((left, right) => left.sortOrder - right.sortOrder);
    const index = siblings.findIndex((node) => node.id === selected.id);
    const targetIndex = index + delta;
    if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) {
      return;
    }
    setBusy("move");
    setActionError("");
    try {
      const data = await callMutation(`${basePath}/outline/nodes/${selected.id}/move`, "POST", {
        version: selected.version,
        parentId: selected.parentId,
        sortOrder: targetIndex,
      });
      applyMutation(data);
      setNotice("顺序已调整。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "顺序调整失败。");
    } finally {
      setBusy("");
    }
  }

  async function handleDrop(event: DragEvent<HTMLButtonElement>, target: OutlineNode) {
    event.preventDefault();
    if (!dragId || dragId === target.id) {
      setDragId(null);
      return;
    }
    const dragged = outline.nodes.find((node) => node.id === dragId);
    setDragId(null);
    if (
      !dragged ||
      dragged.level === "book" ||
      isLockedByAncestor(outline.nodes, dragged.id) ||
      isLockedByAncestor(outline.nodes, target.id)
    ) {
      return;
    }
    const expected = outlineParentLevelFor(dragged.level);
    let parentId: string | null = null;
    let sortOrder: number | undefined;
    if (expected === target.level) {
      parentId = target.id;
    } else if (dragged.parentId && target.parentId === dragged.parentId) {
      parentId = dragged.parentId;
      sortOrder = target.sortOrder;
    } else {
      return;
    }
    setBusy("move");
    setActionError("");
    try {
      const data = await callMutation(`${basePath}/outline/nodes/${dragged.id}/move`, "POST", {
        version: dragged.version,
        parentId,
        sortOrder,
      });
      applyMutation(data);
      setNotice("节点已移动。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "移动失败。");
    } finally {
      setBusy("");
    }
  }

  async function callMutation(
    path: string,
    method: "POST" | "PATCH" | "PUT",
    body: unknown,
  ): Promise<OutlineNodeMutationData> {
    const response = await fetch(path, {
      method,
      headers: {
        "content-type": "application/json",
        "x-csrf-token": await getCsrfToken(),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(await readError(response, "保存失败。"));
    }
    return outlineNodeMutationResponseSchema.parse(await response.json()).data;
  }

  function applyMutation(data: OutlineNodeMutationData) {
    setWorkspace(data.workspace);
    setSelectedId(data.node.id);
  }

  function changeCreateLevel(level: OutlineLevel) {
    const expected = outlineParentLevelFor(level);
    const firstParent = outline.nodes.find((node) => node.level === expected);
    setCreateForm((current) => ({
      ...current,
      level,
      parentId: expected === null ? "" : (firstParent?.id ?? ""),
    }));
  }

  function levelIcon(level: OutlineLevel) {
    switch (level) {
      case "book":
        return <BookOpen size={14} aria-hidden="true" />;
      case "volume":
        return <Layers3 size={14} aria-hidden="true" />;
      case "act":
        return <PanelTop size={14} aria-hidden="true" />;
      case "chapter":
        return <FileText size={14} aria-hidden="true" />;
      case "scene":
        return <Clapperboard size={14} aria-hidden="true" />;
    }
  }
}

function outlineParentLevelFor(level: OutlineLevel): OutlineLevel | null {
  switch (level) {
    case "book":
      return null;
    case "volume":
      return "book";
    case "act":
      return "volume";
    case "chapter":
      return "act";
    case "scene":
      return "chapter";
  }
}

function isLockedByAncestor(nodes: OutlineNode[], nodeId: string): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = byId.get(nodeId);
  const seen = new Set<string>();
  while (current) {
    if (current.locked) {
      return true;
    }
    if (!current.parentId || seen.has(current.id)) {
      return false;
    }
    seen.add(current.id);
    current = byId.get(current.parentId);
  }
  return false;
}

function findVolumeAncestor(nodes: OutlineNode[], nodeId: string | null): OutlineNode | null {
  if (!nodeId) {
    return null;
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = byId.get(nodeId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.level === "volume") {
      return current;
    }
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return null;
}

function descendantChapterNodes(nodes: OutlineNode[], ancestorId: string): OutlineNode[] {
  const childrenByParent = new Map<string, OutlineNode[]>();
  for (const node of nodes) {
    if (!node.parentId) {
      continue;
    }
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }
  const chapters: OutlineNode[] = [];
  const visit = (parentId: string) => {
    const children = (childrenByParent.get(parentId) ?? []).sort(
      (left, right) => left.sortOrder - right.sortOrder,
    );
    for (const child of children) {
      if (child.level === "chapter") {
        chapters.push(child);
      }
      visit(child.id);
    }
  };
  visit(ancestorId);
  return chapters.sort(
    (left, right) =>
      (left.chapter?.number ?? 0) - (right.chapter?.number ?? 0) ||
      left.sortOrder - right.sortOrder,
  );
}

function entityRef(
  entities: SettingEntity[],
  entityId: string,
  expectedType: "character" | "map",
): DomainRef | null {
  if (!entityId) {
    return null;
  }
  const entity = entities.find((entry) => entry.id === entityId && entry.type === expectedType);
  if (!entity) {
    return null;
  }
  return {
    type: expectedType,
    id: entity.id,
    branchId: entity.branchId,
    label: entity.name,
    version: null,
  };
}

function parsePlotLines(value: string): VolumePlotLine[] {
  return splitLines(value)
    .map((line) => {
      const [name, status = "planned", ...note] = line.split("|").map((part) => part.trim());
      if (!name) {
        return null;
      }
      const normalizedStatus = ["planned", "active", "resolved", "dropped"].includes(status)
        ? (status as VolumePlotLine["status"])
        : "planned";
      return {
        name,
        status: normalizedStatus,
        note: note.join(" | "),
      };
    })
    .filter((line): line is VolumePlotLine => line !== null);
}

function formatPlotLines(lines: VolumePlotLine[]): string {
  return lines.map((line) => `${line.name} | ${line.status} | ${line.note}`.trim()).join("\n");
}

function parseReleases(value: string) {
  return splitLines(value).map((line) => {
    const separator = line.search(/[|｜]/u);
    if (separator < 0) {
      return { description: line, constraint: null };
    }
    const description = line.slice(0, separator).trim();
    const constraint = line.slice(separator + 1).trim();
    return {
      description,
      constraint: constraint || null,
    };
  });
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function joinLines(values: string[]): string {
  return values.join("\n");
}

function optionalNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  return Number(value);
}

function readinessLabel(status: OutlineReadiness["status"]): string {
  switch (status) {
    case "ready":
      return "已就绪";
    case "partial":
      return "部分就绪";
    case "not_ready":
      return "未就绪";
  }
}

function severityLabel(severity: OutlineReadiness["items"][number]["severity"]): string {
  return severity === "blocker" ? "需补齐" : "建议";
}

function ledgerStatusLabel(status: StoryLedgerEntry["status"]): string {
  switch (status) {
    case "planned":
      return "待埋设";
    case "planted":
      return "已埋设";
    case "progressed":
      return "推进中";
    case "paid_off":
      return "已回收";
    case "failed_payoff":
      return "回收失败";
    case "abandoned":
      return "已放弃";
    case "deferred":
      return "已延期";
  }
}

function chartX(index: number, total: number): number {
  if (total <= 1) {
    return 450;
  }
  return 40 + (index * 820) / (total - 1);
}

function chartY(tension: number): number {
  return 230 - (tension / 100) * 190;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : fallback;
}
