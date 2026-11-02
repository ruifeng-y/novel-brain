import type {
  GoldenFingerInput,
  GoldenFingerUpdateInput,
  ItemTechniqueProfileInput,
  PowerSystemProfileInput,
  StoryAbsoluteDate,
  StoryDuration,
  TimelineEraInput,
  TimelineNodeInput,
} from '@novel/contracts';
import { apiRequest } from './auth-api';

export type PowerSystemProfile = PowerSystemProfileInput & {
  id: string | null;
  workId: string;
  branchId: string;
  entityId: string;
  totalLevels: number;
  totalPaths: number;
  totalBreakthroughs: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type BreakthroughCheck = {
  allowed: boolean;
  rule: PowerSystemProfile['breakthroughs'][number];
  missingConditions: string[];
  missingResources: Array<{
    name: string;
    required: number;
    available: number;
  }>;
};

export type GoldenFinger = {
  id: string;
  workId: string;
  branchId: string;
  ownerEntityId: string;
  ownerEntity: {
    id: string;
    name: string;
    type: string;
    typeLabel: string;
  };
  name: string;
  rules: string[];
  costs: string[];
  limits: string[];
  growthCurve: Array<{ stage: string; description: string }>;
  createdAt: string;
  updatedAt: string;
};

export type ItemOwnership = {
  id: string;
  itemEntityId: string;
  ownerEntityId: string;
  ownerEntity: {
    id: string;
    name: string;
    type: string;
    typeLabel: string;
  };
  fromTime: string;
  endedAt: string | null;
  source: string;
  current: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ItemTechniqueProfile = ItemTechniqueProfileInput & {
  id: string | null;
  workId: string;
  branchId: string;
  entityId: string;
  kindLabel: string;
  ownerships: ItemOwnership[];
  currentOwner: {
    ownershipId: string;
    ownerEntityId: string;
    ownerName: string;
    fromTime: string;
  } | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type TimelineEra = TimelineEraInput & {
  id: string;
  workId: string;
  branchId: string;
  timelineEntityId: string;
  startDateLabel: string;
  endDateLabel: string;
  createdAt: string;
  updatedAt: string;
};

export type TimelineEventNode = TimelineNodeInput & {
  id: string;
  workId: string;
  branchId: string;
  timelineEntityId: string;
  era: { id: string; name: string } | null;
  relativeToNode: { id: string; title: string } | null;
  absoluteDateLabel: string;
  durationLabel: string;
  createdAt: string;
  updatedAt: string;
};

export type Timeline = {
  workId: string;
  branchId: string;
  entityId: string;
  eras: TimelineEra[];
  nodes: TimelineEventNode[];
};

function worldbuildingPath(workId: string, branchId: string): string {
  return `/api/v1/works/${encodeURIComponent(workId)}/branches/${encodeURIComponent(branchId)}`;
}

export function loadPowerSystem(
  workId: string,
  branchId: string,
  entityId: string,
): Promise<PowerSystemProfile> {
  return apiRequest<PowerSystemProfile>(
    `${worldbuildingPath(workId, branchId)}/power-systems/${encodeURIComponent(entityId)}`,
  );
}

export function savePowerSystem(
  workId: string,
  branchId: string,
  entityId: string,
  input: PowerSystemProfileInput,
): Promise<PowerSystemProfile> {
  return apiRequest<PowerSystemProfile>(
    `${worldbuildingPath(workId, branchId)}/power-systems/${encodeURIComponent(entityId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  );
}

export function checkPowerBreakthrough(
  workId: string,
  branchId: string,
  entityId: string,
  input: {
    fromLevel: string;
    toLevel: string;
    conditionsMet: string[];
    resourcesAvailable: Array<{ name: string; amount: number }>;
  },
): Promise<BreakthroughCheck> {
  return apiRequest<BreakthroughCheck>(
    `${worldbuildingPath(workId, branchId)}/power-systems/${encodeURIComponent(entityId)}/breakthrough-check`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function loadGoldenFingers(
  workId: string,
  branchId: string,
  ownerEntityId: string,
): Promise<{ items: GoldenFinger[] }> {
  return apiRequest<{ items: GoldenFinger[] }>(
    `${worldbuildingPath(workId, branchId)}/golden-fingers?ownerEntityId=${encodeURIComponent(ownerEntityId)}`,
  );
}

export function createGoldenFinger(
  workId: string,
  branchId: string,
  input: GoldenFingerInput,
): Promise<GoldenFinger> {
  return apiRequest<GoldenFinger>(`${worldbuildingPath(workId, branchId)}/golden-fingers`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateGoldenFinger(
  workId: string,
  branchId: string,
  goldenFingerId: string,
  input: GoldenFingerUpdateInput,
): Promise<GoldenFinger> {
  return apiRequest<GoldenFinger>(
    `${worldbuildingPath(workId, branchId)}/golden-fingers/${encodeURIComponent(goldenFingerId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

export function loadItemTechnique(
  workId: string,
  branchId: string,
  entityId: string,
): Promise<ItemTechniqueProfile> {
  return apiRequest<ItemTechniqueProfile>(
    `${worldbuildingPath(workId, branchId)}/items-techniques/${encodeURIComponent(entityId)}`,
  );
}

export function saveItemTechnique(
  workId: string,
  branchId: string,
  entityId: string,
  input: ItemTechniqueProfileInput,
): Promise<ItemTechniqueProfile> {
  return apiRequest<ItemTechniqueProfile>(
    `${worldbuildingPath(workId, branchId)}/items-techniques/${encodeURIComponent(entityId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  );
}

export function createItemOwnership(
  workId: string,
  branchId: string,
  entityId: string,
  input: { ownerEntityId: string; fromTime: string; source: string },
): Promise<ItemOwnership> {
  return apiRequest<ItemOwnership>(
    `${worldbuildingPath(workId, branchId)}/items-techniques/${encodeURIComponent(entityId)}/ownerships`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function endItemOwnership(
  workId: string,
  branchId: string,
  entityId: string,
  ownershipId: string,
  endedAt: string,
): Promise<ItemOwnership> {
  return apiRequest<ItemOwnership>(
    `${worldbuildingPath(workId, branchId)}/items-techniques/${encodeURIComponent(entityId)}/ownerships/${encodeURIComponent(ownershipId)}/end`,
    {
      method: 'PATCH',
      body: JSON.stringify({ endedAt }),
    },
  );
}

export function loadTimeline(
  workId: string,
  branchId: string,
  entityId: string,
): Promise<Timeline> {
  return apiRequest<Timeline>(
    `${worldbuildingPath(workId, branchId)}/timelines/${encodeURIComponent(entityId)}`,
  );
}

export function createTimelineEra(
  workId: string,
  branchId: string,
  entityId: string,
  input: TimelineEraInput,
): Promise<TimelineEra> {
  return apiRequest<TimelineEra>(
    `${worldbuildingPath(workId, branchId)}/timelines/${encodeURIComponent(entityId)}/eras`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function createTimelineNode(
  workId: string,
  branchId: string,
  entityId: string,
  input: TimelineNodeInput,
): Promise<TimelineEventNode> {
  return apiRequest<TimelineEventNode>(
    `${worldbuildingPath(workId, branchId)}/timelines/${encodeURIComponent(entityId)}/nodes`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export type ParsedStoryDate = StoryAbsoluteDate;
export type ParsedStoryDuration = StoryDuration;
