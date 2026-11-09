"use client";

import {
  ArrowLeft,
  Check,
  ChevronRight,
  Circle,
  GitPullRequest,
  Globe2,
  History,
  LoaderCircle,
  Lock,
  Map as MapIcon,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Swords,
  TriangleAlert,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  apiErrorSchema,
  characterDetailResponseSchema,
  confirmedSettingListResponseSchema,
  customFieldDefinitionListResponseSchema,
  customFieldDefinitionResponseSchema,
  factionDetailResponseSchema,
  itemResponseSchema,
  mapDetailResponseSchema,
  powerSystemResponseSchema,
  settingEntityDeleteResponseSchema,
  settingEntityListResponseSchema,
  settingEntityResponseSchema,
  settingEntityVersionListResponseSchema,
  settingChangeRequestListResponseSchema,
  settingChangeRequestResponseSchema,
  settingProposalListResponseSchema,
  settingProposalResponseSchema,
  specialMechanismResponseSchema,
  timelineEventResponseSchema,
  worldTimelineResponseSchema,
  workResponseSchema,
  type ConfirmedSetting,
  type CharacterDetail,
  type CustomFieldDefinition,
  type CustomFieldValue,
  type FactionDetail,
  type ItemDomain,
  type MapDetail,
  type PowerSystem,
  type SettingChangeRequest,
  type SettingConflictType,
  type SettingEntity,
  type SettingEntityCreateRequest,
  type SettingEntityType,
  type SettingEntityVersion,
  type SettingProposal,
  type SpecialMechanism,
  type WorkOverview,
  type WorldTimeline,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";
import { fetchAllCursorPages } from "../lib/cursor-pagination";

type ColumnKey = "world" | "characters" | "factions" | "map" | "power" | "items" | "timeline";

type ViewMode = "columns" | "confirmed" | "fields";
type EditorMode = "create" | "edit" | "change";

type EditorState = {
  mode: EditorMode;
  entityId?: string;
  version?: number;
  type: SettingEntityType;
  name: string;
  aliases: string;
  summary: string;
  description: string;
  tags: string;
  rule: string;
  desire: string;
  fear: string;
  goal: string;
  voiceSample: string;
  voiceGuide: string;
  disguise: string;
  goldenRules: string;
  cost: string;
  limits: string;
  growth: string;
  details: string;
  itemCategory: string;
  itemGrade: string;
  itemEffect: string;
  itemCost: string;
  itemOwnership: string;
  itemLimits: string;
  itemKind: "item" | "technique" | "equipment" | "resource";
  itemOwnershipModel: "shared" | "unique";
  itemConsumable: boolean;
  itemQuantity: number;
  itemEquipmentSlot: string;
  mechanismType: string;
  powerLifespanMode: "none" | "realm" | "fixed" | "custom";
  powerLifespanUnit: string;
  powerLifespanBasis: string;
  powerLifespanDescription: string;
  powerLifespanFixedAmount: string;
  timelineEra: string;
  timelineStoryTime: string;
  timelineStorySortKey: number;
  timelineDuration: string;
  timelineDurationMinutes: number;
  timelineEvent: string;
  timelineValidity: {
    fromChapter: number;
    toChapter: number | null;
    fromStoryTime: { era: string; label: string; sortKey: number } | null;
    toStoryTime: { era: string; label: string; sortKey: number } | null;
  };
  customFields: Record<string, CustomFieldValue | null>;
  requestTitle: string;
  requestReason: string;
};

type ProposalInput = {
  reason: string;
  conflictType: SettingConflictType;
  evidenceLabel: string;
  evidenceQuote: string;
};

type WorldDomainDetail =
  | { kind: "faction"; value: FactionDetail }
  | { kind: "map"; value: MapDetail }
  | { kind: "timeline"; value: WorldTimeline }
  | { kind: "power"; value: PowerSystem }
  | { kind: "mechanism"; value: SpecialMechanism }
  | { kind: "item"; value: ItemDomain };

type EntityDetailSection = "overview" | "relations" | "history" | "references" | "health";

const ENTITY_DETAIL_TABS: Array<{
  key: EntityDetailSection;
  label: string;
  hint: string;
}> = [
  { key: "overview", label: "基本信息", hint: "摘要、状态、认知" },
  { key: "relations", label: "关系", hint: "类型、对象、信息差" },
  { key: "history", label: "状态历史", hint: "按章节追踪变化" },
  { key: "references", label: "引用", hint: "正文、大纲、伏笔" },
  { key: "health", label: "体检", hint: "完整度与冲突" },
];

const ENTITY_DETAIL_TAB_LABELS: Partial<
  Record<SettingEntityType, Partial<Record<EntityDetailSection, string>>>
> = {
  world_rule: { relations: "规则关联", history: "规则变化" },
  faction: { relations: "势力关系", history: "兴衰时间线" },
  map: { relations: "地点关系", history: "控制变化" },
  power_system: { relations: "体系关联", history: "境界变化" },
  golden_finger: { relations: "机制关联", history: "所有权变化" },
  item: { relations: "关联", history: "流转历史" },
  timeline_event: { relations: "时间关联", history: "关键节点" },
};

type FieldFormState = {
  key: string;
  label: string;
  fieldType: CustomFieldDefinition["fieldType"];
  appliesTo: CustomFieldDefinition["appliesTo"];
  required: boolean;
  options: string;
  relationTarget: CustomFieldDefinition["relationTarget"];
  sortOrder: string;
};

const COLUMNS: Array<{
  key: ColumnKey;
  label: string;
  contentLabel: string;
  icon: typeof Globe2;
  supported: boolean;
}> = [
  { key: "world", label: "世界", contentLabel: "世界规则", icon: Globe2, supported: true },
  { key: "factions", label: "势力", contentLabel: "势力", icon: Shield, supported: true },
  { key: "characters", label: "人物", contentLabel: "人物档案", icon: Users, supported: true },
  { key: "map", label: "地图", contentLabel: "地图", icon: MapIcon, supported: true },
  { key: "power", label: "力量体系", contentLabel: "力量体系", icon: Zap, supported: true },
  { key: "items", label: "物品功法", contentLabel: "物品功法", icon: Swords, supported: true },
  { key: "timeline", label: "时间线", contentLabel: "时间线", icon: History, supported: true },
];

const typeLabels: Record<SettingEntityType, string> = {
  world_rule: "世界规则",
  character: "人物档案",
  faction: "势力",
  map: "地图",
  power_system: "力量体系",
  golden_finger: "金手指",
  item: "物品功法",
  timeline_event: "时间线事件",
};

const typeDescriptions: Record<SettingTypeColumn, string> = {
  world_rule: "硬规则与不可违背的世界边界",
  character: "欲望、恐惧、目标、声线与伪装",
  faction: "组织立场、控制范围和人物关系",
  map: "地点层级、路径和场景边界",
  power_system: "层级、路径、突破条件和代价",
  golden_finger: "规则、代价、限制与成长",
  item: "品阶、效果、代价、归属与限制",
  timeline_event: "纪元、故事时间、持续时长与事件",
};

const entityHeroDescriptions: Record<SettingEntityType, string> = {
  world_rule: "不可违背的世界边界",
  character: "人物动机、声线与伪装",
  faction: "组织立场、控制范围与关系",
  map: "区域、路径与场景边界",
  power_system: "层级、路径、突破条件与代价",
  golden_finger: "能力规则、代价与限制",
  item: "品阶、效果、归属与限制",
  timeline_event: "纪元、故事时间与关键节点",
};

type SettingTypeColumn = SettingEntityType;

const sourceLabels: Record<ConfirmedSetting["source"], string> = {
  author: "作者创建",
  import: "导入识别",
  ai: "AI 提案",
  canon: "章节确认",
};

const statusLabels: Record<SettingEntity["status"], string> = {
  draft: "草稿",
  proposed: "待确认",
  locked: "已锁定",
  discarded: "已废弃",
};

const proposalStatusLabels: Record<SettingProposal["status"], string> = {
  pending: "待裁决",
  accepted: "已确认",
  rejected: "已驳回",
};

const changeRequestStatusLabels: Record<SettingChangeRequest["status"], string> = {
  pending: "待分析",
  approved: "已批准",
  rejected: "已驳回",
  applied: "已应用",
};

const impactResourceTypeLabels: Record<
  SettingChangeRequest["impact"]["resources"][number]["type"],
  string
> = {
  chapter: "章节",
  setting: "设定",
  version_node: "版本节点",
};

const powerLifespanModeLabels: Record<PowerSystem["lifespanPolicy"]["mode"], string> = {
  none: "不绑定寿命",
  realm: "按境界绑定",
  fixed: "固定寿命",
  custom: "自定义规则",
};

const itemKindLabels: Record<ItemDomain["kind"], string> = {
  item: "物品",
  technique: "功法",
  equipment: "装备",
  resource: "资源",
};

const itemOwnershipModelLabels: Record<ItemDomain["ownershipModel"], string> = {
  shared: "共享",
  unique: "唯一",
};

const itemRightTypeLabels: Record<ItemDomain["rights"][number]["rightType"], string> = {
  ownership: "归属",
  custody: "保管",
  location: "位置",
  usage: "使用权",
  disposal: "处置权",
};

const relationshipTypeLabels: Record<
  CharacterDetail["relationships"][number]["relationType"],
  string
> = {
  kinship: "亲属",
  ally: "同盟",
  enemy: "敌对",
  mentor: "师承",
  student: "弟子",
  subordinate: "下级",
  superior: "上级",
  member_of: "隶属",
  located_at: "位于",
  controls: "控制",
  owns: "拥有",
};

const characterStateLabels: Record<
  CharacterDetail["stateTransitions"][number]["stateKind"],
  string
> = {
  body: "身体",
  limb: "肢体",
  location: "位置",
  ability: "能力",
  disguise: "伪装",
};

const knowledgeStateLabels: Record<CharacterDetail["knowledgeStates"][number]["state"], string> = {
  knowledge: "已知",
  belief: "相信",
  suspicion: "怀疑",
  misbelief: "误信",
  unknown: "未知",
};

const factionRelationLabels: Record<
  FactionDetail["relationships"][number]["relationType"],
  string
> = {
  ally: "同盟",
  enemy: "敌对",
  vassal: "附庸",
  overlord: "宗主",
  trade: "贸易",
  neutral: "中立",
};

const controlLevelLabels: Record<FactionDetail["territories"][number]["controlLevel"], string> = {
  direct: "直辖",
  military: "军事控制",
  influence: "影响力",
  contested: "争夺中",
};

const mapNodeTypeLabels: Record<MapDetail["nodes"][number]["nodeType"], string> = {
  region: "区域",
  settlement: "聚落",
  landmark: "地标",
  passage: "通道",
  battlefield: "战场",
  sect: "宗门",
  dungeon: "秘境",
  other: "其他",
};

const mapRouteTypeLabels: Record<MapDetail["edges"][number]["routeType"], string> = {
  road: "官道",
  trail: "山径",
  water: "水路",
  air: "空路",
  teleport: "传送",
  secret: "密道",
};

const mapMarkerTypeLabels: Record<MapDetail["markers"][number]["markerType"], string> = {
  danger: "危险",
  event: "事件",
  resource: "资源",
  note: "备注",
  character: "人物",
};

const customFieldTypeLabels: Record<CustomFieldDefinition["fieldType"], string> = {
  text: "文本",
  long_text: "长文本",
  number: "数字",
  date: "日期",
  single_select: "单选",
  multi_select: "多选",
  boolean: "布尔",
  relation_ref: "关系引用",
};

const appliesToLabels: Record<CustomFieldDefinition["appliesTo"], string> = {
  all: "全部设定",
  world_rule: "世界规则",
  character: "人物",
  faction: "势力",
  map: "地图",
  power_system: "力量体系",
  golden_finger: "金手指",
  item: "物品功法",
  timeline_event: "时间线",
};

const conflictTypeLabels: Record<SettingConflictType, string> = {
  none: "无冲突",
  duplicate_name: "重名",
  alias_collision: "别名冲突",
  contradictory_fact: "事实矛盾",
  import_candidate: "导入候选冲突",
  ai_disagreement: "AI 建议分歧",
};

export function SettingsCenter({
  initialColumn,
  initialEntityId,
  workId,
}: {
  initialColumn?: string | undefined;
  initialEntityId?: string | undefined;
  workId: string;
}) {
  const [work, setWork] = useState<WorkOverview | null>(null);
  const [entities, setEntities] = useState<SettingEntity[]>([]);
  const [confirmed, setConfirmed] = useState<ConfirmedSetting[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [proposals, setProposals] = useState<SettingProposal[]>([]);
  const [changeRequests, setChangeRequests] = useState<SettingChangeRequest[]>([]);
  const [versions, setVersions] = useState<SettingEntityVersion[]>([]);
  const [versionHistoryLoading, setVersionHistoryLoading] = useState(false);
  const [versionHistoryError, setVersionHistoryError] = useState("");
  const [characterDetail, setCharacterDetail] = useState<CharacterDetail | null>(null);
  const [characterDetailLoading, setCharacterDetailLoading] = useState(false);
  const [characterDetailError, setCharacterDetailError] = useState("");
  const [worldDetail, setWorldDetail] = useState<WorldDomainDetail | null>(null);
  const [worldDetailLoading, setWorldDetailLoading] = useState(false);
  const [worldDetailError, setWorldDetailError] = useState("");
  const [activeColumn, setActiveColumn] = useState<ColumnKey>("world");
  const [view, setView] = useState<ViewMode>("columns");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SettingEntity["status"]>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const workResponse = await fetch(`/api/v1/works/${workId}`, { cache: "no-store" });
      if (!workResponse.ok) {
        throw new Error(await readError(workResponse, "作品加载失败。"));
      }
      const workData = workResponseSchema.parse(await workResponse.json()).data;
      const basePath = settingsPath(workData);
      const [entityData, confirmedResponse, fieldData] = await Promise.all([
        fetchAllCursorPages(
          `${basePath}/entities`,
          settingEntityListResponseSchema.parse,
          "设定加载失败。",
        ),
        fetch(`${basePath}/facts`, { cache: "no-store" }),
        fetchAllCursorPages(
          `${basePath}/custom-fields`,
          customFieldDefinitionListResponseSchema.parse,
          "自定义字段加载失败。",
        ),
      ]);
      if (!confirmedResponse.ok) {
        throw new Error(await readError(confirmedResponse, "已确认设定加载失败。"));
      }
      setWork(workData);
      setEntities(entityData);
      const requestedEntity = initialEntityId
        ? entityData.find((entity) => entity.id === initialEntityId)
        : undefined;
      if (requestedEntity) {
        setSelectedId(requestedEntity.id);
        setActiveColumn(columnForType(requestedEntity.type));
        setView("columns");
      } else {
        const requestedColumn = COLUMNS.find((column) => column.key === initialColumn);
        if (requestedColumn) {
          setActiveColumn(requestedColumn.key);
        }
      }
      setConfirmed(confirmedSettingListResponseSchema.parse(await confirmedResponse.json()).data);
      setCustomFields(fieldData);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "设定中心加载失败。");
    } finally {
      setLoading(false);
    }
  }, [initialColumn, initialEntityId, workId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function handlePopState() {
      const params = new URLSearchParams(window.location.search);
      const entityId = params.get("entityId");
      const column = params.get("column");
      const nextColumn = COLUMNS.find((candidate) => candidate.key === column);
      if (nextColumn) {
        setActiveColumn(nextColumn.key);
      }
      setView("columns");
      setEditor(null);
      setSelectedId(entityId);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const refreshDetail = useCallback(
    async (entityId: string, entityType: SettingEntityType) => {
      if (!work) {
        return;
      }
      const basePath = settingsPath(work);
      setProposals([]);
      setChangeRequests([]);
      setVersions([]);
      setVersionHistoryLoading(true);
      setVersionHistoryError("");
      const [proposalData, changeRequestData, versionData] = await Promise.all([
        fetchAllCursorPages(
          `${basePath}/entities/${entityId}/proposals`,
          settingProposalListResponseSchema.parse,
          "提案加载失败。",
        ).catch(() => null),
        fetchAllCursorPages(
          `${basePath}/entities/${entityId}/change-requests`,
          settingChangeRequestListResponseSchema.parse,
          "修改请求加载失败。",
        ).catch(() => null),
        fetchAllCursorPages(
          `${basePath}/entities/${entityId}/versions`,
          settingEntityVersionListResponseSchema.parse,
          "版本历史加载失败。",
        ).catch((caught) => {
          setVersionHistoryError(caught instanceof Error ? caught.message : "版本历史加载失败。");
          return [];
        }),
      ]);
      if (proposalData) {
        setProposals(proposalData);
      }
      if (changeRequestData) {
        setChangeRequests(changeRequestData);
      }
      setVersions(versionData);
      setVersionHistoryLoading(false);
      setCharacterDetail(null);
      setCharacterDetailError("");
      setCharacterDetailLoading(false);
      setWorldDetail(null);
      setWorldDetailError("");
      setWorldDetailLoading(false);
      if (entityType === "character") {
        setCharacterDetailLoading(true);
        try {
          const response = await fetch(`${basePath}/characters/${entityId}`, {
            cache: "no-store",
          });
          if (!response.ok) {
            throw new Error(await readError(response, "人物档案加载失败。"));
          }
          setCharacterDetail(characterDetailResponseSchema.parse(await response.json()).data);
        } catch (caught) {
          setCharacterDetailError(caught instanceof Error ? caught.message : "人物档案加载失败。");
        } finally {
          setCharacterDetailLoading(false);
        }
        return;
      }
      if (
        entityType !== "faction" &&
        entityType !== "map" &&
        entityType !== "timeline_event" &&
        entityType !== "power_system" &&
        entityType !== "golden_finger" &&
        entityType !== "item"
      ) {
        return;
      }
      setWorldDetailLoading(true);
      try {
        const path =
          entityType === "faction"
            ? `${basePath}/world/factions/${entityId}`
            : entityType === "map"
              ? `${basePath}/world/maps/${entityId}`
              : entityType === "timeline_event"
                ? `${basePath}/world/timeline`
                : entityType === "power_system"
                  ? `${basePath}/world/power-systems/${entityId}`
                  : entityType === "golden_finger"
                    ? `${basePath}/world/mechanisms/${entityId}`
                    : `${basePath}/world/items/${entityId}`;
        const response = await fetch(path, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(await readError(response, worldDetailErrorLabel(entityType)));
        }
        if (entityType === "faction") {
          setWorldDetail({
            kind: "faction",
            value: factionDetailResponseSchema.parse(await response.json()).data,
          });
        } else if (entityType === "map") {
          setWorldDetail({
            kind: "map",
            value: mapDetailResponseSchema.parse(await response.json()).data,
          });
        } else if (entityType === "timeline_event") {
          setWorldDetail({
            kind: "timeline",
            value: worldTimelineResponseSchema.parse(await response.json()).data,
          });
        } else if (entityType === "power_system") {
          setWorldDetail({
            kind: "power",
            value: powerSystemResponseSchema.parse(await response.json()).data,
          });
        } else if (entityType === "golden_finger") {
          setWorldDetail({
            kind: "mechanism",
            value: specialMechanismResponseSchema.parse(await response.json()).data,
          });
        } else {
          setWorldDetail({
            kind: "item",
            value: itemResponseSchema.parse(await response.json()).data,
          });
        }
      } catch (caught) {
        setWorldDetailError(
          caught instanceof Error ? caught.message : worldDetailErrorLabel(entityType),
        );
      } finally {
        setWorldDetailLoading(false);
      }
    },
    [work],
  );

  const selectedEntity = useMemo(
    () => entities.find((entity) => entity.id === selectedId) ?? null,
    [entities, selectedId],
  );

  useEffect(() => {
    if (view !== "columns" || !selectedEntity) {
      setProposals([]);
      setChangeRequests([]);
      setVersions([]);
      setVersionHistoryError("");
      setVersionHistoryLoading(false);
      setCharacterDetail(null);
      setCharacterDetailError("");
      setCharacterDetailLoading(false);
      setWorldDetail(null);
      setWorldDetailError("");
      setWorldDetailLoading(false);
      return;
    }
    void refreshDetail(selectedEntity.id, selectedEntity.type);
  }, [refreshDetail, selectedEntity, view]);

  const counts = useMemo(() => {
    return {
      world: entities.filter((entity) => entity.type === "world_rule").length,
      characters: entities.filter((entity) => entity.type === "character").length,
      factions: entities.filter((entity) => entity.type === "faction").length,
      map: entities.filter((entity) => entity.type === "map").length,
      power: entities.filter(
        (entity) => entity.type === "power_system" || entity.type === "golden_finger",
      ).length,
      items: entities.filter((entity) => entity.type === "item").length,
      timeline: entities.filter((entity) => entity.type === "timeline_event").length,
    } satisfies Record<ColumnKey, number>;
  }, [entities]);

  const selected =
    view === "columns" ? (entities.find((entity) => entity.id === selectedId) ?? null) : null;

  const openEntityDetail = useCallback(
    (entityId: string, column?: ColumnKey) => {
      const entity = entities.find((candidate) => candidate.id === entityId);
      const resolvedColumn = column ?? (entity ? columnForType(entity.type) : activeColumn);
      setSelectedId(entityId);
      setActiveColumn(resolvedColumn);
      setView("columns");
      if (typeof window !== "undefined") {
        const url = settingsUrl(workId, resolvedColumn, entityId);
        const alreadyInDetail = Boolean(window.history.state?.novelBrainEntityDetail);
        window.history[alreadyInDetail ? "replaceState" : "pushState"](
          { ...window.history.state, novelBrainEntityDetail: true },
          "",
          url,
        );
      }
    },
    [activeColumn, entities, workId],
  );

  const closeEntityDetail = useCallback(() => {
    setSelectedId(null);
    setEditor(null);
    if (typeof window === "undefined") {
      return;
    }
    if (window.history.state?.novelBrainEntityDetail) {
      window.history.back();
      return;
    }
    window.history.replaceState(
      { ...window.history.state, novelBrainEntityDetail: false },
      "",
      settingsUrl(workId, activeColumn),
    );
  }, [activeColumn, workId]);

  async function refreshProjection() {
    if (!work) {
      return;
    }
    const basePath = settingsPath(work);
    const [entityData, confirmedResponse, fieldData] = await Promise.all([
      fetchAllCursorPages(
        `${basePath}/entities`,
        settingEntityListResponseSchema.parse,
        "设定加载失败。",
      ),
      fetch(`${basePath}/facts`, { cache: "no-store" }),
      fetchAllCursorPages(
        `${basePath}/custom-fields`,
        customFieldDefinitionListResponseSchema.parse,
        "自定义字段加载失败。",
      ),
    ]);
    setEntities(entityData);
    if (confirmedResponse.ok) {
      setConfirmed(confirmedSettingListResponseSchema.parse(await confirmedResponse.json()).data);
    }
    setCustomFields(fieldData);
  }

  async function createEntity() {
    if (!work || !editor) {
      return;
    }
    setBusy("save");
    setActionError("");
    setNotice("");
    try {
      if (editor.type === "character") {
        const created = await createCharacterEntity(work, editor);
        setEditor(null);
        openEntityDetail(created.id, "characters");
        setNotice(`“${created.name}”已创建。`);
        await refreshProjection();
        return;
      }
      if (editor.type === "faction" || editor.type === "map") {
        const created = await createWorldEntity(work, editor);
        setEditor(null);
        openEntityDetail(created.id, columnForType(editor.type));
        setNotice(`“${created.name}”已创建。`);
        await refreshProjection();
        return;
      }
      if (
        editor.type === "power_system" ||
        editor.type === "golden_finger" ||
        editor.type === "item"
      ) {
        const created = await createPowerItemEntity(work, editor);
        setEditor(null);
        openEntityDetail(created.id, columnForType(editor.type));
        setNotice(`“${created.name}”已创建。`);
        await refreshProjection();
        return;
      }
      const created = await mutateEntity(
        `${settingsPath(work)}/entities`,
        "POST",
        createPayload(editor),
        "设定创建失败。",
      );
      setEntities((current) => [...current, created]);
      setEditor(null);
      openEntityDetail(created.id, columnForType(created.type));
      setNotice(`“${created.name}”已创建。`);
      await refreshProjection();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "设定创建失败。");
    } finally {
      setBusy("");
    }
  }

  async function saveEntity() {
    if (!work || !editor || !editor.entityId || !editor.version) {
      return;
    }
    setBusy("save");
    setActionError("");
    setNotice("");
    try {
      if (editor.mode === "change") {
        const request = await mutateChangeRequest(
          `${settingsPath(work)}/entities/${editor.entityId}/change-requests`,
          {
            version: editor.version,
            title: editor.requestTitle.trim(),
            reason: editor.requestReason.trim(),
            after: changePayload(editor),
            conflictType: "none",
            evidence: [authorNote(editor.requestReason)],
          },
          "修改请求提交失败。",
        );
        setChangeRequests((current) => [...current, request]);
        setEditor(null);
        setNotice(`“${request.title}”已提交。${request.impact.message}`);
        await refreshDetail(editor.entityId, editor.type);
        return;
      }
      if (
        editor.type === "power_system" ||
        editor.type === "golden_finger" ||
        editor.type === "item"
      ) {
        const updated = await updatePowerItemEntity(work, editor);
        setEditor(null);
        openEntityDetail(updated.id, columnForType(editor.type));
        setNotice(`“${updated.name}”已保存。`);
        await refreshProjection();
        await refreshDetail(updated.id, editor.type);
        return;
      }
      if (editor.type === "character") {
        const updated = await updateCharacterEntity(work, editor);
        setEditor(null);
        openEntityDetail(updated.id, "characters");
        setNotice(`“${updated.name}”已保存。`);
        await refreshProjection();
        await refreshDetail(updated.id, editor.type);
        return;
      }
      if (editor.type === "faction" || editor.type === "map" || editor.type === "timeline_event") {
        const updated = await updateWorldEntity(work, editor);
        setEditor(null);
        openEntityDetail(updated.id, columnForType(editor.type));
        setNotice(`“${updated.name}”已保存。`);
        await refreshProjection();
        await refreshDetail(updated.id, editor.type);
        return;
      }
      const updated = await mutateEntity(
        `${settingsPath(work)}/entities/${editor.entityId}`,
        "PATCH",
        patchPayload(editor),
        "设定保存失败。",
      );
      setEntities((current) =>
        current.map((entity) => (entity.id === updated.id ? updated : entity)),
      );
      setEditor(null);
      openEntityDetail(updated.id, columnForType(updated.type));
      setNotice(`“${updated.name}”已保存。`);
      await refreshProjection();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "设定保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function createProposal(entity: SettingEntity, input: ProposalInput) {
    if (!work) {
      return;
    }
    setBusy(`proposal-${entity.id}`);
    setActionError("");
    setNotice("");
    try {
      const proposal = await mutateProposal(
        `${settingsPath(work)}/entities/${entity.id}/proposals`,
        {
          version: entity.version,
          reason: input.reason.trim(),
          conflictType: input.conflictType,
          evidence: [
            {
              kind: "author_note",
              sourceId: null,
              label: input.evidenceLabel.trim() || "作者说明",
              quote: input.evidenceQuote.trim() || input.reason.trim(),
              locator: "",
              confidence: null,
            },
          ],
        },
        "提案提交失败。",
      );
      setProposals((current) => [...current, proposal]);
      await refreshProjection();
      await refreshDetail(entity.id, entity.type);
      setNotice(`“${entity.name}”已提交提案，等待裁决。`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "提案提交失败。");
    } finally {
      setBusy("");
    }
  }

  async function decideProposal(
    entity: SettingEntity,
    proposal: SettingProposal,
    decision: "accept" | "reject",
    reason: string,
  ) {
    if (!work) {
      return;
    }
    setBusy(`decision-${proposal.id}`);
    setActionError("");
    setNotice("");
    try {
      const decided = await mutateProposal(
        `${settingsPath(work)}/entities/${entity.id}/proposals/${proposal.id}/decision`,
        {
          decision,
          reason: reason.trim() || (decision === "accept" ? "作者确认提案" : "作者驳回提案"),
          conflictType: decision === "accept" ? "none" : proposal.conflictType,
          evidence: proposal.evidence.length > 0 ? proposal.evidence : [authorNote(reason)],
        },
        decision === "accept" ? "提案确认失败。" : "提案驳回失败。",
      );
      setProposals((current) =>
        current.map((candidate) => (candidate.id === decided.id ? decided : candidate)),
      );
      await refreshProjection();
      await refreshDetail(entity.id, entity.type);
      setNotice(decision === "accept" ? "提案已确认并锁定。" : "提案已驳回，设定已废弃。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "提案裁决失败。");
    } finally {
      setBusy("");
    }
  }

  async function createCustomField(form: FieldFormState) {
    if (!work) {
      return;
    }
    setBusy("custom-field");
    setActionError("");
    setNotice("");
    try {
      const definition = await mutateCustomField(
        `${settingsPath(work)}/custom-fields`,
        "POST",
        {
          key: form.key.trim(),
          label: form.label.trim(),
          fieldType: form.fieldType,
          appliesTo: form.appliesTo,
          required: form.required,
          options: splitList(form.options),
          relationTarget: form.relationTarget,
          sortOrder: Number(form.sortOrder) || 0,
        },
        "自定义字段创建失败。",
      );
      setCustomFields((current) => [...current, definition]);
      setNotice(`字段“${definition.label}”已创建。`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "自定义字段创建失败。");
    } finally {
      setBusy("");
    }
  }

  async function toggleCustomField(definition: CustomFieldDefinition) {
    if (!work) {
      return;
    }
    setBusy(`field-${definition.id}`);
    setActionError("");
    setNotice("");
    try {
      const updated = await mutateCustomField(
        `${settingsPath(work)}/custom-fields/${definition.id}`,
        "PATCH",
        { schemaVersion: definition.schemaVersion, enabled: !definition.enabled },
        "自定义字段更新失败。",
      );
      setCustomFields((current) =>
        current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      setNotice(`字段“${updated.label}”已${updated.enabled ? "启用" : "停用"}。`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "自定义字段更新失败。");
    } finally {
      setBusy("");
    }
  }

  async function lockEntity(entity: SettingEntity) {
    if (!work) {
      return;
    }
    setBusy(`lock-${entity.id}`);
    setActionError("");
    setNotice("");
    try {
      const locked = await mutateEntity(
        `${settingsPath(work)}/entities/${entity.id}/lock`,
        "POST",
        { version: entity.version },
        "设定锁定失败。",
      );
      setEntities((current) =>
        current.map((candidate) => (candidate.id === locked.id ? locked : candidate)),
      );
      setEditor(null);
      openEntityDetail(locked.id, columnForType(locked.type));
      setNotice(`“${locked.name}”已锁定并进入已确认设定。`);
      await refreshProjection();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "设定锁定失败。");
    } finally {
      setBusy("");
    }
  }

  async function restoreEntity(
    entity: SettingEntity,
    targetVersion: number,
    reason: string,
  ): Promise<boolean> {
    if (!work) {
      return false;
    }
    setBusy(`restore-${entity.id}`);
    setActionError("");
    setNotice("");
    try {
      const restored = await mutateEntity(
        `${settingsPath(work)}/entities/${entity.id}/restore`,
        "POST",
        {
          version: entity.version,
          targetVersion,
          reason,
        },
        "恢复设定版本失败。",
      );
      setEntities((current) =>
        current.map((candidate) => (candidate.id === restored.id ? restored : candidate)),
      );
      setNotice(
        `“${restored.name}”已恢复到第 ${targetVersion} 版，并生成第 ${restored.version} 版。`,
      );
      try {
        await refreshProjection();
        await refreshDetail(restored.id, restored.type);
      } catch (caught) {
        setActionError(
          caught instanceof Error
            ? `版本已恢复，但页面刷新失败：${caught.message}`
            : "版本已恢复，但页面刷新失败，请重新加载。",
        );
      }
      return true;
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "恢复设定版本失败。");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function deleteEntity(entity: SettingEntity) {
    if (!work) {
      return;
    }
    if (!window.confirm(`确定删除“${entity.name}”吗？`)) {
      return;
    }
    setBusy(`delete-${entity.id}`);
    setActionError("");
    setNotice("");
    try {
      const response = await mutateDelete(
        `${settingsPath(work)}/entities/${entity.id}`,
        "设定删除失败。",
      );
      if (!response.deleted) {
        throw new Error("设定删除失败。");
      }
      setEntities((current) => current.filter((candidate) => candidate.id !== entity.id));
      closeEntityDetail();
      setNotice(`“${entity.name}”已删除。`);
      await refreshProjection();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "设定删除失败。");
    } finally {
      setBusy("");
    }
  }

  function selectColumn(key: ColumnKey) {
    setActiveColumn(key);
    setView("columns");
    setEditor(null);
    setActionError("");
    if (typeof window !== "undefined") {
      window.history.replaceState({ ...window.history.state }, "", settingsUrl(workId, key));
    }
  }

  function beginCreate(type: SettingEntityType = "world_rule") {
    setView("columns");
    setEditor(emptyEditor(type));
    setActionError("");
    setNotice("");
  }

  function withDomainDetail(next: EditorState, entity: SettingEntity): EditorState {
    if (entity.type === "character" && characterDetail) {
      next.desire = characterDetail.profile.desire;
      next.fear = characterDetail.profile.fear;
      next.goal = characterDetail.profile.goal;
      next.voiceSample = characterDetail.profile.voiceSample;
      next.voiceGuide = characterDetail.profile.voiceGuide;
      next.disguise = characterDetail.profile.disguise;
    }
    if (entity.type === "power_system" && worldDetail?.kind === "power") {
      next.details = worldDetail.value.overview;
      next.powerLifespanMode = worldDetail.value.lifespanPolicy.mode;
      next.powerLifespanUnit = worldDetail.value.lifespanPolicy.unit;
      next.powerLifespanBasis = worldDetail.value.lifespanPolicy.basis;
      next.powerLifespanDescription = worldDetail.value.lifespanPolicy.description;
      next.powerLifespanFixedAmount =
        worldDetail.value.lifespanPolicy.fixedAmount?.toString() ?? "";
    }
    if (entity.type === "item" && worldDetail?.kind === "item") {
      next.itemKind = worldDetail.value.kind;
      next.itemOwnershipModel = worldDetail.value.ownershipModel;
      next.itemConsumable = worldDetail.value.consumable;
      next.itemQuantity = worldDetail.value.quantity;
      next.itemEquipmentSlot = worldDetail.value.equipmentSlot ?? "";
    }
    if (entity.type === "golden_finger" && worldDetail?.kind === "mechanism") {
      next.mechanismType = worldDetail.value.mechanismType;
    }
    if (entity.type === "timeline_event" && worldDetail?.kind === "timeline") {
      const detail = worldDetail.value.events.find((candidate) => candidate.event.id === entity.id);
      if (detail) {
        next.timelineStorySortKey = detail.storyTime.sortKey;
        next.timelineDurationMinutes = detail.durationMinutes;
        next.timelineValidity = detail.validity;
      }
    }
    return next;
  }

  function beginEdit(entity: SettingEntity, focus: "general" | "alias" = "general") {
    const next = withDomainDetail(editorFromEntity(entity), entity);
    setEditor(next);
    setActionError("");
    setNotice("");
    window.setTimeout(() => {
      const id = focus === "alias" ? "setting-aliases" : "setting-name";
      document.getElementById(id)?.focus();
    }, 0);
  }

  function beginChangeRequest(entity: SettingEntity) {
    const next = withDomainDetail(editorFromEntity(entity), entity);
    next.mode = "change";
    next.requestTitle = `修改“${entity.name}”`;
    next.requestReason = "";
    setEditor(next);
    setActionError("");
    setNotice("");
  }

  if (loading) {
    return (
      <section className="panel works-loading" aria-label="正在加载设定中心">
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
        正在加载设定中心
      </section>
    );
  }

  if (error || !work) {
    return (
      <section className="works-error" role="alert">
        <TriangleAlert size={18} aria-hidden="true" />
        <span>{error || "设定中心加载失败。"}</span>
        <button className="text-btn small" onClick={load} type="button">
          重试
        </button>
      </section>
    );
  }

  if (selected && !editor) {
    return (
      <>
        {actionError ? (
          <div className="settings-center-notice danger" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{actionError}</span>
          </div>
        ) : null}
        {notice ? (
          <div className="settings-center-notice success" role="status">
            <Check size={16} aria-hidden="true" />
            <span>{notice}</span>
          </div>
        ) : null}
        <EntityDetail
          changeRequests={changeRequests}
          busy={busy}
          characterDetail={characterDetail}
          characterDetailError={characterDetailError}
          characterDetailLoading={characterDetailLoading}
          customFieldDefinitions={customFields}
          entity={selected}
          key={selected.id}
          onBack={closeEntityDetail}
          onChangeRequest={() => beginChangeRequest(selected)}
          onCreateProposal={(input) => createProposal(selected, input)}
          onDelete={() => deleteEntity(selected)}
          onDecideProposal={(proposal, decision, reason) =>
            decideProposal(selected, proposal, decision, reason)
          }
          onEdit={() => beginEdit(selected)}
          onEditAlias={() => beginEdit(selected, "alias")}
          onLock={() => lockEntity(selected)}
          onRetryCharacterDetail={() => refreshDetail(selected.id, selected.type)}
          onRetryVersionHistory={() => refreshDetail(selected.id, selected.type)}
          onRestore={(targetVersion, reason) => restoreEntity(selected, targetVersion, reason)}
          onRetryWorldDetail={() => refreshDetail(selected.id, selected.type)}
          proposals={proposals}
          versionHistoryError={versionHistoryError}
          versionHistoryLoading={versionHistoryLoading}
          versions={versions}
          worldDetail={worldDetail}
          worldDetailError={worldDetailError}
          worldDetailLoading={worldDetailLoading}
        />
      </>
    );
  }

  const activeColumnMeta = COLUMNS.find((column) => column.key === activeColumn) ?? COLUMNS[0]!;
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const columnEntities = entitiesForColumn(entities, activeColumn);
  const visibleEntities = columnEntities.filter((entity) => {
    if (statusFilter !== "all" && entity.status !== statusFilter) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return [entity.name, entity.summary, entity.description, ...entity.aliases].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    );
  });
  const hasActiveFilter = normalizedQuery.length > 0 || statusFilter !== "all";
  const recentEntities = [...entities]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 5);

  return (
    <>
      <section className="page-head settings-head">
        <div>
          <p className="eyebrow">作品设定</p>
          <div className="title-with-badge">
            <h1>设定中心</h1>
            <span className="badge">{work.title}</span>
            <span className="badge">{confirmed.length} 条已确认</span>
          </div>
          <p className="page-sub">把世界规则、人物状态和金手指整理成后续写作能遵守的边界。</p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-ghost" href={`/workspace/${workId}/overview`}>
            <ArrowLeft size={15} aria-hidden="true" />
            返回总览
          </Link>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setView("fields");
              setEditor(null);
              setActionError("");
            }}
            type="button"
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            自定义字段
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setView("confirmed");
              setEditor(null);
              setActionError("");
            }}
            type="button"
          >
            <Check size={15} aria-hidden="true" />
            查看已确认设定
          </button>
        </div>
      </section>

      {actionError ? (
        <div className="settings-center-notice danger" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="settings-center-notice success" role="status">
          <Check size={16} aria-hidden="true" />
          <span>{notice}</span>
        </div>
      ) : null}

      {view === "columns" && !editor ? (
        <>
          <div className="settings-toolbar">
            <label className="mini-search">
              <Search size={15} aria-hidden="true" />
              <input
                aria-label="搜索设定"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索名称、别名或摘要"
                value={searchQuery}
              />
            </label>
            <select
              aria-label="按状态筛选"
              className="select"
              onChange={(event) =>
                setStatusFilter(event.target.value as "all" | SettingEntity["status"])
              }
              value={statusFilter}
            >
              <option value="all">全部状态</option>
              <option value="draft">草稿</option>
              <option value="proposed">待确认</option>
              <option value="locked">已锁定</option>
              <option value="discarded">已废弃</option>
            </select>
            <button className="btn btn-primary" onClick={() => beginCreate()} type="button">
              <Plus size={15} aria-hidden="true" />
              新增设定
            </button>
          </div>

          {recentEntities.length > 0 ? (
            <section className="panel settings-recent" aria-label="最近更新的设定">
              <div className="settings-recent-head">
                <span className="panel-kicker">最近更新</span>
                <strong>继续处理手头的设定</strong>
              </div>
              <div className="settings-recent-list">
                {recentEntities.map((entity) => (
                  <button
                    aria-label={`打开${entity.name}的设定详情`}
                    className="settings-recent-item"
                    key={entity.id}
                    onClick={() => openEntityDetail(entity.id)}
                    type="button"
                  >
                    <span>{typeLabels[entity.type]}</span>
                    <strong>{entity.name}</strong>
                    <small>
                      {statusLabels[entity.status]} · 第 {entity.version} 版
                    </small>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      <div className="settings-workspace-grid">
        <aside className="panel settings-column-nav" aria-label="设定分类">
          <div className="settings-column-nav-head">
            <span className="panel-kicker">设定分类</span>
            <strong>7 个栏目</strong>
          </div>
          {COLUMNS.map((column) => {
            const Icon = column.icon;
            const active = view === "columns" && activeColumn === column.key;
            return (
              <button
                aria-current={active ? "page" : undefined}
                className={`settings-column-item${active ? " active" : ""}`}
                key={column.key}
                onClick={() => selectColumn(column.key)}
                type="button"
              >
                <Icon size={17} aria-hidden="true" />
                <span>{column.label}</span>
                <small>{counts[column.key]}</small>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            );
          })}
          <div className="settings-column-note">
            <Sparkles size={15} aria-hidden="true" />
            <span>七个栏目都使用真实设定数据；锁定或提案中的条目要先完成状态流转。</span>
          </div>
        </aside>

        <main className="settings-content">
          {view === "confirmed" ? (
            <ConfirmedSettings items={confirmed} />
          ) : view === "fields" ? (
            <CustomFieldsPanel
              busy={busy}
              definitions={customFields}
              onCreate={createCustomField}
              onToggle={toggleCustomField}
            />
          ) : editor ? (
            <SettingEditor
              busy={busy === "save"}
              customFieldDefinitions={customFields}
              editor={editor}
              entities={entities}
              onCancel={() => setEditor(null)}
              onChange={setEditor}
              onSave={() => (editor.mode === "create" ? createEntity() : saveEntity())}
            />
          ) : (
            <section aria-labelledby="settings-column-title">
              <div className="panel settings-column-head">
                <div>
                  <span className="panel-kicker">
                    第 {COLUMNS.indexOf(activeColumnMeta) + 1} 栏
                  </span>
                  <h2 id="settings-column-title">{activeColumnMeta.contentLabel}</h2>
                  <p>{columnDescription(activeColumn)}</p>
                </div>
                {activeColumnMeta.supported ? (
                  <button
                    className="btn btn-primary btn-small"
                    onClick={() => beginCreate(typeForColumn(activeColumn))}
                    type="button"
                  >
                    <Plus size={14} aria-hidden="true" />
                    新增{activeColumnMeta.contentLabel}
                  </button>
                ) : (
                  <span className="badge">后续开放</span>
                )}
              </div>

              {visibleEntities.length === 0 ? (
                hasActiveFilter ? (
                  <div className="panel settings-column-empty">
                    <Search size={18} aria-hidden="true" />
                    <h2>没有匹配的设定</h2>
                    <p>试试换一个关键词，或把状态筛选切回全部。</p>
                    <button
                      className="btn btn-ghost btn-small"
                      onClick={() => {
                        setSearchQuery("");
                        setStatusFilter("all");
                      }}
                      type="button"
                    >
                      清除筛选
                    </button>
                  </div>
                ) : (
                  <ColumnEmptyState
                    label={activeColumnMeta.contentLabel}
                    onCreate={() => beginCreate(typeForColumn(activeColumn))}
                  />
                )
              ) : (
                <div className="settings-entity-list">
                  {visibleEntities.map((entity) => (
                    <EntityCard entity={entity} key={entity.id} onOpen={openEntityDetail} />
                  ))}
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </>
  );
}

function SettingEditor({
  busy,
  customFieldDefinitions,
  editor,
  entities,
  onCancel,
  onChange,
  onSave,
}: {
  busy: boolean;
  customFieldDefinitions: CustomFieldDefinition[];
  editor: EditorState;
  entities: SettingEntity[];
  onCancel: () => void;
  onChange: (editor: EditorState) => void;
  onSave: () => void;
}) {
  const update = <Key extends keyof EditorState>(field: Key, value: EditorState[Key]) => {
    onChange({ ...editor, [field]: value });
  };
  const applicableFields = customFieldDefinitions.filter(
    (definition) =>
      definition.enabled &&
      (definition.appliesTo === "all" || definition.appliesTo === editor.type),
  );
  const changeMode = editor.mode === "change";

  return (
    <section className="panel settings-editor" aria-labelledby="settings-editor-title">
      <div className="panel-head">
        <div>
          <span className="panel-kicker">
            {editor.mode === "create" ? "新增设定" : changeMode ? "修改请求" : "编辑设定"}
          </span>
          <h2 id="settings-editor-title">
            {editor.mode === "create"
              ? "先写清最小结构"
              : changeMode
                ? "锁定设定只能提交修改请求"
                : editor.name}
          </h2>
        </div>
        <button className="text-btn small" onClick={onCancel} type="button">
          取消
        </button>
      </div>

      {changeMode ? (
        <div className="settings-form-grid settings-change-request-form">
          <label className="settings-field">
            <span>修改标题</span>
            <input
              maxLength={120}
              onChange={(event) => update("requestTitle", event.target.value)}
              required
              value={editor.requestTitle}
            />
          </label>
          <label className="settings-field settings-field-wide">
            <span>修改原因</span>
            <textarea
              onChange={(event) => update("requestReason", event.target.value)}
              placeholder="说明正文、设定或连续性检查为什么需要这次修改"
              required
              rows={3}
              value={editor.requestReason}
            />
          </label>
        </div>
      ) : null}

      <div className="settings-form-grid">
        <label className="settings-field">
          <span>设定类型</span>
          <select
            disabled={editor.mode !== "create"}
            onChange={(event) => {
              const type = event.target.value as SettingEntityType;
              const next = emptyEditor(type);
              next.mode = editor.mode;
              if (editor.entityId) {
                next.entityId = editor.entityId;
              }
              if (editor.version) {
                next.version = editor.version;
              }
              onChange(next);
            }}
            value={editor.type}
          >
            <option value="world_rule">世界规则</option>
            <option value="character">人物档案</option>
            <option value="faction">势力</option>
            <option value="map">地图</option>
            <option value="power_system">力量体系</option>
            <option value="golden_finger">金手指</option>
            <option value="item">物品功法</option>
            <option value="timeline_event">时间线事件</option>
          </select>
        </label>
        <label className="settings-field">
          <span>名称</span>
          <input
            id="setting-name"
            maxLength={120}
            onChange={(event) => update("name", event.target.value)}
            required
            value={editor.name}
          />
        </label>
        <label className="settings-field settings-field-wide">
          <span>别名</span>
          <input
            id="setting-aliases"
            onChange={(event) => update("aliases", event.target.value)}
            placeholder="用逗号分隔"
            value={editor.aliases}
          />
        </label>
        <label className="settings-field settings-field-wide">
          <span>一句话摘要</span>
          <input
            maxLength={500}
            onChange={(event) => update("summary", event.target.value)}
            required
            value={editor.summary}
          />
        </label>
        <label className="settings-field settings-field-wide">
          <span>详细说明</span>
          <textarea
            onChange={(event) => update("description", event.target.value)}
            rows={3}
            value={editor.description}
          />
        </label>
        <label className="settings-field settings-field-wide">
          <span>标签</span>
          <input
            onChange={(event) => update("tags", event.target.value)}
            placeholder="用逗号分隔"
            value={editor.tags}
          />
        </label>
      </div>

      <div className="settings-type-fields">
        <h3>{typeLabels[editor.type]}</h3>
        <p>{typeDescriptions[editor.type]}</p>
        {editor.type === "world_rule" ? (
          <label className="settings-field">
            <span>世界规则</span>
            <textarea
              onChange={(event) => update("rule", event.target.value)}
              required
              rows={4}
              value={editor.rule}
            />
          </label>
        ) : editor.type === "character" ? (
          <div className="settings-form-grid">
            <label className="settings-field settings-field-wide">
              <span>人物欲望</span>
              <textarea
                onChange={(event) => update("desire", event.target.value)}
                rows={3}
                value={editor.desire}
              />
            </label>
            <label className="settings-field settings-field-wide">
              <span>人物恐惧</span>
              <textarea
                onChange={(event) => update("fear", event.target.value)}
                rows={3}
                value={editor.fear}
              />
            </label>
            <label className="settings-field settings-field-wide">
              <span>人物目标</span>
              <textarea
                onChange={(event) => update("goal", event.target.value)}
                rows={3}
                value={editor.goal}
              />
            </label>
            <label className="settings-field settings-field-wide">
              <span>声纹样本</span>
              <textarea
                onChange={(event) => update("voiceSample", event.target.value)}
                rows={3}
                value={editor.voiceSample}
              />
            </label>
            <label className="settings-field settings-field-wide">
              <span>声线指南</span>
              <textarea
                onChange={(event) => update("voiceGuide", event.target.value)}
                rows={3}
                value={editor.voiceGuide}
              />
            </label>
            <label className="settings-field settings-field-wide">
              <span>伪装</span>
              <textarea
                onChange={(event) => update("disguise", event.target.value)}
                rows={3}
                value={editor.disguise}
              />
            </label>
          </div>
        ) : editor.type === "faction" || editor.type === "map" ? (
          <label className="settings-field">
            <span>{typeLabels[editor.type]}</span>
            <textarea
              onChange={(event) => update("details", event.target.value)}
              required
              rows={4}
              value={editor.details}
            />
          </label>
        ) : editor.type === "power_system" ? (
          <div className="settings-form-grid">
            <label className="settings-field settings-field-wide">
              <span>力量体系</span>
              <textarea
                onChange={(event) => update("details", event.target.value)}
                required
                rows={4}
                value={editor.details}
              />
            </label>
            <label className="settings-field">
              <span>寿命绑定</span>
              <select
                onChange={(event) =>
                  update(
                    "powerLifespanMode",
                    event.target.value as EditorState["powerLifespanMode"],
                  )
                }
                value={editor.powerLifespanMode}
              >
                <option value="none">不绑定寿命</option>
                <option value="realm">按境界绑定</option>
                <option value="fixed">固定寿命</option>
                <option value="custom">自定义规则</option>
              </select>
            </label>
            <label className="settings-field">
              <span>寿命单位</span>
              <input
                onChange={(event) => update("powerLifespanUnit", event.target.value)}
                value={editor.powerLifespanUnit}
              />
            </label>
            <label className="settings-field">
              <span>寿命依据</span>
              <input
                onChange={(event) => update("powerLifespanBasis", event.target.value)}
                value={editor.powerLifespanBasis}
              />
            </label>
            {editor.powerLifespanMode === "fixed" ? (
              <label className="settings-field">
                <span>固定寿命</span>
                <input
                  min={1}
                  onChange={(event) => update("powerLifespanFixedAmount", event.target.value)}
                  type="number"
                  value={editor.powerLifespanFixedAmount}
                />
              </label>
            ) : null}
            <label className="settings-field settings-field-wide">
              <span>寿命规则说明</span>
              <input
                onChange={(event) => update("powerLifespanDescription", event.target.value)}
                value={editor.powerLifespanDescription}
              />
            </label>
          </div>
        ) : editor.type === "item" ? (
          <div className="settings-form-grid">
            <label className="settings-field">
              <span>物品类型</span>
              <select
                onChange={(event) =>
                  update("itemKind", event.target.value as EditorState["itemKind"])
                }
                value={editor.itemKind}
              >
                <option value="item">物品</option>
                <option value="technique">功法</option>
                <option value="equipment">装备</option>
                <option value="resource">资源</option>
              </select>
            </label>
            <label className="settings-field">
              <span>分类</span>
              <input
                onChange={(event) => update("itemCategory", event.target.value)}
                required
                value={editor.itemCategory}
              />
            </label>
            <label className="settings-field">
              <span>品阶</span>
              <input
                onChange={(event) => update("itemGrade", event.target.value)}
                value={editor.itemGrade}
              />
            </label>
            <label className="settings-field settings-field-wide">
              <span>效果</span>
              <textarea
                onChange={(event) => update("itemEffect", event.target.value)}
                required
                rows={3}
                value={editor.itemEffect}
              />
            </label>
            <label className="settings-field">
              <span>代价</span>
              <textarea
                onChange={(event) => update("itemCost", event.target.value)}
                rows={3}
                value={editor.itemCost}
              />
            </label>
            <label className="settings-field">
              <span>归属方式</span>
              <select
                onChange={(event) =>
                  update(
                    "itemOwnershipModel",
                    event.target.value as EditorState["itemOwnershipModel"],
                  )
                }
                value={editor.itemOwnershipModel}
              >
                <option value="shared">共享</option>
                <option value="unique">唯一</option>
              </select>
            </label>
            <label className="settings-field">
              <span>数量</span>
              <input
                min={1}
                onChange={(event) => update("itemQuantity", Number(event.target.value))}
                type="number"
                value={editor.itemOwnershipModel === "unique" ? 1 : editor.itemQuantity}
              />
            </label>
            <label className="settings-field settings-field-wide">
              <span>装备位</span>
              <input
                disabled={editor.itemKind !== "equipment"}
                onChange={(event) => update("itemEquipmentSlot", event.target.value)}
                placeholder="例如 main_hand"
                value={editor.itemEquipmentSlot}
              />
            </label>
            <label className="settings-field settings-checkbox-field">
              <input
                checked={editor.itemConsumable}
                onChange={(event) => update("itemConsumable", event.target.checked)}
                type="checkbox"
              />
              <span>消耗品</span>
            </label>
            <label className="settings-field settings-field-wide">
              <span>限制</span>
              <textarea
                onChange={(event) => update("itemLimits", event.target.value)}
                rows={3}
                value={editor.itemLimits}
              />
            </label>
          </div>
        ) : editor.type === "timeline_event" ? (
          <div className="settings-form-grid">
            <label className="settings-field">
              <span>纪元</span>
              <input
                onChange={(event) => update("timelineEra", event.target.value)}
                value={editor.timelineEra}
              />
            </label>
            <label className="settings-field">
              <span>故事时间</span>
              <input
                onChange={(event) => update("timelineStoryTime", event.target.value)}
                required
                value={editor.timelineStoryTime}
              />
            </label>
            <label className="settings-field">
              <span>持续时长</span>
              <input
                onChange={(event) => update("timelineDuration", event.target.value)}
                value={editor.timelineDuration}
              />
            </label>
            <label className="settings-field settings-field-wide">
              <span>事件</span>
              <textarea
                onChange={(event) => update("timelineEvent", event.target.value)}
                required
                rows={4}
                value={editor.timelineEvent}
              />
            </label>
          </div>
        ) : (
          <div className="settings-form-grid">
            <label className="settings-field">
              <span>机制类型</span>
              <input
                onChange={(event) => update("mechanismType", event.target.value)}
                required
                value={editor.mechanismType}
              />
            </label>
            <label className="settings-field">
              <span>规则</span>
              <textarea
                onChange={(event) => update("goldenRules", event.target.value)}
                required
                rows={3}
                value={editor.goldenRules}
              />
            </label>
            <label className="settings-field">
              <span>代价</span>
              <textarea
                onChange={(event) => update("cost", event.target.value)}
                required
                rows={3}
                value={editor.cost}
              />
            </label>
            <label className="settings-field">
              <span>限制</span>
              <textarea
                onChange={(event) => update("limits", event.target.value)}
                required
                rows={3}
                value={editor.limits}
              />
            </label>
            <label className="settings-field">
              <span>成长</span>
              <textarea
                onChange={(event) => update("growth", event.target.value)}
                required
                rows={3}
                value={editor.growth}
              />
            </label>
          </div>
        )}
      </div>

      {applicableFields.length > 0 ? (
        <div className="settings-type-fields">
          <h3>自定义字段</h3>
          <p>这些字段会进入设定详情、筛选和后续写作参考。</p>
          <div className="settings-form-grid">
            {applicableFields.map((definition) => (
              <CustomFieldControl
                definition={definition}
                entities={entities}
                key={definition.id}
                onChange={(value) =>
                  update("customFields", { ...editor.customFields, [definition.key]: value })
                }
                value={editor.customFields[definition.key]}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="settings-editor-actions">
        <button className="btn btn-ghost" disabled={busy} onClick={onCancel} type="button">
          取消
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={onSave} type="button">
          {busy ? (
            <LoaderCircle className="spin" size={15} aria-hidden="true" />
          ) : (
            <Check size={15} aria-hidden="true" />
          )}
          {editor.mode === "create" ? "创建设定" : changeMode ? "提交修改请求" : "保存修改"}
        </button>
      </div>
    </section>
  );
}

function CustomFieldControl({
  definition,
  entities,
  onChange,
  value,
}: {
  definition: CustomFieldDefinition;
  entities: SettingEntity[];
  onChange: (value: CustomFieldValue | null) => void;
  value: CustomFieldValue | null | undefined;
}) {
  const label = `${definition.label}${definition.required ? "（必填）" : ""}`;
  if (definition.fieldType === "boolean") {
    return (
      <label className="settings-field settings-check-field">
        <span>{label}</span>
        <input
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
      </label>
    );
  }
  if (definition.fieldType === "multi_select") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="settings-field settings-field-wide settings-check-group">
        <legend>{label}</legend>
        {definition.options.map((option) => (
          <label key={option}>
            <input
              checked={selected.includes(option)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, option]
                    : selected.filter((item) => item !== option),
                )
              }
              type="checkbox"
            />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  if (definition.fieldType === "single_select") {
    return (
      <label className="settings-field">
        <span>{label}</span>
        <select
          onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
          value={typeof value === "string" ? value : ""}
        >
          <option value="">请选择</option>
          {definition.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (definition.fieldType === "relation_ref") {
    const targets = entities.filter((entity) => entity.type === definition.relationTarget);
    return (
      <label className="settings-field">
        <span>{label}</span>
        <select
          onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
          value={typeof value === "string" ? value : ""}
        >
          <option value="">请选择</option>
          {targets.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (definition.fieldType === "long_text") {
    return (
      <label className="settings-field settings-field-wide">
        <span>{label}</span>
        <textarea
          onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
          rows={3}
          value={typeof value === "string" ? value : ""}
        />
      </label>
    );
  }
  const inputType =
    definition.fieldType === "number"
      ? "number"
      : definition.fieldType === "date"
        ? "date"
        : "text";
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input
        onChange={(event) =>
          onChange(
            definition.fieldType === "number"
              ? event.target.value === ""
                ? null
                : Number(event.target.value)
              : event.target.value === ""
                ? null
                : event.target.value,
          )
        }
        type={inputType}
        value={typeof value === "number" ? String(value) : typeof value === "string" ? value : ""}
      />
    </label>
  );
}

function EntityCard({ entity, onOpen }: { entity: SettingEntity; onOpen: (id: string) => void }) {
  return (
    <article className="panel settings-entity-card">
      <div className="settings-entity-card-head">
        <div>
          <span className="panel-kicker">{typeLabels[entity.type]}</span>
          <h3>{entity.name}</h3>
        </div>
        <span className={`badge settings-status-${entity.status}`}>
          {statusLabels[entity.status]}
        </span>
      </div>
      <p>{entity.summary}</p>
      <div className="settings-entity-meta">
        <span>第 {entity.version} 版</span>
        <span>{sourceLabels[entity.source]}</span>
        <span>{entity.aliases.length > 0 ? `别名：${entity.aliases.join("、")}` : "暂无别名"}</span>
      </div>
      <button className="btn btn-ghost btn-small" onClick={() => onOpen(entity.id)} type="button">
        查看设定详情
      </button>
    </article>
  );
}

function CustomFieldsPanel({
  busy,
  definitions,
  onCreate,
  onToggle,
}: {
  busy: string;
  definitions: CustomFieldDefinition[];
  onCreate: (form: FieldFormState) => void;
  onToggle: (definition: CustomFieldDefinition) => void;
}) {
  const [form, setForm] = useState<FieldFormState>(blankFieldForm());
  const [showForm, setShowForm] = useState(false);
  const update = <Key extends keyof FieldFormState>(field: Key, value: FieldFormState[Key]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  return (
    <section className="panel settings-custom-fields" aria-labelledby="custom-fields-title">
      <div className="panel-head">
        <div>
          <span className="panel-kicker">项目级字段</span>
          <h2 id="custom-fields-title">自定义字段</h2>
          <p>让设定结构适配这本书；新增字段只追加，不会改动已有字段和数据。</p>
        </div>
        <button
          className="btn btn-primary btn-small"
          onClick={() => setShowForm((current) => !current)}
          type="button"
        >
          <Plus size={14} aria-hidden="true" />
          新增字段
        </button>
      </div>

      <div className="settings-note">
        <Sparkles size={15} aria-hidden="true" />
        <span>字段会进入设定详情、筛选和后续写作参考，不是普通备注。</span>
      </div>

      {showForm ? (
        <div className="settings-field-form">
          <div className="settings-form-grid">
            <label className="settings-field">
              <span>字段标识</span>
              <input
                onChange={(event) => update("key", event.target.value)}
                placeholder="例如 fate"
                value={form.key}
              />
            </label>
            <label className="settings-field">
              <span>字段名称</span>
              <input
                onChange={(event) => update("label", event.target.value)}
                placeholder="例如 命格"
                value={form.label}
              />
            </label>
            <label className="settings-field">
              <span>字段类型</span>
              <select
                onChange={(event) =>
                  update("fieldType", event.target.value as FieldFormState["fieldType"])
                }
                value={form.fieldType}
              >
                {Object.entries(customFieldTypeLabels).map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>适用对象</span>
              <select
                onChange={(event) =>
                  update("appliesTo", event.target.value as FieldFormState["appliesTo"])
                }
                value={form.appliesTo}
              >
                {Object.entries(appliesToLabels).map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {form.fieldType === "single_select" || form.fieldType === "multi_select" ? (
              <label className="settings-field settings-field-wide">
                <span>选项</span>
                <input
                  onChange={(event) => update("options", event.target.value)}
                  placeholder="用逗号分隔"
                  value={form.options}
                />
              </label>
            ) : null}
            {form.fieldType === "relation_ref" ? (
              <label className="settings-field">
                <span>关系引用目标</span>
                <select
                  onChange={(event) =>
                    update(
                      "relationTarget",
                      (event.target.value || null) as FieldFormState["relationTarget"],
                    )
                  }
                  value={form.relationTarget ?? ""}
                >
                  <option value="">请选择</option>
                  {Object.entries(appliesToLabels)
                    .filter(([type]) => type !== "all")
                    .map(([type, label]) => (
                      <option key={type} value={type}>
                        {label}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            <label className="settings-field">
              <span>排序</span>
              <input
                min={0}
                onChange={(event) => update("sortOrder", event.target.value)}
                type="number"
                value={form.sortOrder}
              />
            </label>
            <label className="settings-field settings-check-field">
              <span>必填</span>
              <input
                checked={form.required}
                onChange={(event) => update("required", event.target.checked)}
                type="checkbox"
              />
            </label>
          </div>
          <div className="settings-editor-actions">
            <button className="btn btn-ghost" onClick={() => setShowForm(false)} type="button">
              取消
            </button>
            <button
              className="btn btn-primary"
              disabled={busy === "custom-field"}
              onClick={() => {
                onCreate(form);
                setForm(blankFieldForm());
                setShowForm(false);
              }}
              type="button"
            >
              <Check size={15} aria-hidden="true" />
              创建字段
            </button>
          </div>
        </div>
      ) : null}

      {definitions.length === 0 ? (
        <section className="settings-column-empty">
          <SlidersHorizontal size={20} aria-hidden="true" />
          <h2>还没有自定义字段</h2>
          <p>先创建最小字段，再让设定详情和后续写作逐步使用它。</p>
        </section>
      ) : (
        <div className="settings-custom-field-list">
          <div className="settings-custom-field-head">
            <span>字段</span>
            <span>类型</span>
            <span>适用范围</span>
            <span>规则</span>
            <span>状态</span>
            <span />
          </div>
          {definitions.map((definition) => (
            <div className="settings-custom-field-row" key={definition.id}>
              <div>
                <strong>{definition.label}</strong>
                <small>{definition.key}</small>
              </div>
              <span>{customFieldTypeLabels[definition.fieldType]}</span>
              <span>{appliesToLabels[definition.appliesTo]}</span>
              <span>
                {definition.required ? "必填" : "选填"}
                {definition.options.length > 0 ? ` · ${definition.options.join("、")}` : ""}
              </span>
              <span
                className={`badge ${definition.enabled ? "settings-status-locked" : "settings-status-discarded"}`}
              >
                {definition.enabled ? "启用" : "停用"}
              </span>
              <button
                aria-label={`${definition.enabled ? "停用" : "启用"}${definition.label}`}
                className="text-btn small"
                disabled={busy === `field-${definition.id}`}
                onClick={() => onToggle(definition)}
                type="button"
              >
                {definition.enabled ? "停用" : "启用"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ColumnEmptyState({ label, onCreate }: { label: string; onCreate: () => void }) {
  return (
    <section className="panel settings-column-empty">
      <Circle size={20} aria-hidden="true" />
      <h2>还没有{label}</h2>
      <p>先记录最小必要信息，再逐步补充关系、状态和来源。</p>
      <button className="btn btn-primary btn-small" onClick={onCreate} type="button">
        <Plus size={14} aria-hidden="true" />
        新增{label}
      </button>
    </section>
  );
}

function EntityDetail({
  busy,
  changeRequests,
  characterDetail,
  characterDetailError,
  characterDetailLoading,
  customFieldDefinitions,
  entity,
  onBack,
  onChangeRequest,
  onCreateProposal,
  onDecideProposal,
  onDelete,
  onEdit,
  onEditAlias,
  onLock,
  onRetryCharacterDetail,
  onRetryVersionHistory,
  onRestore,
  onRetryWorldDetail,
  proposals,
  versionHistoryError,
  versionHistoryLoading,
  versions,
  worldDetail,
  worldDetailError,
  worldDetailLoading,
}: {
  busy: string;
  changeRequests: SettingChangeRequest[];
  characterDetail: CharacterDetail | null;
  characterDetailError: string;
  characterDetailLoading: boolean;
  customFieldDefinitions: CustomFieldDefinition[];
  entity: SettingEntity;
  onBack: () => void;
  onChangeRequest: () => void;
  onCreateProposal: (input: ProposalInput) => void;
  onDecideProposal: (
    proposal: SettingProposal,
    decision: "accept" | "reject",
    reason: string,
  ) => void;
  onDelete: () => void;
  onEdit: () => void;
  onEditAlias: () => void;
  onLock: () => void;
  onRetryCharacterDetail: () => void;
  onRetryVersionHistory: () => void;
  onRestore: (targetVersion: number, reason: string) => Promise<boolean>;
  onRetryWorldDetail: () => void;
  proposals: SettingProposal[];
  versionHistoryError: string;
  versionHistoryLoading: boolean;
  versions: SettingEntityVersion[];
  worldDetail: WorldDomainDetail | null;
  worldDetailError: string;
  worldDetailLoading: boolean;
}) {
  const locked = entity.status === "locked";
  const proposed = entity.status === "proposed";
  const discarded = entity.status === "discarded";
  const [showProposalForm, setShowProposalForm] = useState(false);
  const [proposalReason, setProposalReason] = useState("");
  const [conflictType, setConflictType] = useState<SettingConflictType>("none");
  const [evidenceLabel, setEvidenceLabel] = useState("作者说明");
  const [evidenceQuote, setEvidenceQuote] = useState("");
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [restoreReason, setRestoreReason] = useState("恢复到作者确认的过去版本");
  const restorableVersions = versions.filter((version) => version.version < entity.version);
  const applicableFields = customFieldDefinitions.filter(
    (definition) =>
      (definition.enabled || entity.customFields[definition.key] !== undefined) &&
      (definition.appliesTo === "all" || definition.appliesTo === entity.type),
  );
  const [activeSection, setActiveSection] = useState<EntityDetailSection>("overview");
  const tabLabels = {
    overview: "基本信息",
    relations: "关系",
    history: "状态历史",
    references: "引用",
    health: "体检",
    ...ENTITY_DETAIL_TAB_LABELS[entity.type],
  };
  const findings =
    entity.type === "character"
      ? (characterDetail?.health ?? [])
      : (worldDetail?.value.health ?? []);
  const detailLoading = entity.type === "character" ? characterDetailLoading : worldDetailLoading;
  const detailError = entity.type === "character" ? characterDetailError : worldDetailError;
  const blockerCount = findings.filter((finding) => finding.severity === "blocker").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const restoring = busy === `restore-${entity.id}`;

  async function submitRestore() {
    if (selectedVersion === null) {
      return;
    }
    const restored = await onRestore(selectedVersion, restoreReason.trim());
    if (restored) {
      setSelectedVersion(null);
      setRestoreReason("恢复到作者确认的过去版本");
    }
  }

  function scrollToSection(section: EntityDetailSection) {
    setActiveSection(section);
    if (section === "overview") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    document
      .getElementById(`entity-section-${section}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const actionButtons = locked ? (
    <>
      <button className="btn btn-ghost btn-small" disabled type="button">
        <Lock size={14} aria-hidden="true" />
        已锁定 · 别名需修改请求
      </button>
      <button className="btn btn-ghost btn-small" disabled type="button">
        <Lock size={14} aria-hidden="true" />
        已锁定 · 删除需修改请求
      </button>
      <button className="btn btn-primary btn-small" disabled type="button">
        <Lock size={14} aria-hidden="true" />
        已锁定 · 编辑需修改请求
      </button>
      <button className="btn btn-primary btn-small" onClick={onChangeRequest} type="button">
        <GitPullRequest size={14} aria-hidden="true" />
        发起修改请求
      </button>
    </>
  ) : proposed ? (
    <p className="settings-inline-note">待确认提案正在等待裁决，完成后才能继续编辑。</p>
  ) : discarded ? (
    <p className="settings-inline-note">这条设定已废弃，不能再编辑或锁定。</p>
  ) : (
    <>
      <button className="btn btn-ghost btn-small" onClick={onEditAlias} type="button">
        <Pencil size={14} aria-hidden="true" />
        编辑别名
      </button>
      <button
        className="btn btn-ghost btn-small"
        disabled={busy === `delete-${entity.id}`}
        onClick={onDelete}
        type="button"
      >
        删除设定
      </button>
      <button className="btn btn-ghost btn-small" onClick={onEdit} type="button">
        <Pencil size={14} aria-hidden="true" />
        编辑设定
      </button>
      <button
        className="btn btn-primary btn-small"
        disabled={busy === `lock-${entity.id}`}
        onClick={onLock}
        type="button"
      >
        {busy === `lock-${entity.id}` ? (
          <LoaderCircle className="spin" size={14} aria-hidden="true" />
        ) : (
          <Lock size={14} aria-hidden="true" />
        )}
        锁定设定
      </button>
      <button
        className="btn btn-ghost btn-small"
        onClick={() => {
          setShowProposalForm((current) => !current);
          window.setTimeout(() => scrollToSection("references"), 0);
        }}
        type="button"
      >
        <MessageSquare size={14} aria-hidden="true" />
        提交提案
      </button>
    </>
  );

  return (
    <div className="entity-detail-page settings-entity-detail">
      <div className="entity-page-head">
        <button className="text-btn entity-back-btn" onClick={onBack} type="button">
          <ArrowLeft size={15} aria-hidden="true" />
          返回设定中心
        </button>
        <div className="entity-page-hero">
          <span
            className={`entity-page-avatar${entity.type === "character" ? " is-character" : ""}`}
            aria-hidden="true"
          >
            {entity.name.slice(0, 1) || "设"}
          </span>
          <div className="entity-page-title">
            <span className="panel-kicker">{typeLabels[entity.type]}</span>
            <div className="entity-page-title-row">
              <h1>{entity.name}</h1>
              <span className={`badge settings-status-${entity.status}`}>
                {statusLabels[entity.status]}
              </span>
            </div>
            <p>{entityHeroDescriptions[entity.type]}</p>
            <div className="entity-page-meta">
              <span>
                <small>别名</small>
                {entity.aliases.length > 0 ? entity.aliases.join("、") : "暂无别名"}
              </span>
              <span>
                <small>类型</small>
                {typeLabels[entity.type]}
              </span>
              <span>
                <small>作用域</small>全书
              </span>
              <span>
                <small>来源</small>
                {sourceLabels[entity.source]}
              </span>
              <span>
                <small>版本</small>第 {entity.version} 版
              </span>
            </div>
          </div>
          <div className="head-actions entity-page-actions">{actionButtons}</div>
        </div>
      </div>

      <div className="entity-page-layout">
        <aside className="panel entity-page-nav" aria-label="档案目录">
          <div className="entity-page-nav-head">
            <span className="panel-kicker">档案目录</span>
            <small>5 个部分</small>
          </div>
          {ENTITY_DETAIL_TABS.map((tab) => (
            <button
              aria-current={activeSection === tab.key ? "true" : undefined}
              className={`entity-page-nav-item${activeSection === tab.key ? " active" : ""}`}
              key={tab.key}
              onClick={() => scrollToSection(tab.key)}
              type="button"
            >
              <span>{tabLabels[tab.key] ?? tab.label}</span>
              <small>{tab.hint}</small>
            </button>
          ))}
          <div className="entity-page-nav-health">
            <div className="entity-page-nav-score">
              <span>设定健康度</span>
              <strong>{findings.length === 0 ? "通过" : `${findings.length} 项`}</strong>
            </div>
            <small>
              {findings.length === 0
                ? "核心信息完整，暂未发现冲突。"
                : `${blockerCount} 项阻断 · ${warningCount} 项提醒`}
            </small>
          </div>
          <button className="btn btn-ghost btn-block" onClick={onBack} type="button">
            <ArrowLeft size={14} aria-hidden="true" />
            返回设定中心
          </button>
        </aside>

        <div className="entity-page-main">
          <EntityDetailSection
            badge={typeLabels[entity.type]}
            id="overview"
            index="01"
            title="基本信息"
          >
            <div className="entity-summary-card">
              <p>{entity.summary || "尚未补充摘要。"}</p>
              {entity.tags.length > 0 ? (
                <div className="entity-tag-row">
                  {entity.tags.map((tag) => (
                    <span className="entity-tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <dl className="entity-quick-facts">
              <div>
                <span>状态</span>
                <strong>{statusLabels[entity.status]}</strong>
              </div>
              <div>
                <span>版本</span>
                <strong>第 {entity.version} 版</strong>
              </div>
              <div>
                <span>来源</span>
                <strong>{sourceLabels[entity.source]}</strong>
              </div>
              <div>
                <span>别名</span>
                <strong>
                  {entity.aliases.length > 0 ? entity.aliases.join("、") : "暂无别名"}
                </strong>
              </div>
            </dl>

            <div className="settings-detail-block">
              <h3>详细说明</h3>
              <p>{entity.description || "尚未补充详细说明。"}</p>
            </div>

            <DomainDetailSections
              characterDetail={characterDetail}
              characterDetailError={characterDetailError}
              characterDetailLoading={characterDetailLoading}
              entity={entity}
              onRetryCharacterDetail={onRetryCharacterDetail}
              onRetryWorldDetail={onRetryWorldDetail}
              section="overview"
              worldDetail={worldDetail}
              worldDetailError={worldDetailError}
              worldDetailLoading={worldDetailLoading}
            />
          </EntityDetailSection>

          <EntityDetailSection id="relations" index="02" title={tabLabels.relations}>
            <DomainDetailSections
              characterDetail={characterDetail}
              characterDetailError={characterDetailError}
              characterDetailLoading={characterDetailLoading}
              entity={entity}
              onRetryCharacterDetail={onRetryCharacterDetail}
              onRetryWorldDetail={onRetryWorldDetail}
              section="relations"
              worldDetail={worldDetail}
              worldDetailError={worldDetailError}
              worldDetailLoading={worldDetailLoading}
            />
          </EntityDetailSection>

          <EntityDetailSection id="history" index="03" title={tabLabels.history}>
            <DomainDetailSections
              characterDetail={characterDetail}
              characterDetailError={characterDetailError}
              characterDetailLoading={characterDetailLoading}
              entity={entity}
              onRetryCharacterDetail={onRetryCharacterDetail}
              onRetryWorldDetail={onRetryWorldDetail}
              section="history"
              worldDetail={worldDetail}
              worldDetailError={worldDetailError}
              worldDetailLoading={worldDetailLoading}
            />
            <div className="settings-detail-block settings-version-history">
              <div className="settings-proposal-head">
                <h3>版本历史</h3>
                <span className="badge">当前第 {entity.version} 版</span>
              </div>

              {versionHistoryLoading ? (
                <p className="settings-inline-note" role="status">
                  <LoaderCircle className="spin" size={14} aria-hidden="true" />
                  正在加载版本历史
                </p>
              ) : versionHistoryError ? (
                <div className="settings-inline-warning" role="alert">
                  <TriangleAlert size={15} aria-hidden="true" />
                  <span>{versionHistoryError}</span>
                  <button className="text-btn small" onClick={onRetryVersionHistory} type="button">
                    重新加载
                  </button>
                </div>
              ) : versions.length === 0 ? (
                <p className="settings-inline-note">还没有版本记录。</p>
              ) : restorableVersions.length === 0 ? (
                <p className="settings-inline-note">还没有可恢复的历史版本。</p>
              ) : (
                <>
                  <div className="settings-version-list">
                    {versions.map((version) => {
                      const current = version.version === entity.version;
                      const selected = version.version === selectedVersion;
                      return (
                        <button
                          aria-pressed={selected}
                          className={`settings-version-card${current ? " is-current" : ""}${
                            selected ? " is-selected" : ""
                          }`}
                          disabled={current || locked || proposed || discarded}
                          key={version.node}
                          onClick={() => setSelectedVersion(current ? null : version.version)}
                          type="button"
                        >
                          <span>
                            <strong>第 {version.version} 版</strong>
                            <small>{formatDateTime(version.createdAt)}</small>
                          </span>
                          <span>{version.reason || "未记录说明"}</span>
                          <small>
                            {version.summary.name ?? entity.name} ·{" "}
                            {version.summary.summary || "无摘要"}
                          </small>
                          {current ? <em>当前版本</em> : null}
                        </button>
                      );
                    })}
                  </div>
                  <label className="settings-field settings-field-wide">
                    <span>恢复原因</span>
                    <input
                      disabled={selectedVersion === null || restoring}
                      onChange={(event) => setRestoreReason(event.target.value)}
                      value={restoreReason}
                    />
                  </label>
                  {locked || proposed || discarded ? (
                    <p className="settings-inline-warning">
                      {locked
                        ? "锁定设定不能直接恢复，请发起修改请求。"
                        : proposed
                          ? "请先完成待裁决提案。"
                          : "废弃设定不能恢复版本。"}
                    </p>
                  ) : null}
                  <div className="settings-detail-actions">
                    <button
                      className="btn btn-primary btn-small"
                      disabled={
                        selectedVersion === null ||
                        restoreReason.trim().length === 0 ||
                        locked ||
                        proposed ||
                        discarded ||
                        restoring
                      }
                      onClick={submitRestore}
                      type="button"
                    >
                      {restoring ? (
                        <LoaderCircle className="spin" size={14} aria-hidden="true" />
                      ) : (
                        <History size={14} aria-hidden="true" />
                      )}
                      恢复第 {selectedVersion ?? "?"} 版
                    </button>
                  </div>
                </>
              )}
            </div>
          </EntityDetailSection>

          <EntityDetailSection id="references" index="04" title={tabLabels.references}>
            <DomainDetailSections
              characterDetail={characterDetail}
              characterDetailError={characterDetailError}
              characterDetailLoading={characterDetailLoading}
              entity={entity}
              onRetryCharacterDetail={onRetryCharacterDetail}
              onRetryWorldDetail={onRetryWorldDetail}
              section="references"
              worldDetail={worldDetail}
              worldDetailError={worldDetailError}
              worldDetailLoading={worldDetailLoading}
            />
            {applicableFields.length > 0 ? (
              <div className="settings-detail-block">
                <h3>自定义字段</h3>
                <dl className="settings-detail-meta">
                  {applicableFields.map((definition) => (
                    <div key={definition.id}>
                      <dt>{definition.label}</dt>
                      <dd>{formatCustomFieldValue(entity.customFields[definition.key])}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            {proposals.length > 0 ? (
              <div className="settings-detail-block settings-proposal-history">
                <h3>提案与证据</h3>
                {proposals.map((proposal) => {
                  const pending = proposal.status === "pending";
                  const decisionReason = decisionReasons[proposal.id] ?? "作者确认提案";
                  return (
                    <article className="settings-proposal-card" key={proposal.id}>
                      <div className="settings-proposal-head">
                        <strong>{proposalStatusLabels[proposal.status]}</strong>
                        <span className="badge">{conflictTypeLabels[proposal.conflictType]}</span>
                      </div>
                      <p>{proposal.reason}</p>
                      <ul className="settings-evidence-list">
                        {proposal.evidence.map((evidence, index) => (
                          <li key={`${proposal.id}-${index}`}>
                            <strong>{evidence.label}</strong>
                            <span>{evidence.quote || "未提供摘录"}</span>
                            {evidence.locator ? <small>{evidence.locator}</small> : null}
                          </li>
                        ))}
                      </ul>
                      {pending && proposed ? (
                        <div className="settings-proposal-decision">
                          <label className="settings-field">
                            <span>裁决理由</span>
                            <input
                              onChange={(event) =>
                                setDecisionReasons((current) => ({
                                  ...current,
                                  [proposal.id]: event.target.value,
                                }))
                              }
                              value={decisionReason}
                            />
                          </label>
                          {proposal.conflictType !== "none" ? (
                            <p className="settings-inline-warning">
                              该提案仍有冲突，需要先解决冲突才能确认。
                            </p>
                          ) : null}
                          <div className="settings-detail-actions">
                            <button
                              className="btn btn-primary btn-small"
                              disabled={
                                busy === `decision-${proposal.id}` ||
                                proposal.conflictType !== "none"
                              }
                              onClick={() => onDecideProposal(proposal, "accept", decisionReason)}
                              type="button"
                            >
                              <Check size={14} aria-hidden="true" />
                              确认提案
                            </button>
                            <button
                              className="btn btn-ghost btn-small"
                              disabled={busy === `decision-${proposal.id}`}
                              onClick={() => onDecideProposal(proposal, "reject", decisionReason)}
                              type="button"
                            >
                              驳回提案
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {proposal.status !== "pending" && proposal.decisionReason ? (
                        <p className="settings-inline-note">裁决：{proposal.decisionReason}</p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : null}

            {changeRequests.length > 0 ? (
              <div className="settings-detail-block settings-change-history">
                <h3>修改请求</h3>
                {changeRequests.map((request) => (
                  <article className="settings-change-card" key={request.id}>
                    <div className="settings-proposal-head">
                      <strong>{request.title}</strong>
                      <span className="badge">{changeRequestStatusLabels[request.status]}</span>
                    </div>
                    <p>{request.reason}</p>
                    <dl className="settings-detail-meta">
                      <div>
                        <dt>原版本</dt>
                        <dd>第 {request.entityVersion} 版</dd>
                      </div>
                      <div>
                        <dt>冲突</dt>
                        <dd>{conflictTypeLabels[request.conflictType]}</dd>
                      </div>
                      <div>
                        <dt>提交时间</dt>
                        <dd>{formatDateTime(request.createdAt)}</dd>
                      </div>
                    </dl>
                    <div
                      className={`settings-change-impact${request.impact.hasImpact ? "" : " is-empty"}`}
                      role="status"
                    >
                      <strong>影响提示</strong>
                      <p>{request.impact.message}</p>
                      {request.impact.resources.length > 0 ? (
                        <ul>
                          {request.impact.resources.map((resource) => (
                            <li key={`${request.id}:${resource.type}:${resource.id}`}>
                              <span>{impactResourceTypeLabels[resource.type]}</span>
                              {resource.label}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <ul className="settings-evidence-list">
                      {request.evidence.map((evidence, index) => (
                        <li key={`${request.id}-${index}`}>
                          <strong>{evidence.label}</strong>
                          <span>{evidence.quote || "未提供摘录"}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            ) : null}

            {showProposalForm && !locked && !proposed && !discarded ? (
              <div className="settings-proposal-form">
                <h3>提交提案</h3>
                <label className="settings-field settings-field-wide">
                  <span>提案理由</span>
                  <textarea
                    onChange={(event) => setProposalReason(event.target.value)}
                    placeholder="说明这条设定为什么需要作者确认"
                    rows={3}
                    value={proposalReason}
                  />
                </label>
                <label className="settings-field">
                  <span>冲突类型</span>
                  <select
                    onChange={(event) => setConflictType(event.target.value as SettingConflictType)}
                    value={conflictType}
                  >
                    {Object.entries(conflictTypeLabels).map(([type, label]) => (
                      <option key={type} value={type}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span>证据来源</span>
                  <input
                    onChange={(event) => setEvidenceLabel(event.target.value)}
                    value={evidenceLabel}
                  />
                </label>
                <label className="settings-field settings-field-wide">
                  <span>证据摘录</span>
                  <textarea
                    onChange={(event) => setEvidenceQuote(event.target.value)}
                    rows={3}
                    value={evidenceQuote}
                  />
                </label>
                <div className="settings-detail-actions">
                  <button
                    className="btn btn-primary btn-small"
                    disabled={
                      busy === `proposal-${entity.id}` || proposalReason.trim().length === 0
                    }
                    onClick={() => {
                      onCreateProposal({
                        reason: proposalReason,
                        conflictType,
                        evidenceLabel,
                        evidenceQuote,
                      });
                      setShowProposalForm(false);
                    }}
                    type="button"
                  >
                    <MessageSquare size={14} aria-hidden="true" />
                    提交提案
                  </button>
                  <button
                    className="btn btn-ghost btn-small"
                    onClick={() => setShowProposalForm(false)}
                    type="button"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}
          </EntityDetailSection>

          <EntityDetailSection
            badge={findings.length === 0 ? "通过" : `${findings.length} 项`}
            id="health"
            index="05"
            title="设定体检"
          >
            {detailLoading ? (
              <p className="entity-page-empty">正在读取体检结果…</p>
            ) : detailError ? (
              <p className="entity-page-empty">档案未加载，暂时无法完成体检。</p>
            ) : (
              <WorldHealth findings={findings} showHeading={false} />
            )}
          </EntityDetailSection>
        </div>
      </div>
    </div>
  );
}

function EntityDetailSection({
  badge,
  children,
  id,
  index,
  title,
}: {
  badge?: string;
  children: ReactNode;
  id: EntityDetailSection;
  index: string;
  title: string;
}) {
  return (
    <section
      aria-labelledby={`entity-section-${id}-title`}
      className="panel entity-page-section"
      id={`entity-section-${id}`}
    >
      <div className="entity-page-section-head">
        <div>
          <span className="panel-kicker">{index}</span>
          <h2 id={`entity-section-${id}-title`}>{title}</h2>
        </div>
        {badge ? <span className="badge">{badge}</span> : null}
      </div>
      {children}
    </section>
  );
}

function DetailEmpty({ children }: { children: ReactNode }) {
  return <p className="entity-page-empty">{children}</p>;
}

function DomainDetailSections({
  characterDetail,
  characterDetailError,
  characterDetailLoading,
  entity,
  onRetryCharacterDetail,
  onRetryWorldDetail,
  section,
  worldDetail,
  worldDetailError,
  worldDetailLoading,
}: {
  characterDetail: CharacterDetail | null;
  characterDetailError: string;
  characterDetailLoading: boolean;
  entity: SettingEntity;
  onRetryCharacterDetail: () => void;
  onRetryWorldDetail: () => void;
  section: EntityDetailSection;
  worldDetail: WorldDomainDetail | null;
  worldDetailError: string;
  worldDetailLoading: boolean;
}) {
  if (entity.type === "world_rule") {
    if (section === "overview") {
      return (
        <div className="settings-detail-block">
          <h3>世界规则</h3>
          <p>内容：{entity.data.rule}</p>
        </div>
      );
    }
    if (section === "relations") {
      return <DetailEmpty>还没有规则关联。</DetailEmpty>;
    }
    if (section === "history") {
      return <DetailEmpty>还没有规则变化。</DetailEmpty>;
    }
    return null;
  }

  if (entity.type === "character") {
    return (
      <CharacterDomainView
        detail={characterDetail}
        entity={entity}
        error={characterDetailError}
        loading={characterDetailLoading}
        onRetry={onRetryCharacterDetail}
        section={section}
      />
    );
  }

  if (entity.type === "faction") {
    return (
      <FactionDomainView
        detail={worldDetail?.kind === "faction" ? worldDetail.value : null}
        error={worldDetailError}
        loading={worldDetailLoading}
        onRetry={onRetryWorldDetail}
        section={section}
      />
    );
  }

  if (entity.type === "map") {
    return (
      <MapDomainView
        detail={worldDetail?.kind === "map" ? worldDetail.value : null}
        error={worldDetailError}
        loading={worldDetailLoading}
        onRetry={onRetryWorldDetail}
        section={section}
      />
    );
  }

  if (entity.type === "power_system") {
    return (
      <PowerDomainView
        detail={worldDetail?.kind === "power" ? worldDetail.value : null}
        error={worldDetailError}
        loading={worldDetailLoading}
        onRetry={onRetryWorldDetail}
        section={section}
      />
    );
  }

  if (entity.type === "item") {
    return (
      <ItemDomainView
        detail={worldDetail?.kind === "item" ? worldDetail.value : null}
        error={worldDetailError}
        loading={worldDetailLoading}
        onRetry={onRetryWorldDetail}
        section={section}
      />
    );
  }

  if (entity.type === "timeline_event") {
    return (
      <TimelineDomainView
        detail={worldDetail?.kind === "timeline" ? worldDetail.value : null}
        entity={entity}
        error={worldDetailError}
        loading={worldDetailLoading}
        onRetry={onRetryWorldDetail}
        section={section}
      />
    );
  }

  return (
    <MechanismDomainView
      detail={worldDetail?.kind === "mechanism" ? worldDetail.value : null}
      error={worldDetailError}
      loading={worldDetailLoading}
      onRetry={onRetryWorldDetail}
      section={section}
    />
  );
}

function CharacterDomainView({
  detail,
  entity,
  error,
  loading,
  onRetry,
  section,
}: {
  detail: CharacterDetail | null;
  entity: Extract<SettingEntity, { type: "character" }>;
  error: string;
  loading: boolean;
  onRetry: () => void;
  section: EntityDetailSection;
}) {
  if (section === "health") {
    return null;
  }

  if (section === "overview") {
    return (
      <div className="settings-character-domain">
        {loading ? (
          <div className="settings-detail-block settings-character-loading" role="status">
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
            <span>正在加载人物档案</span>
          </div>
        ) : error ? (
          <div className="settings-detail-block settings-character-error" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{error}</span>
            <button className="text-btn small" onClick={onRetry} type="button">
              重试
            </button>
          </div>
        ) : detail ? (
          <>
            <div className="settings-detail-block">
              <h3>档案摘要</h3>
              <dl className="settings-character-grid">
                <div>
                  <dt>当前身体状态</dt>
                  <dd>{entity.data.bodyState || "尚未记录"}</dd>
                </div>
                <div>
                  <dt>知识边界</dt>
                  <dd>{entity.data.knowledgeBoundary || "尚未记录"}</dd>
                </div>
                <div>
                  <dt>关系摘要</dt>
                  <dd>{entity.data.relationshipSummary || "尚未记录"}</dd>
                </div>
              </dl>
            </div>
            <div className="settings-detail-block">
              <h3>基本档案</h3>
              <dl className="settings-character-grid">
                <div>
                  <dt>欲望</dt>
                  <dd>{detail.profile.desire || "尚未记录"}</dd>
                </div>
                <div>
                  <dt>恐惧</dt>
                  <dd>{detail.profile.fear || "尚未记录"}</dd>
                </div>
                <div>
                  <dt>目标</dt>
                  <dd>{detail.profile.goal || "尚未记录"}</dd>
                </div>
                <div>
                  <dt>伪装</dt>
                  <dd>{detail.profile.disguise || "尚未记录"}</dd>
                </div>
                <div>
                  <dt>声线样本</dt>
                  <dd>{detail.profile.voiceSample || "尚未记录"}</dd>
                </div>
                <div>
                  <dt>声线提示</dt>
                  <dd>{detail.profile.voiceGuide || "尚未记录"}</dd>
                </div>
              </dl>
            </div>
          </>
        ) : (
          <div className="settings-detail-block">
            <p>尚未载入人物专用档案。</p>
          </div>
        )}
      </div>
    );
  }

  if (!detail) {
    return null;
  }

  if (section === "relations") {
    return (
      <div className="settings-character-domain">
        <div className="settings-detail-block">
          <h3>关系摘要</h3>
          <p>{entity.data.relationshipSummary || "还没有记录关系摘要。"}</p>
        </div>
        <div className="settings-detail-block">
          <h3>类型化关系</h3>
          {detail.relationships.length === 0 ? (
            <p>还没有类型化关系。</p>
          ) : (
            <ul className="settings-character-records">
              {detail.relationships.map((relationship) => (
                <li key={relationship.id}>
                  <div>
                    <strong>
                      {relationshipTypeLabels[relationship.relationType]} ·{" "}
                      {relationship.target.label ?? "未命名目标"}
                    </strong>
                    <span>{formatValidity(relationship.validity)}</span>
                  </div>
                  <small>
                    {relationship.sourceChapterId ? "来源：章节记录" : "来源：作者补录"}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (section === "history") {
    return (
      <div className="settings-character-domain">
        <div className="settings-detail-block">
          {detail.stateTransitions.length === 0 ? (
            <p>还没有身体、位置或能力状态记录。</p>
          ) : (
            <ul className="settings-character-records">
              {detail.stateTransitions.map((state) => (
                <li key={state.id}>
                  <div>
                    <strong>
                      {characterStateLabels[state.stateKind]} · {state.stateKey}
                    </strong>
                    <span>{formatValidity(state.validity)}</span>
                  </div>
                  <p>{state.value}</p>
                  {state.target?.label ? <small>地点：{state.target.label}</small> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-character-domain">
      <div className="settings-detail-block">
        <h3>角色认知与引用</h3>
        {detail.knowledgeStates.length === 0 ? (
          <p>还没有角色认知记录。</p>
        ) : (
          <ul className="settings-character-records">
            {detail.knowledgeStates.map((state) => (
              <li key={state.id}>
                <div>
                  <strong>{knowledgeStateLabels[state.state]}</strong>
                  <span>{formatValidity(state.validity)}</span>
                </div>
                <p>{state.claimedContent || "明确记录为未知。"}</p>
                <small>
                  {state.sourceChapterId ? "来源：章节记录" : "来源：作者补录"} · 客观事实引用已保留
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FactionDomainView({
  detail,
  error,
  loading,
  onRetry,
  section,
}: {
  detail: FactionDetail | null;
  error: string;
  loading: boolean;
  onRetry: () => void;
  section: EntityDetailSection;
}) {
  if (section === "references" || section === "health") {
    return null;
  }

  if (section === "overview") {
    return (
      <div className="settings-character-domain">
        {loading ? (
          <div className="settings-detail-block settings-character-loading" role="status">
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
            <span>正在加载势力档案</span>
          </div>
        ) : error ? (
          <div className="settings-detail-block settings-character-error" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{error}</span>
            <button className="text-btn small" onClick={onRetry} type="button">
              重试
            </button>
          </div>
        ) : detail ? (
          <div className="settings-detail-block">
            <h3>组织目标</h3>
            <dl className="settings-character-grid">
              <div>
                <dt>概览</dt>
                <dd>{detail.profile.overview || "尚未记录"}</dd>
              </div>
              <div>
                <dt>当前目标</dt>
                <dd>{detail.profile.goals || "尚未记录"}</dd>
              </div>
              <div>
                <dt>资源</dt>
                <dd>{detail.profile.resources || "尚未记录"}</dd>
              </div>
              <div>
                <dt>规矩</dt>
                <dd>{detail.profile.doctrine || "尚未记录"}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="settings-detail-block">
            <p>尚未载入势力专用档案。</p>
          </div>
        )}
      </div>
    );
  }

  if (!detail) {
    return null;
  }

  if (section === "relations") {
    return (
      <div className="settings-character-domain">
        <div className="settings-detail-block">
          <h3>势力关系</h3>
          {detail.relationships.length === 0 ? (
            <p>还没有类型化势力关系。</p>
          ) : (
            <ul className="settings-character-records">
              {detail.relationships.map((relationship) => (
                <li key={relationship.id}>
                  <div>
                    <strong>
                      {factionRelationLabels[relationship.relationType]} ·{" "}
                      {relationship.target.label ?? "未命名势力"}
                    </strong>
                    <span>{formatValidity(relationship.validity)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-character-domain">
      <div className="settings-detail-block">
        <h3>控制区</h3>
        {detail.territories.length === 0 ? (
          <p>还没有记录控制区。</p>
        ) : (
          <ul className="settings-character-records">
            {detail.territories.map((territory) => (
              <li key={territory.id}>
                <div>
                  <strong>
                    {territory.node.label ?? "未命名地点"} ·{" "}
                    {controlLevelLabels[territory.controlLevel]}
                  </strong>
                  <span>{formatValidity(territory.validity)}</span>
                </div>
                <small>
                  {territory.evidence.length > 0
                    ? `来源证据 ${territory.evidence.length} 条`
                    : "来源：作者补录"}
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MapDomainView({
  detail,
  error,
  loading,
  onRetry,
  section,
}: {
  detail: MapDetail | null;
  error: string;
  loading: boolean;
  onRetry: () => void;
  section: EntityDetailSection;
}) {
  const nodeNames = new Map((detail?.nodes ?? []).map((node) => [node.id, node.name] as const));

  if (section === "references" || section === "health") {
    return null;
  }

  if (section === "overview") {
    return (
      <div className="settings-character-domain">
        {loading ? (
          <div className="settings-detail-block settings-character-loading" role="status">
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
            <span>正在加载地图档案</span>
          </div>
        ) : error ? (
          <div className="settings-detail-block settings-character-error" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{error}</span>
            <button className="text-btn small" onClick={onRetry} type="button">
              重试
            </button>
          </div>
        ) : detail ? (
          <>
            <div className="settings-detail-block">
              <h3>地图图层</h3>
              {detail.layers.length === 0 ? (
                <p>还没有记录地图图层。</p>
              ) : (
                <ul className="settings-character-records">
                  {detail.layers.map((layer) => (
                    <li key={layer.id}>
                      <div>
                        <strong>{layer.name}</strong>
                        <span>{formatValidity(layer.validity)}</span>
                      </div>
                      <small>
                        层级顺序 {layer.sortOrder + 1} · 显示范围 {layer.minScale}–{layer.maxScale}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="settings-detail-block">
              <h3>地点层级</h3>
              {detail.nodes.length === 0 ? (
                <p>还没有记录地点节点。</p>
              ) : (
                <ul className="settings-character-records">
                  {detail.nodes.map((node) => (
                    <li key={node.id}>
                      <div>
                        <strong>
                          {node.name} · {mapNodeTypeLabels[node.nodeType]}
                        </strong>
                        <span>{formatValidity(node.validity)}</span>
                      </div>
                      <p>{node.summary || "尚未补充地点说明。"}</p>
                      <small>
                        {node.parentNodeId
                          ? `上级地点：${nodeNames.get(node.parentNodeId) ?? "未命名地点"}`
                          : "地图根部节点"}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <div className="settings-detail-block">
            <p>尚未载入地图专用档案。</p>
          </div>
        )}
      </div>
    );
  }

  if (!detail) {
    return null;
  }

  if (section === "relations") {
    return (
      <div className="settings-character-domain">
        <div className="settings-detail-block">
          <h3>路线与旅行时间</h3>
          {detail.edges.length === 0 ? (
            <p>还没有记录地点路线。</p>
          ) : (
            <ul className="settings-character-records">
              {detail.edges.map((edge) => (
                <li key={edge.id}>
                  <div>
                    <strong>
                      {nodeNames.get(edge.fromNodeId) ?? "未命名地点"} →{" "}
                      {nodeNames.get(edge.toNodeId) ?? "未命名地点"}
                    </strong>
                    <span>{edge.travelMinutes} 分钟</span>
                  </div>
                  <small>
                    {mapRouteTypeLabels[edge.routeType]}
                    {edge.bidirectional ? " · 可双向通行" : " · 单向通行"}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="settings-detail-block">
          <h3>地图标记</h3>
          {detail.markers.length === 0 ? (
            <p>还没有地图标记。</p>
          ) : (
            <ul className="settings-character-records">
              {detail.markers.map((marker) => (
                <li key={marker.id}>
                  <div>
                    <strong>
                      {marker.label} · {mapMarkerTypeLabels[marker.markerType]}
                    </strong>
                    <span>{formatValidity(marker.validity)}</span>
                  </div>
                  {marker.nodeId ? (
                    <small>关联地点：{nodeNames.get(marker.nodeId) ?? "未命名地点"}</small>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-character-domain">
      <div className="settings-detail-block">
        <h3>控制区</h3>
        {detail.controlAreas.length === 0 ? (
          <p>还没有记录势力控制区。</p>
        ) : (
          <ul className="settings-character-records">
            {detail.controlAreas.map((territory) => (
              <li key={territory.id}>
                <div>
                  <strong>
                    {territory.node.label ?? "未命名地点"} ·{" "}
                    {controlLevelLabels[territory.controlLevel]}
                  </strong>
                  <span>{formatValidity(territory.validity)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PowerDomainView({
  detail,
  error,
  loading,
  onRetry,
  section,
}: {
  detail: PowerSystem | null;
  error: string;
  loading: boolean;
  onRetry: () => void;
  section: EntityDetailSection;
}) {
  if (section === "references" || section === "health") {
    return null;
  }

  if (section === "overview") {
    return (
      <div className="settings-character-domain">
        {loading ? (
          <div className="settings-detail-block settings-character-loading" role="status">
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
            <span>正在加载力量体系</span>
          </div>
        ) : error ? (
          <div className="settings-detail-block settings-character-error" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{error}</span>
            <button className="text-btn small" onClick={onRetry} type="button">
              重试
            </button>
          </div>
        ) : detail ? (
          <>
            <div className="settings-detail-block">
              <h3>体系概览</h3>
              <p>{detail.overview || "尚未补充力量体系概览。"}</p>
            </div>

            <div className="settings-detail-block">
              <h3>寿命绑定</h3>
              <dl className="settings-character-grid">
                <div>
                  <dt>绑定方式</dt>
                  <dd>{powerLifespanModeLabels[detail.lifespanPolicy.mode]}</dd>
                </div>
                <div>
                  <dt>单位</dt>
                  <dd>{detail.lifespanPolicy.unit}</dd>
                </div>
                <div>
                  <dt>依据</dt>
                  <dd>{detail.lifespanPolicy.basis || "未指定"}</dd>
                </div>
                <div>
                  <dt>规则说明</dt>
                  <dd>{detail.lifespanPolicy.description || "未指定"}</dd>
                </div>
                {detail.lifespanPolicy.mode === "fixed" ? (
                  <div>
                    <dt>固定寿命</dt>
                    <dd>
                      {detail.lifespanPolicy.fixedAmount} {detail.lifespanPolicy.unit}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </>
        ) : (
          <div className="settings-detail-block">
            <p>尚未载入力量体系专用档案。</p>
          </div>
        )}
      </div>
    );
  }

  if (!detail) {
    return null;
  }

  if (section === "relations") {
    return <DetailEmpty>还没有记录体系关联。</DetailEmpty>;
  }

  return (
    <div className="settings-character-domain">
      <div className="settings-detail-block">
        <h3>路径与境界</h3>
        {detail.paths.length === 0 ? (
          <p>还没有记录力量路径。</p>
        ) : (
          <div className="settings-character-records">
            {detail.paths.map((path) => (
              <div key={path.id}>
                <div>
                  <strong>
                    {path.name} · {path.pathType}
                  </strong>
                  <span>{path.realms.length} 个境界</span>
                </div>
                {path.description ? <p>{path.description}</p> : null}
                {path.realms.length === 0 ? (
                  <small>这条路径还没有境界。</small>
                ) : (
                  <ul className="settings-evidence-list">
                    {path.realms.map((realm) => (
                      <li key={realm.id}>
                        <strong>
                          第 {realm.rank} 层 · {realm.name}
                        </strong>
                        <span>突破条件：{realm.breakthroughConditions}</span>
                        {realm.breakthroughCosts ? (
                          <small>代价：{realm.breakthroughCosts}</small>
                        ) : null}
                        {realm.bottlenecks ? <small>瓶颈：{realm.bottlenecks}</small> : null}
                        {realm.counters ? <small>克制：{realm.counters}</small> : null}
                        {realm.counteredBy ? <small>被克制：{realm.counteredBy}</small> : null}
                        <small>
                          寿命：
                          {realm.lifespanAmount
                            ? `${realm.lifespanAmount} ${detail.lifespanPolicy.unit}`
                            : "未配置"}
                        </small>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MechanismDomainView({
  detail,
  error,
  loading,
  onRetry,
  section,
}: {
  detail: SpecialMechanism | null;
  error: string;
  loading: boolean;
  onRetry: () => void;
  section: EntityDetailSection;
}) {
  if (section === "references" || section === "health") {
    return null;
  }

  if (section === "overview") {
    return (
      <div className="settings-character-domain">
        {loading ? (
          <div className="settings-detail-block settings-character-loading" role="status">
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
            <span>正在加载特殊机制</span>
          </div>
        ) : error ? (
          <div className="settings-detail-block settings-character-error" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{error}</span>
            <button className="text-btn small" onClick={onRetry} type="button">
              重试
            </button>
          </div>
        ) : detail ? (
          <div className="settings-detail-block">
            <h3>规则、代价、限制与成长</h3>
            <dl className="settings-character-grid">
              <div>
                <dt>规则</dt>
                <dd>{detail.rules}</dd>
              </div>
              <div>
                <dt>代价</dt>
                <dd>{detail.costs || "尚未记录"}</dd>
              </div>
              <div>
                <dt>限制</dt>
                <dd>{detail.limits || "尚未记录"}</dd>
              </div>
              <div>
                <dt>成长</dt>
                <dd>{detail.growth || "尚未记录"}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="settings-detail-block">
            <p>尚未载入特殊机制专用档案。</p>
          </div>
        )}
      </div>
    );
  }

  if (!detail) {
    return null;
  }

  if (section === "relations") {
    return (
      <div className="settings-character-domain">
        <div className="settings-detail-block">
          <h3>机制归属</h3>
          <dl className="settings-character-grid">
            <div>
              <dt>机制类型</dt>
              <dd>{detail.mechanismType}</dd>
            </div>
            <div>
              <dt>所有者</dt>
              <dd>{detail.owner?.label ?? "尚未记录"}</dd>
            </div>
            <div>
              <dt>关联体系</dt>
              <dd>{detail.powerSystem?.label ?? "未关联"}</dd>
            </div>
          </dl>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-character-domain">
      <div className="settings-detail-block">
        <h3>所有权历史</h3>
        {detail.ownershipHistory.length === 0 ? (
          <p>还没有记录所有权变更。</p>
        ) : (
          <ul className="settings-character-records">
            {detail.ownershipHistory.map((record) => (
              <li key={record.id}>
                <div>
                  <strong>
                    {record.previousOwner
                      ? `${record.previousOwner.label ?? "原所有者"} → `
                      : "首次登记 · "}
                    {record.owner.label ?? "未命名所有者"}
                  </strong>
                  <span>{formatValidity(record.validity)}</span>
                </div>
                <p>{record.reason}</p>
                <small>
                  {record.evidence.length > 0
                    ? `来源证据 ${record.evidence.length} 条`
                    : "来源：作者补录"}
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ItemDomainView({
  detail,
  error,
  loading,
  onRetry,
  section,
}: {
  detail: ItemDomain | null;
  error: string;
  loading: boolean;
  onRetry: () => void;
  section: EntityDetailSection;
}) {
  if (section === "references" || section === "health") {
    return null;
  }

  if (section === "overview") {
    return (
      <div className="settings-character-domain">
        {loading ? (
          <div className="settings-detail-block settings-character-loading" role="status">
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
            <span>正在加载物品功法</span>
          </div>
        ) : error ? (
          <div className="settings-detail-block settings-character-error" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{error}</span>
            <button className="text-btn small" onClick={onRetry} type="button">
              重试
            </button>
          </div>
        ) : detail ? (
          <>
            <div className="settings-detail-block">
              <h3>物品档案</h3>
              <dl className="settings-character-grid">
                <div>
                  <dt>类型</dt>
                  <dd>{itemKindLabels[detail.kind]}</dd>
                </div>
                <div>
                  <dt>分类</dt>
                  <dd>{detail.category}</dd>
                </div>
                <div>
                  <dt>品阶</dt>
                  <dd>{detail.grade || "未定"}</dd>
                </div>
                <div>
                  <dt>归属方式</dt>
                  <dd>{itemOwnershipModelLabels[detail.ownershipModel]}</dd>
                </div>
                <div>
                  <dt>数量</dt>
                  <dd>{detail.quantity}</dd>
                </div>
                <div>
                  <dt>消耗品</dt>
                  <dd>{detail.consumable ? "是" : "否"}</dd>
                </div>
                <div>
                  <dt>装备位</dt>
                  <dd>{detail.equipmentSlot || "不适用"}</dd>
                </div>
                <div>
                  <dt>当前装备者</dt>
                  <dd>{detail.equippedBy?.label ?? "未装备"}</dd>
                </div>
              </dl>
            </div>

            <div className="settings-detail-block">
              <h3>效果、代价与限制</h3>
              <dl className="settings-character-grid">
                <div>
                  <dt>效果</dt>
                  <dd>{detail.effect}</dd>
                </div>
                <div>
                  <dt>代价</dt>
                  <dd>{detail.cost || "尚未记录"}</dd>
                </div>
                <div>
                  <dt>限制</dt>
                  <dd>{detail.limits || "尚未记录"}</dd>
                </div>
              </dl>
            </div>
          </>
        ) : (
          <div className="settings-detail-block">
            <p>尚未载入物品功法专用档案。</p>
          </div>
        )}
      </div>
    );
  }

  if (!detail) {
    return null;
  }

  if (section === "history") {
    return <DetailEmpty>还没有记录流转历史。</DetailEmpty>;
  }

  return (
    <div className="settings-character-domain">
      <div className="settings-detail-block">
        <h3>权利记录</h3>
        {detail.rights.length === 0 ? (
          <p>还没有记录归属、保管、位置、使用权或处置权。</p>
        ) : (
          <ul className="settings-character-records">
            {detail.rights.map((right) => (
              <li key={right.id}>
                <div>
                  <strong>
                    {itemRightTypeLabels[right.rightType]} · {right.holder.label ?? "未命名持有者"}
                  </strong>
                  <span>{formatValidity(right.validity)}</span>
                </div>
                <p>{right.reason}</p>
                <small>
                  {right.sharePercent !== null ? `份额 ${right.sharePercent}% · ` : ""}
                  {right.evidence.length > 0
                    ? `来源证据 ${right.evidence.length} 条`
                    : "来源：作者补录"}
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TimelineDomainView({
  detail,
  entity,
  error,
  loading,
  onRetry,
  section,
}: {
  detail: WorldTimeline | null;
  entity: Extract<SettingEntity, { type: "timeline_event" }>;
  error: string;
  loading: boolean;
  onRetry: () => void;
  section: EntityDetailSection;
}) {
  const selectedEvent = detail?.events.find((event) => event.event.id === entity.id) ?? null;
  if (section === "references" || section === "health") {
    return null;
  }

  if (section === "overview") {
    return (
      <div className="settings-character-domain">
        {loading ? (
          <div className="settings-detail-block settings-character-loading" role="status">
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
            <span>正在加载故事时间线</span>
          </div>
        ) : error ? (
          <div className="settings-detail-block settings-character-error" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{error}</span>
            <button className="text-btn small" onClick={onRetry} type="button">
              重试
            </button>
          </div>
        ) : (
          <>
            <div className="settings-golden-grid">
              <div>
                <span>纪元</span>
                <strong>{selectedEvent?.storyTime.era ?? entity.data.era ?? "未记录"}</strong>
              </div>
              <div>
                <span>故事时间</span>
                <strong>{selectedEvent?.storyTime.label ?? entity.data.storyTime}</strong>
              </div>
              <div>
                <span>持续时长</span>
                <strong>{selectedEvent?.durationLabel || entity.data.duration || "未记录"}</strong>
              </div>
              <div>
                <span>事件</span>
                <strong>{selectedEvent?.eventText ?? entity.data.event}</strong>
              </div>
            </div>
            {selectedEvent ? (
              <div className="settings-detail-block">
                <h3>生效范围</h3>
                <p>{formatValidity(selectedEvent.validity)}</p>
              </div>
            ) : null}
          </>
        )}
      </div>
    );
  }

  if (!detail) {
    return null;
  }

  if (section === "relations") {
    return (
      <div className="settings-character-domain">
        <div className="settings-detail-block">
          <h3>角色行程</h3>
          {detail.itineraries.length === 0 ? (
            <p>还没有记录角色行程。</p>
          ) : (
            <ul className="settings-character-records">
              {detail.itineraries.map((itinerary) => (
                <li key={itinerary.id}>
                  <div>
                    <strong>
                      {itinerary.character.label ?? "未命名人物"} ·{" "}
                      {itinerary.fromNode.label ?? "未命名地点"} →{" "}
                      {itinerary.toNode.label ?? "未命名地点"}
                    </strong>
                    <span>{itinerary.travelMinutes} 分钟</span>
                  </div>
                  <small>
                    {itinerary.departure.era} · {itinerary.departure.label} 至{" "}
                    {itinerary.arrival.label}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-character-domain">
      <div className="settings-detail-block">
        <h3>事件序列</h3>
        {detail.events.length === 0 ? (
          <p>还没有记录故事事件。</p>
        ) : (
          <ul className="settings-character-records">
            {detail.events.map((event) => (
              <li key={event.event.id}>
                <div>
                  <strong>
                    {event.storyTime.era} · {event.storyTime.label}
                  </strong>
                  <span>{event.event.label ?? "未命名事件"}</span>
                </div>
                <p>{event.eventText}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function WorldHealth({
  findings,
  showHeading = true,
}: {
  findings: Array<{ code: string; severity: "info" | "warning" | "blocker"; message: string }>;
  showHeading?: boolean;
}) {
  return (
    <div className="settings-detail-block">
      {showHeading ? <h3>设定体检</h3> : null}
      {findings.length === 0 ? (
        <p>基础检查通过。</p>
      ) : (
        <ul className="settings-health-list">
          {findings.map((finding, index) => (
            <li className={`severity-${finding.severity}`} key={`${finding.code}-${index}`}>
              <span>{finding.severity === "blocker" ? "阻断" : "提醒"}</span>
              <p>{finding.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConfirmedSettings({ items }: { items: ConfirmedSetting[] }) {
  return (
    <section className="panel confirmed-settings" aria-labelledby="confirmed-settings-title">
      <div className="panel-head">
        <div>
          <span className="panel-kicker">只读视图</span>
          <h2 id="confirmed-settings-title">已确认设定</h2>
          <p>这里的内容已锁定，后续写作会把它作为稳定边界。</p>
        </div>
        <span className="badge">{items.length} 条</span>
      </div>
      {items.length === 0 ? (
        <div className="confirmed-settings-empty">
          <Check size={18} aria-hidden="true" />
          <p>还没有已确认设定。锁定世界规则、人物档案或金手指后会出现在这里。</p>
        </div>
      ) : (
        <div className="confirmed-settings-list">
          {items.map((item) => (
            <article key={item.id}>
              <div>
                <span className="tag">
                  {item.kind === "fact" ? "章节事实" : typeLabels[item.type]}
                </span>
                <strong>{item.name}</strong>
              </div>
              <p>{item.summary}</p>
              <div className="confirmed-setting-meta">
                <span>来源：{sourceLabels[item.source]}</span>
                <span>状态：已确认</span>
                <span>第 {item.version} 版</span>
                <span>{formatDateTime(item.lockedAt)} 锁定</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function emptyEditor(type: SettingEntityType): EditorState {
  return {
    mode: "create",
    type,
    name: "",
    aliases: "",
    summary: "",
    description: "",
    tags: "",
    rule: "",
    desire: "",
    fear: "",
    goal: "",
    voiceSample: "",
    voiceGuide: "",
    disguise: "",
    goldenRules: "",
    cost: "",
    limits: "",
    growth: "",
    details: "",
    itemCategory: "",
    itemGrade: "",
    itemEffect: "",
    itemCost: "",
    itemOwnership: "",
    itemLimits: "",
    itemKind: "item",
    itemOwnershipModel: "shared",
    itemConsumable: false,
    itemQuantity: 1,
    itemEquipmentSlot: "",
    mechanismType: "特殊机制",
    powerLifespanMode: "none",
    powerLifespanUnit: "年",
    powerLifespanBasis: "",
    powerLifespanDescription: "",
    powerLifespanFixedAmount: "",
    timelineEra: "",
    timelineStoryTime: "",
    timelineStorySortKey: 0,
    timelineDuration: "",
    timelineDurationMinutes: 0,
    timelineEvent: "",
    timelineValidity: {
      fromChapter: 1,
      toChapter: null,
      fromStoryTime: null,
      toStoryTime: null,
    },
    customFields: {},
    requestTitle: "",
    requestReason: "",
  };
}

function editorFromEntity(entity: SettingEntity): EditorState {
  return {
    mode: "edit",
    entityId: entity.id,
    version: entity.version,
    type: entity.type,
    name: entity.name,
    aliases: entity.aliases.join("，"),
    summary: entity.summary,
    description: entity.description,
    tags: entity.tags.join("，"),
    rule: entity.type === "world_rule" ? entity.data.rule : "",
    desire: "",
    fear: "",
    goal: "",
    voiceSample: "",
    voiceGuide: "",
    disguise: "",
    goldenRules: entity.type === "golden_finger" ? entity.data.rules : "",
    cost: entity.type === "golden_finger" ? entity.data.cost : "",
    limits: entity.type === "golden_finger" ? entity.data.limits : "",
    growth: entity.type === "golden_finger" ? entity.data.growth : "",
    details:
      entity.type === "faction" || entity.type === "map" || entity.type === "power_system"
        ? entity.data.details
        : "",
    itemCategory: entity.type === "item" ? entity.data.category : "",
    itemGrade: entity.type === "item" ? entity.data.grade : "",
    itemEffect: entity.type === "item" ? entity.data.effect : "",
    itemCost: entity.type === "item" ? entity.data.cost : "",
    itemOwnership: entity.type === "item" ? entity.data.ownership : "",
    itemLimits: entity.type === "item" ? entity.data.limits : "",
    itemKind: "item",
    itemOwnershipModel: "shared",
    itemConsumable: false,
    itemQuantity: 1,
    itemEquipmentSlot: "",
    mechanismType: "特殊机制",
    powerLifespanMode: "none",
    powerLifespanUnit: "年",
    powerLifespanBasis: "",
    powerLifespanDescription: "",
    powerLifespanFixedAmount: "",
    timelineEra: entity.type === "timeline_event" ? entity.data.era : "",
    timelineStoryTime: entity.type === "timeline_event" ? entity.data.storyTime : "",
    timelineStorySortKey: 0,
    timelineDuration: entity.type === "timeline_event" ? entity.data.duration : "",
    timelineDurationMinutes: 0,
    timelineEvent: entity.type === "timeline_event" ? entity.data.event : "",
    timelineValidity: {
      fromChapter: 1,
      toChapter: null,
      fromStoryTime: null,
      toStoryTime: null,
    },
    customFields: { ...entity.customFields },
    requestTitle: "",
    requestReason: "",
  };
}

function createPayload(editor: EditorState): SettingEntityCreateRequest {
  const common = {
    name: editor.name.trim(),
    aliases: splitList(editor.aliases),
    summary: editor.summary.trim(),
    description: editor.description.trim(),
    tags: splitList(editor.tags),
    customFields: compactCustomFields(editor.customFields),
  };
  if (editor.type === "world_rule") {
    return { type: "world_rule", ...common, data: { rule: editor.rule.trim() } };
  }
  if (editor.type === "character") {
    throw new Error("人物必须通过专用接口创建。");
  }
  if (editor.type === "faction" || editor.type === "map" || editor.type === "power_system") {
    return {
      type: editor.type,
      ...common,
      data: { details: editor.details.trim() },
    };
  }
  if (editor.type === "golden_finger") {
    return {
      type: "golden_finger",
      ...common,
      data: {
        rules: editor.goldenRules.trim(),
        cost: editor.cost.trim(),
        limits: editor.limits.trim(),
        growth: editor.growth.trim(),
      },
    };
  }
  if (editor.type === "item") {
    return {
      type: "item",
      ...common,
      data: {
        category: editor.itemCategory.trim(),
        grade: editor.itemGrade.trim(),
        effect: editor.itemEffect.trim(),
        cost: editor.itemCost.trim(),
        ownership: editor.itemOwnership.trim(),
        limits: editor.itemLimits.trim(),
      },
    };
  }
  return {
    type: "timeline_event",
    ...common,
    data: {
      era: editor.timelineEra.trim(),
      storyTime: editor.timelineStoryTime.trim(),
      duration: editor.timelineDuration.trim(),
      event: editor.timelineEvent.trim(),
    },
  };
}

function patchPayload(editor: EditorState) {
  return {
    version: editor.version,
    ...changePayload(editor),
  };
}

function changePayload(editor: EditorState) {
  const common = {
    name: editor.name.trim(),
    aliases: splitList(editor.aliases),
    summary: editor.summary.trim(),
    description: editor.description.trim(),
    tags: splitList(editor.tags),
    customFields: compactCustomFields(editor.customFields),
  };
  if (editor.type === "world_rule") {
    return { ...common, data: { rule: editor.rule.trim() } };
  }
  if (editor.type === "character") {
    return {
      ...common,
      character: {
        desire: editor.desire.trim(),
        fear: editor.fear.trim(),
        goal: editor.goal.trim(),
        voiceSample: editor.voiceSample.trim(),
        voiceGuide: editor.voiceGuide.trim(),
        disguise: editor.disguise.trim(),
      },
    };
  }
  if (editor.type === "faction") {
    return {
      ...common,
      faction: { overview: editor.details.trim() },
    };
  }
  if (editor.type === "map") {
    return { ...common, map: { details: editor.details.trim() } };
  }
  if (editor.type === "power_system") {
    return {
      ...common,
      powerSystem: {
        overview: editor.details.trim(),
        lifespanPolicy: lifespanPolicyFromEditor(editor),
      },
    };
  }
  if (editor.type === "golden_finger") {
    return {
      ...common,
      mechanism: {
        mechanismType: editor.mechanismType.trim(),
        rules: editor.goldenRules.trim(),
        costs: editor.cost.trim(),
        limits: editor.limits.trim(),
        growth: editor.growth.trim(),
      },
    };
  }
  if (editor.type === "item") {
    return {
      ...common,
      item: {
        kind: editor.itemKind,
        category: editor.itemCategory.trim(),
        grade: editor.itemGrade.trim(),
        effect: editor.itemEffect.trim(),
        cost: editor.itemCost.trim(),
        limits: editor.itemLimits.trim(),
        ownershipModel: editor.itemOwnershipModel,
        consumable: editor.itemConsumable,
        equipmentSlot: editor.itemEquipmentSlot.trim() || null,
      },
    };
  }
  return {
    ...common,
    timeline: {
      era: editor.timelineEra.trim(),
      storyTime: {
        era: editor.timelineEra.trim(),
        label: editor.timelineStoryTime.trim(),
        sortKey: editor.timelineStorySortKey,
      },
      durationMinutes: editor.timelineDurationMinutes,
      durationLabel: editor.timelineDuration.trim(),
      event: editor.timelineEvent.trim(),
      validity: editor.timelineValidity,
    },
  };
}

async function mutateEntity(
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
  fallback: string,
): Promise<SettingEntity> {
  const csrfToken = await getCsrfToken();
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  return settingEntityResponseSchema.parse(await response.json()).data;
}

function characterProfileFromEditor(editor: EditorState) {
  return {
    desire: editor.desire.trim(),
    fear: editor.fear.trim(),
    goal: editor.goal.trim(),
    voiceSample: editor.voiceSample.trim(),
    voiceGuide: editor.voiceGuide.trim(),
    disguise: editor.disguise.trim(),
  };
}

async function createCharacterEntity(
  work: WorkOverview,
  editor: EditorState,
): Promise<{ id: string; name: string }> {
  const csrfToken = await getCsrfToken();
  const response = await fetch(`${settingsPath(work)}/characters`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({
      name: editor.name.trim(),
      aliases: splitList(editor.aliases),
      summary: editor.summary.trim(),
      description: editor.description.trim(),
      tags: splitList(editor.tags),
      profile: characterProfileFromEditor(editor),
    }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "人物创建失败。"));
  }
  const detail = characterDetailResponseSchema.parse(await response.json()).data;
  const customFields = compactCustomFields(editor.customFields);
  if (Object.keys(customFields).length > 0) {
    const metadataResponse = await fetch(`${settingsPath(work)}/entities/${detail.character.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ version: detail.version, customFields }),
    });
    if (!metadataResponse.ok) {
      throw new Error(await readError(metadataResponse, "人物自定义字段保存失败。"));
    }
  }
  return { id: detail.character.id, name: detail.character.label ?? editor.name };
}

async function updateCharacterEntity(
  work: WorkOverview,
  editor: EditorState,
): Promise<{ id: string; name: string }> {
  if (!editor.entityId || !editor.version) {
    throw new Error("人物版本缺失，请刷新后重试。");
  }
  const csrfToken = await getCsrfToken();
  const response = await fetch(`${settingsPath(work)}/characters/${editor.entityId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({
      version: editor.version,
      name: editor.name.trim(),
      aliases: splitList(editor.aliases),
      summary: editor.summary.trim(),
      description: editor.description.trim(),
      tags: splitList(editor.tags),
      customFields: compactCustomFields(editor.customFields),
      profile: characterProfileFromEditor(editor),
    }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "人物保存失败。"));
  }
  const detail = characterDetailResponseSchema.parse(await response.json()).data;
  return { id: detail.character.id, name: detail.character.label ?? editor.name };
}

async function updateWorldEntity(
  work: WorkOverview,
  editor: EditorState,
): Promise<{ id: string; name: string }> {
  if (!editor.entityId || !editor.version) {
    throw new Error("设定版本缺失，请刷新后重试。");
  }
  const basePath = settingsPath(work);
  const common = {
    version: editor.version,
    name: editor.name.trim(),
    aliases: splitList(editor.aliases),
    summary: editor.summary.trim(),
    description: editor.description.trim(),
    tags: splitList(editor.tags),
    customFields: compactCustomFields(editor.customFields),
  };
  const path =
    editor.type === "faction"
      ? `${basePath}/world/factions/${editor.entityId}`
      : editor.type === "map"
        ? `${basePath}/world/maps/${editor.entityId}`
        : `${basePath}/world/timeline/events/${editor.entityId}`;
  const body =
    editor.type === "faction"
      ? { ...common, profile: { overview: editor.details.trim() } }
      : editor.type === "map"
        ? { ...common, details: editor.details.trim() }
        : {
            ...common,
            era: editor.timelineEra.trim(),
            storyTime: {
              era: editor.timelineEra.trim(),
              label: editor.timelineStoryTime.trim(),
              sortKey: editor.timelineStorySortKey,
            },
            durationMinutes: editor.timelineDurationMinutes,
            durationLabel: editor.timelineDuration.trim(),
            event: editor.timelineEvent.trim(),
            validity: editor.timelineValidity,
          };
  const csrfToken = await getCsrfToken();
  const response = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "设定保存失败。"));
  }
  if (editor.type === "faction") {
    const detail = factionDetailResponseSchema.parse(await response.json()).data;
    return { id: detail.faction.id, name: detail.faction.label ?? editor.name };
  }
  if (editor.type === "map") {
    const detail = mapDetailResponseSchema.parse(await response.json()).data;
    return { id: detail.map.id, name: detail.map.label ?? editor.name };
  }
  const detail = timelineEventResponseSchema.parse(await response.json()).data;
  return { id: detail.event.id, name: detail.event.label ?? editor.name };
}

async function createWorldEntity(
  work: WorkOverview,
  editor: EditorState,
): Promise<{ id: string; name: string }> {
  const path =
    editor.type === "faction"
      ? `${settingsPath(work)}/world/factions`
      : `${settingsPath(work)}/world/maps`;
  const common = {
    name: editor.name.trim(),
    aliases: splitList(editor.aliases),
    summary: editor.summary.trim(),
    description: editor.description.trim(),
    tags: splitList(editor.tags),
  };
  const body =
    editor.type === "faction"
      ? {
          ...common,
          profile: {
            overview: editor.details.trim(),
            goals: "",
            resources: "",
            doctrine: "",
          },
        }
      : { ...common, details: editor.details.trim() };
  const csrfToken = await getCsrfToken();
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "设定创建失败。"));
  }
  if (editor.type === "faction") {
    const detail = factionDetailResponseSchema.parse(await response.json()).data;
    return {
      id: detail.faction.id,
      name: detail.faction.label ?? editor.name,
    };
  }
  const detail = mapDetailResponseSchema.parse(await response.json()).data;
  return {
    id: detail.map.id,
    name: detail.map.label ?? editor.name,
  };
}

function lifespanPolicyFromEditor(editor: EditorState) {
  return {
    mode: editor.powerLifespanMode,
    unit: editor.powerLifespanUnit.trim() || "年",
    basis: editor.powerLifespanBasis.trim(),
    description: editor.powerLifespanDescription.trim(),
    pathId: null,
    fixedAmount:
      editor.powerLifespanMode === "fixed"
        ? Math.max(1, Number(editor.powerLifespanFixedAmount) || 1)
        : null,
  };
}

async function createPowerItemEntity(
  work: WorkOverview,
  editor: EditorState,
): Promise<{ id: string; name: string }> {
  const basePath = settingsPath(work);
  const common = {
    name: editor.name.trim(),
    aliases: splitList(editor.aliases),
    summary: editor.summary.trim(),
    description: editor.description.trim(),
    tags: splitList(editor.tags),
  };
  const path =
    editor.type === "power_system"
      ? `${basePath}/world/power-systems`
      : editor.type === "golden_finger"
        ? `${basePath}/world/mechanisms`
        : `${basePath}/world/items`;
  const body =
    editor.type === "power_system"
      ? {
          ...common,
          overview: editor.details.trim(),
          lifespanPolicy: lifespanPolicyFromEditor(editor),
          paths: [],
        }
      : editor.type === "golden_finger"
        ? {
            ...common,
            mechanismType: editor.mechanismType.trim() || "特殊机制",
            owner: null,
            powerSystem: null,
            rules: editor.goldenRules.trim(),
            costs: editor.cost.trim(),
            limits: editor.limits.trim(),
            growth: editor.growth.trim(),
          }
        : {
            ...common,
            kind: editor.itemKind,
            category: editor.itemCategory.trim(),
            grade: editor.itemGrade.trim(),
            effect: editor.itemEffect.trim(),
            cost: editor.itemCost.trim(),
            limits: editor.itemLimits.trim(),
            ownershipModel: editor.itemOwnershipModel,
            consumable: editor.itemConsumable,
            quantity:
              editor.itemOwnershipModel === "unique"
                ? 1
                : Math.max(1, Math.floor(editor.itemQuantity) || 1),
            equipmentSlot:
              editor.itemKind === "equipment" ? editor.itemEquipmentSlot.trim() || null : null,
          };
  const csrfToken = await getCsrfToken();
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "设定创建失败。"));
  }
  if (editor.type === "power_system") {
    const detail = powerSystemResponseSchema.parse(await response.json()).data;
    return {
      id: detail.powerSystem.id,
      name: detail.powerSystem.label ?? editor.name,
    };
  }
  if (editor.type === "golden_finger") {
    const detail = specialMechanismResponseSchema.parse(await response.json()).data;
    return {
      id: detail.mechanism.id,
      name: detail.mechanism.label ?? editor.name,
    };
  }
  const detail = itemResponseSchema.parse(await response.json()).data;
  return {
    id: detail.item.id,
    name: detail.item.label ?? editor.name,
  };
}

async function updatePowerItemEntity(
  work: WorkOverview,
  editor: EditorState,
): Promise<{ id: string; name: string }> {
  if (!editor.entityId || !editor.version) {
    throw new Error("设定版本缺失，请刷新后重试。");
  }
  const basePath = settingsPath(work);
  const common = {
    version: editor.version,
    name: editor.name.trim(),
    aliases: splitList(editor.aliases),
    summary: editor.summary.trim(),
    description: editor.description.trim(),
    tags: splitList(editor.tags),
  };
  const path =
    editor.type === "power_system"
      ? `${basePath}/world/power-systems/${editor.entityId}`
      : editor.type === "golden_finger"
        ? `${basePath}/world/mechanisms/${editor.entityId}`
        : `${basePath}/world/items/${editor.entityId}`;
  const body =
    editor.type === "power_system"
      ? {
          ...common,
          overview: editor.details.trim(),
          lifespanPolicy: lifespanPolicyFromEditor(editor),
        }
      : editor.type === "golden_finger"
        ? {
            ...common,
            mechanismType: editor.mechanismType.trim() || "特殊机制",
            rules: editor.goldenRules.trim(),
            costs: editor.cost.trim(),
            limits: editor.limits.trim(),
            growth: editor.growth.trim(),
          }
        : {
            ...common,
            kind: editor.itemKind,
            category: editor.itemCategory.trim(),
            grade: editor.itemGrade.trim(),
            effect: editor.itemEffect.trim(),
            cost: editor.itemCost.trim(),
            limits: editor.itemLimits.trim(),
            ownershipModel: editor.itemOwnershipModel,
            consumable: editor.itemConsumable,
            equipmentSlot:
              editor.itemKind === "equipment" ? editor.itemEquipmentSlot.trim() || null : null,
          };
  const csrfToken = await getCsrfToken();
  const response = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "设定保存失败。"));
  }
  if (editor.type === "power_system") {
    const detail = powerSystemResponseSchema.parse(await response.json()).data;
    return {
      id: detail.powerSystem.id,
      name: detail.powerSystem.label ?? editor.name,
    };
  }
  if (editor.type === "golden_finger") {
    const detail = specialMechanismResponseSchema.parse(await response.json()).data;
    return {
      id: detail.mechanism.id,
      name: detail.mechanism.label ?? editor.name,
    };
  }
  const detail = itemResponseSchema.parse(await response.json()).data;
  return {
    id: detail.item.id,
    name: detail.item.label ?? editor.name,
  };
}

async function mutateProposal(
  path: string,
  body: Record<string, unknown>,
  fallback: string,
): Promise<SettingProposal> {
  const csrfToken = await getCsrfToken();
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  return settingProposalResponseSchema.parse(await response.json()).data;
}

async function mutateChangeRequest(
  path: string,
  body: Record<string, unknown>,
  fallback: string,
): Promise<SettingChangeRequest> {
  const csrfToken = await getCsrfToken();
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  return settingChangeRequestResponseSchema.parse(await response.json()).data;
}

async function mutateCustomField(
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
  fallback: string,
): Promise<CustomFieldDefinition> {
  const csrfToken = await getCsrfToken();
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  return customFieldDefinitionResponseSchema.parse(await response.json()).data;
}

async function mutateDelete(path: string, fallback: string) {
  const csrfToken = await getCsrfToken();
  const response = await fetch(path, {
    method: "DELETE",
    headers: { "x-csrf-token": csrfToken },
  });
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  return settingEntityDeleteResponseSchema.parse(await response.json()).data;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : fallback;
}

function splitList(value: string): string[] {
  return value
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function compactCustomFields(
  values: Record<string, CustomFieldValue | null>,
): Record<string, CustomFieldValue | null> {
  const next: Record<string, CustomFieldValue | null> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === "") {
      continue;
    }
    next[key] = value;
  }
  return next;
}

function authorNote(reason: string) {
  return {
    kind: "author_note" as const,
    sourceId: null,
    label: "作者说明",
    quote: reason.trim() || "作者提交的设定变更",
    locator: "",
    confidence: null,
  };
}

function formatCustomFieldValue(value: CustomFieldValue | undefined): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join("、") : "未填写";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (value === undefined || value === null || value === "") {
    return "未填写";
  }
  return String(value);
}

function blankFieldForm(): FieldFormState {
  return {
    key: "",
    label: "",
    fieldType: "text",
    appliesTo: "all",
    required: false,
    options: "",
    relationTarget: null,
    sortOrder: "0",
  };
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatValidity(validity: CharacterDetail["relationships"][number]["validity"]): string {
  const chapterRange =
    validity.toChapter === null
      ? `第 ${validity.fromChapter} 章起`
      : `第 ${validity.fromChapter}–${validity.toChapter} 章`;
  const storyRange = validity.fromStoryTime
    ? [
        validity.fromStoryTime.era,
        validity.fromStoryTime.label,
        validity.toStoryTime ? `至 ${validity.toStoryTime.label}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  return storyRange ? `${chapterRange} · ${storyRange}` : chapterRange;
}

function worldDetailErrorLabel(type: SettingEntityType): string {
  if (type === "faction") {
    return "势力档案加载失败。";
  }
  if (type === "map") {
    return "地图档案加载失败。";
  }
  if (type === "timeline_event") {
    return "故事时间线加载失败。";
  }
  if (type === "power_system") {
    return "力量体系加载失败。";
  }
  if (type === "golden_finger") {
    return "特殊机制加载失败。";
  }
  if (type === "item") {
    return "物品功法加载失败。";
  }
  return "世界设定加载失败。";
}

function settingsPath(work: WorkOverview): string {
  return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
}

function settingsUrl(workId: string, column?: ColumnKey, entityId?: string): string {
  const params = new URLSearchParams();
  if (column) {
    params.set("column", column);
  }
  if (entityId) {
    params.set("entityId", entityId);
  }
  const query = params.toString();
  return `/workspace/${workId}/settings${query ? `?${query}` : ""}`;
}

function columnForType(type: SettingEntityType): ColumnKey {
  if (type === "world_rule") {
    return "world";
  }
  if (type === "character") {
    return "characters";
  }
  if (type === "faction") {
    return "factions";
  }
  if (type === "map") {
    return "map";
  }
  if (type === "item") {
    return "items";
  }
  if (type === "timeline_event") {
    return "timeline";
  }
  return "power";
}

function typeForColumn(column: ColumnKey): SettingEntityType {
  if (column === "characters") {
    return "character";
  }
  if (column === "factions") {
    return "faction";
  }
  if (column === "map") {
    return "map";
  }
  if (column === "power") {
    return "power_system";
  }
  if (column === "items") {
    return "item";
  }
  if (column === "timeline") {
    return "timeline_event";
  }
  return "world_rule";
}

function entitiesForColumn(entities: SettingEntity[], column: ColumnKey): SettingEntity[] {
  if (column === "power") {
    return entities.filter(
      (entity) => entity.type === "power_system" || entity.type === "golden_finger",
    );
  }
  const type = typeForColumn(column);
  return entities.filter((entity) => entity.type === type);
}

function columnDescription(column: ColumnKey): string {
  const descriptions: Record<ColumnKey, string> = {
    world: "记录不可违背的世界规则，以及规则生效的边界。",
    characters: "记录人物欲望、恐惧、目标、声线与伪装。",
    factions: "势力、控制区和组织关系。",
    map: "地点层级、旅行时间和地图标记。",
    power: "记录力量体系，以及金手指的规则、代价、限制和成长。",
    items: "物品、功法、归属和流转。",
    timeline: "故事时间、事件和行程。",
  };
  return descriptions[column];
}
