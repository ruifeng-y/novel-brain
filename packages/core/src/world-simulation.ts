export interface MapGraphNode {
  id: string;
  mapId: string;
}

export interface MapGraphEdge {
  id: string;
  mapId: string;
  fromNodeId: string;
  toNodeId: string;
  bidirectional: boolean;
  travelMinutes: number;
}

export interface MapRouteResult {
  pathNodeIds: string[];
  edgeIds: string[];
  travelMinutes: number;
}

export function findShortestMapRoute(
  nodes: MapGraphNode[],
  edges: MapGraphEdge[],
  fromNodeId: string,
  toNodeId: string,
): MapRouteResult | null {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const fromNode = nodesById.get(fromNodeId);
  const toNode = nodesById.get(toNodeId);
  if (!fromNode || !toNode || fromNode.mapId !== toNode.mapId) {
    return null;
  }
  if (fromNodeId === toNodeId) {
    return { pathNodeIds: [fromNodeId], edgeIds: [], travelMinutes: 0 };
  }

  const outgoing = new Map<string, Array<{ nodeId: string; edge: MapGraphEdge }>>();
  for (const edge of edges) {
    if (
      edge.mapId !== fromNode.mapId ||
      !nodesById.has(edge.fromNodeId) ||
      !nodesById.has(edge.toNodeId)
    ) {
      continue;
    }
    appendNeighbor(outgoing, edge.fromNodeId, edge.toNodeId, edge);
    if (edge.bidirectional) {
      appendNeighbor(outgoing, edge.toNodeId, edge.fromNodeId, edge);
    }
  }

  const distances = new Map<string, number>([[fromNodeId, 0]]);
  const previous = new Map<string, { nodeId: string; edgeId: string }>();
  const pending = new Set(nodes.map((node) => node.id));
  while (pending.size > 0) {
    const current = [...pending]
      .filter((nodeId) => distances.has(nodeId))
      .sort(
        (left, right) => distances.get(left)! - distances.get(right)! || left.localeCompare(right),
      )[0];
    if (!current || current === toNodeId) {
      break;
    }
    pending.delete(current);
    for (const neighbor of outgoing.get(current) ?? []) {
      if (!pending.has(neighbor.nodeId)) {
        continue;
      }
      const candidate = distances.get(current)! + neighbor.edge.travelMinutes;
      const known = distances.get(neighbor.nodeId);
      if (known === undefined || candidate < known) {
        distances.set(neighbor.nodeId, candidate);
        previous.set(neighbor.nodeId, { nodeId: current, edgeId: neighbor.edge.id });
      }
    }
  }

  const total = distances.get(toNodeId);
  if (total === undefined) {
    return null;
  }
  const pathNodeIds = [toNodeId];
  const edgeIds: string[] = [];
  let cursor = toNodeId;
  while (cursor !== fromNodeId) {
    const step = previous.get(cursor);
    if (!step) {
      return null;
    }
    edgeIds.unshift(step.edgeId);
    pathNodeIds.unshift(step.nodeId);
    cursor = step.nodeId;
  }
  return { pathNodeIds, edgeIds, travelMinutes: total };
}

function appendNeighbor(
  outgoing: Map<string, Array<{ nodeId: string; edge: MapGraphEdge }>>,
  fromNodeId: string,
  nodeId: string,
  edge: MapGraphEdge,
): void {
  const neighbors = outgoing.get(fromNodeId) ?? [];
  neighbors.push({ nodeId, edge });
  outgoing.set(fromNodeId, neighbors);
}

export interface ItineraryScheduleInput {
  characterId: string;
  departureSortKey: number;
  arrivalSortKey: number;
  travelMinutes: number;
}

export interface ExistingItinerarySchedule {
  id: string;
  characterId: string;
  departureSortKey: number;
  arrivalSortKey: number;
}

export type ItineraryConflictCode =
  "ITINERARY_TIME_ORDER" | "ITINERARY_TRAVEL_TIME" | "ITINERARY_OVERLAP";

export interface ItineraryConflict {
  code: ItineraryConflictCode;
  relatedId?: string;
}

export function validateItinerarySchedule(
  input: ItineraryScheduleInput,
  existing: ExistingItinerarySchedule[],
): ItineraryConflict[] {
  const findings: ItineraryConflict[] = [];
  if (input.arrivalSortKey <= input.departureSortKey) {
    findings.push({ code: "ITINERARY_TIME_ORDER" });
  }
  if (input.arrivalSortKey - input.departureSortKey < input.travelMinutes) {
    findings.push({ code: "ITINERARY_TRAVEL_TIME" });
  }
  for (const itinerary of existing) {
    if (
      itinerary.characterId === input.characterId &&
      itinerary.departureSortKey < input.arrivalSortKey &&
      itinerary.arrivalSortKey > input.departureSortKey
    ) {
      findings.push({ code: "ITINERARY_OVERLAP", relatedId: itinerary.id });
    }
  }
  return findings;
}

export interface ControlAreaInterval {
  id: string;
  factionId: string;
  nodeId: string;
  validFromChapter: number;
  validToChapter: number | null;
}

export interface ControlAreaConflict {
  code: "CONTROL_AREA_OVERLAP";
  leftId: string;
  rightId: string;
  nodeId: string;
}

export function findControlAreaConflicts(
  territories: ControlAreaInterval[],
): ControlAreaConflict[] {
  const conflicts: ControlAreaConflict[] = [];
  const sorted = [...territories].sort(
    (left, right) =>
      left.nodeId.localeCompare(right.nodeId) ||
      left.validFromChapter - right.validFromChapter ||
      left.id.localeCompare(right.id),
  );
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    const left = sorted[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
      const right = sorted[rightIndex]!;
      if (left.nodeId !== right.nodeId || left.factionId === right.factionId) {
        continue;
      }
      if (
        (left.validToChapter === null || left.validToChapter >= right.validFromChapter) &&
        (right.validToChapter === null || right.validToChapter >= left.validFromChapter)
      ) {
        conflicts.push({
          code: "CONTROL_AREA_OVERLAP",
          leftId: left.id,
          rightId: right.id,
          nodeId: left.nodeId,
        });
      }
    }
  }
  return conflicts;
}

export interface TimelineEraOrder {
  id: string;
  name: string;
  orderIndex: number;
}

export interface TimelineEventOrder {
  id: string;
  era: string;
  sortKey: number;
}

export function sortTimelineEvents<T extends TimelineEventOrder>(
  eras: TimelineEraOrder[],
  events: T[],
): T[] {
  const eraOrder = new Map(eras.map((era) => [era.name, era.orderIndex] as const));
  return [...events].sort(
    (left, right) =>
      (eraOrder.get(left.era) ?? Number.MAX_SAFE_INTEGER) -
        (eraOrder.get(right.era) ?? Number.MAX_SAFE_INTEGER) ||
      left.sortKey - right.sortKey ||
      left.id.localeCompare(right.id),
  );
}

export interface TimelineOrderConflict {
  code: "TIMELINE_EVENT_OVERLAP";
  era: string;
  sortKey: number;
  eventIds: string[];
}

export function findTimelineOrderConflicts(events: TimelineEventOrder[]): TimelineOrderConflict[] {
  const groups = new Map<string, TimelineEventOrder[]>();
  for (const event of events) {
    const key = `${event.era}\u0000${event.sortKey}`;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      code: "TIMELINE_EVENT_OVERLAP" as const,
      era: group[0]!.era,
      sortKey: group[0]!.sortKey,
      eventIds: group.map((event) => event.id),
    }))
    .sort((left, right) => left.era.localeCompare(right.era) || left.sortKey - right.sortKey);
}
