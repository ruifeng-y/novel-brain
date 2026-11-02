import { ApiError } from './auth-api';

export type MapLevel = 'world' | 'realm' | 'continent' | 'region' | 'city' | 'location';

export type MapNode = {
  id: string;
  workId: string;
  branchId: string;
  entityId: string;
  name: string;
  summary: string;
  level: MapLevel;
  levelLabel: string;
  parentNodeId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MapConnection = {
  id: string;
  fromNode: {
    id: string;
    name: string;
    level: MapLevel;
    levelLabel: string;
  };
  toNode: {
    id: string;
    name: string;
    level: MapLevel;
    levelLabel: string;
  };
  travelMinutes: number;
  label: string;
};

export type MapFactionControl = {
  id: string;
  faction: {
    id: string;
    name: string;
  };
  place: {
    id: string;
    name: string;
    level: MapLevel;
    levelLabel: string;
  };
  validFrom: string | null;
  validTo: string | null;
  source: string;
};

export type MapMarker = {
  id: string;
  imageId: string;
  node: {
    id: string;
    name: string;
    level: MapLevel;
    levelLabel: string;
  };
  xPercent: number;
  yPercent: number;
};

export type MapImage = {
  id: string;
  nodeId: string;
  placeName: string;
  mimeType: string;
  width: number;
  height: number;
  size: number;
  contentUrl: string;
  markers: MapMarker[];
};

export type CharacterPresence = {
  id: string;
  character: {
    id: string;
    name: string;
  };
  location: {
    id: string;
    name: string;
    level: MapLevel;
    levelLabel: string;
  };
  storyTime: string;
  source: string;
};

export type MapConflict = {
  character: {
    id: string;
    name: string;
  };
  storyTime: string;
  locations: Array<{
    id: string;
    name: string;
    level: MapLevel;
    levelLabel: string;
  }>;
  presenceIds: string[];
};

export type MapOverview = {
  nodes: MapNode[];
  connections: MapConnection[];
  factionControls: MapFactionControl[];
  images: MapImage[];
  presences: CharacterPresence[];
  conflicts: MapConflict[];
};

function mapPath(workId: string, branchId: string): string {
  return `/api/v1/works/${encodeURIComponent(workId)}/branches/${encodeURIComponent(branchId)}/maps`;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      code?: string;
      message?: string;
    };
    throw new ApiError(response.status, payload.code, payload.message);
  }
  return (await response.json()) as T;
}

export function loadMapOverview(workId: string, branchId: string): Promise<MapOverview> {
  return fetch(mapPath(workId, branchId), { credentials: 'same-origin' }).then(
    parseResponse<MapOverview>,
  );
}

export function createMapNode(
  workId: string,
  branchId: string,
  input: {
    name: string;
    level: MapLevel;
    parentNodeId: string | null;
    summary: string;
  },
): Promise<MapNode> {
  return fetch(`${mapPath(workId, branchId)}/nodes`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then(parseResponse<MapNode>);
}

export function createMapConnection(
  workId: string,
  branchId: string,
  input: {
    fromNodeId: string;
    toNodeId: string;
    travelMinutes: number;
    label: string;
  },
): Promise<MapConnection> {
  return fetch(`${mapPath(workId, branchId)}/connections`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then(parseResponse<MapConnection>);
}

export function uploadMapImage(
  workId: string,
  branchId: string,
  nodeId: string,
  image: File,
): Promise<MapImage> {
  const body = new FormData();
  body.set('nodeId', nodeId);
  body.set('image', image);
  return fetch(`${mapPath(workId, branchId)}/images`, {
    method: 'POST',
    credentials: 'same-origin',
    body,
  }).then(parseResponse<MapImage>);
}

export function createMapMarker(
  workId: string,
  branchId: string,
  imageId: string,
  input: { nodeId: string; xPercent: number; yPercent: number },
): Promise<MapMarker> {
  return fetch(`${mapPath(workId, branchId)}/images/${encodeURIComponent(imageId)}/markers`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then(parseResponse<MapMarker>);
}

export function createCharacterPresence(
  workId: string,
  branchId: string,
  input: {
    characterEntityId: string;
    locationNodeId: string;
    storyTime: string;
    source: string;
  },
): Promise<CharacterPresence> {
  return fetch(`${mapPath(workId, branchId)}/presences`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then(parseResponse<CharacterPresence>);
}

export function deleteCharacterPresence(
  workId: string,
  branchId: string,
  presenceId: string,
): Promise<{ deleted: true }> {
  return fetch(`${mapPath(workId, branchId)}/presences/${encodeURIComponent(presenceId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  }).then(parseResponse<{ deleted: true }>);
}
