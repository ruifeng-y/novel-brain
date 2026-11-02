export type HistoryCheckKey =
  | 'anachronism'
  | 'official_hierarchy'
  | 'army_movement'
  | 'provisions'
  | 'geographic_distance';

export type HistoryCheckStatus = 'passed' | 'needs_attention' | 'not_applicable';

export type HistoryOfficial = {
  id: string;
  name: string;
  rank: number | null;
  superiorId: string | null;
};

export type HistoryArmy = {
  id: string;
  name: string;
  troops: number;
  provisionsShi: number;
};

export type HistoryArmyMovement = {
  army: HistoryArmy | null;
  fromNodeId: string;
  toNodeId: string;
  plannedDays: number;
};

export type HistoryRuleInput = {
  text?: string;
  officials: HistoryOfficial[];
  nodes: Array<{ id: string; name: string }>;
  connections: Array<{
    fromNodeId: string;
    toNodeId: string;
    travelMinutes: number;
  }>;
  armyMovement?: HistoryArmyMovement;
};

export type HistoryCheckIssue = {
  category: HistoryCheckKey;
  severity: 'warning';
  message: string;
  suggestion: string;
  sourceText: string;
  startOffset: number | null;
  endOffset: number | null;
  entityIds: string[];
};

export type HistoryCheckSummary = {
  key: HistoryCheckKey;
  label: string;
  status: HistoryCheckStatus;
  issueCount: number;
  summary: string;
};

export type HistoryCheckResult = {
  checks: HistoryCheckSummary[];
  issues: HistoryCheckIssue[];
};

export const HISTORY_ANACHRONISM_TERMS = [
  '互联网',
  '智能手机',
  '手机',
  '电话',
  '电脑',
  '电视',
  '电灯',
  '汽车',
  '火车',
  '飞机',
  '微信',
  '公司',
  '超市',
  '医院',
  '警察',
  '总统',
  '议会',
  '公里',
] as const;

const HISTORY_CHECK_LABELS: Record<HistoryCheckKey, string> = {
  anachronism: '时代错置',
  official_hierarchy: '官制层级',
  army_movement: '军队调动',
  provisions: '粮草',
  geographic_distance: '地理距离',
};

const DAILY_GRAIN_PER_SOLDIER_SHI = 0.02;

export function checkHistoryRules(input: HistoryRuleInput): HistoryCheckResult {
  const issues: HistoryCheckIssue[] = [];
  const checks: HistoryCheckSummary[] = [];

  const anachronismIssues = checkAnachronisms(input.text ?? '');
  issues.push(...anachronismIssues);
  checks.push(
    summary(
      'anachronism',
      (input.text ?? '').trim() ? anachronismIssues.length : null,
      anachronismIssues.length,
    ),
  );

  const hierarchyIssues = checkOfficialHierarchy(input.officials);
  issues.push(...hierarchyIssues);
  checks.push(
    summary(
      'official_hierarchy',
      input.officials.length > 0 ? hierarchyIssues.length : null,
      hierarchyIssues.length,
    ),
  );

  const proximity = input.armyMovement
    ? findShortestRoute(
        input.armyMovement.fromNodeId,
        input.armyMovement.toNodeId,
        input.connections,
      )
    : null;
  const movementIssues = checkArmyMovement(input, proximity);
  issues.push(...movementIssues);
  checks.push(
    summary(
      'army_movement',
      input.armyMovement ? movementIssues.length : null,
      movementIssues.length,
    ),
  );

  const provisionIssues = checkProvisions(input.armyMovement);
  issues.push(...provisionIssues);
  checks.push(
    summary(
      'provisions',
      input.armyMovement ? provisionIssues.length : null,
      provisionIssues.length,
    ),
  );

  const distanceIssues = checkGeographicDistance(input, proximity);
  issues.push(...distanceIssues);
  checks.push(
    summary(
      'geographic_distance',
      input.armyMovement && proximity ? distanceIssues.length : null,
      distanceIssues.length,
    ),
  );

  return { checks, issues };
}

function summary(
  key: HistoryCheckKey,
  applicableIssueCount: number | null,
  issueCount: number,
): HistoryCheckSummary {
  if (applicableIssueCount === null) {
    return {
      key,
      label: HISTORY_CHECK_LABELS[key],
      status: 'not_applicable',
      issueCount: 0,
      summary: `暂无可检查的${HISTORY_CHECK_LABELS[key]}资料。`,
    };
  }
  return {
    key,
    label: HISTORY_CHECK_LABELS[key],
    status: issueCount > 0 ? 'needs_attention' : 'passed',
    issueCount,
    summary:
      issueCount > 0
        ? `${HISTORY_CHECK_LABELS[key]}发现 ${issueCount} 个需要确认的问题。`
        : `${HISTORY_CHECK_LABELS[key]}未发现冲突。`,
  };
}

function checkAnachronisms(text: string): HistoryCheckIssue[] {
  if (!text.trim()) {
    return [];
  }
  const pattern = new RegExp(
    [...HISTORY_ANACHRONISM_TERMS]
      .sort((left, right) => right.length - left.length)
      .map((term) => escapeRegExp(term))
      .join('|'),
    'g',
  );

  return Array.from(text.matchAll(pattern)).map((match) => {
    const term = match[0];
    const startOffset = match.index;
    return {
      category: 'anachronism',
      severity: 'warning',
      message: `正文出现了不属于架空古代的“${term}”。`,
      suggestion: `删去“${term}”，或换成与当前朝代技术和制度相符的说法。`,
      sourceText: term,
      startOffset,
      endOffset: startOffset + term.length,
      entityIds: [],
    };
  });
}

function checkOfficialHierarchy(officials: HistoryOfficial[]): HistoryCheckIssue[] {
  if (officials.length === 0) {
    return [];
  }
  const byId = new Map(officials.map((official) => [official.id, official]));
  const issues: HistoryCheckIssue[] = [];

  for (const official of officials) {
    if (
      official.rank === null ||
      !Number.isInteger(official.rank) ||
      official.rank < 1 ||
      official.rank > 9
    ) {
      issues.push({
        category: 'official_hierarchy',
        severity: 'warning',
        message: `“${official.name}”还没有有效的官阶。`,
        suggestion: '在官制设定中填写 1 至 9 品的官阶，数字越小地位越高。',
        sourceText: official.name,
        startOffset: null,
        endOffset: null,
        entityIds: [official.id],
      });
    }

    if (!official.superiorId) {
      continue;
    }
    if (official.superiorId === official.id) {
      issues.push({
        category: 'official_hierarchy',
        severity: 'warning',
        message: `“${official.name}”不能把自己设为上级。`,
        suggestion: '改选更高一阶的官职，或留空表示这是本级最高长官。',
        sourceText: official.name,
        startOffset: null,
        endOffset: null,
        entityIds: [official.id],
      });
      continue;
    }

    const superior = byId.get(official.superiorId);
    if (!superior) {
      issues.push({
        category: 'official_hierarchy',
        severity: 'warning',
        message: `“${official.name}”的上级不在当前官制资料中。`,
        suggestion: '重新选择当前作品里的上级官职，或补充这条官制资料。',
        sourceText: official.name,
        startOffset: null,
        endOffset: null,
        entityIds: [official.id, official.superiorId],
      });
      continue;
    }

    if (
      official.rank !== null &&
      superior.rank !== null &&
      official.rank <= superior.rank
    ) {
      issues.push({
        category: 'official_hierarchy',
        severity: 'warning',
        message: `“${official.name}”是 ${official.rank} 品，却隶属于 ${superior.rank} 品的“${superior.name}”，上下级颠倒。`,
        suggestion: `让“${superior.name}”的品级高于“${official.name}”，或调整两者的隶属关系。`,
        sourceText: `${official.name} → ${superior.name}`,
        startOffset: null,
        endOffset: null,
        entityIds: [official.id, superior.id],
      });
    }
  }

  issues.push(...findHierarchyCycles(officials, byId));
  return issues;
}

function findHierarchyCycles(
  officials: HistoryOfficial[],
  byId: Map<string, HistoryOfficial>,
): HistoryCheckIssue[] {
  const visited = new Set<string>();
  const reported = new Set<string>();
  const issues: HistoryCheckIssue[] = [];

  for (const official of officials) {
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let current: HistoryOfficial | undefined = official;
    while (current?.superiorId && byId.has(current.superiorId)) {
      if (pathIndex.has(current.id)) {
        const cycleStart = pathIndex.get(current.id)!;
        const cycle = path.slice(cycleStart);
        const key = [...cycle].sort().join('|');
        if (!reported.has(key)) {
          reported.add(key);
          const names = cycle.map((id) => byId.get(id)?.name ?? id);
          issues.push({
            category: 'official_hierarchy',
            severity: 'warning',
            message: `官制层级出现循环：${names.join(' → ')}。`,
            suggestion: '打破循环，只保留一条明确的上下级关系。',
            sourceText: names.join(' → '),
            startOffset: null,
            endOffset: null,
            entityIds: cycle,
          });
        }
        break;
      }
      pathIndex.set(current.id, path.length);
      path.push(current.id);
      const nextId: string = current.superiorId;
      if (visited.has(nextId)) {
        break;
      }
      current = byId.get(nextId);
    }
    for (const id of path) {
      visited.add(id);
    }
  }

  return issues;
}

function checkArmyMovement(
  input: HistoryRuleInput,
  proximity: { travelMinutes: number; nodeIds: string[] } | null,
): HistoryCheckIssue[] {
  const movement = input.armyMovement;
  if (!movement) {
    return [];
  }
  if (!movement.army) {
    return [
      {
        category: 'army_movement',
        severity: 'warning',
        message: '没有找到这支军队的兵力与粮草资料。',
        suggestion: '先在设定中心建立军制条目，填写兵力和随军粮草。',
        sourceText: '',
        startOffset: null,
        endOffset: null,
        entityIds: [],
      },
    ];
  }
  if (movement.fromNodeId === movement.toNodeId) {
    return [
      {
        category: 'army_movement',
        severity: 'warning',
        message: `“${movement.army.name}”的出发地和目的地相同。`,
        suggestion: '选择两个不同的地点，或删去这次调动安排。',
        sourceText: movement.army.name,
        startOffset: null,
        endOffset: null,
        entityIds: [movement.army.id],
      },
    ];
  }
  if (!proximity) {
    return [
      {
        category: 'army_movement',
        severity: 'warning',
        message: `“${movement.army.name}”从出发地到目的地没有可用的行军路线。`,
        suggestion: '在地图中补齐两地之间的道路或渡口，再检查这次调动。',
        sourceText: movement.army.name,
        startOffset: null,
        endOffset: null,
        entityIds: [movement.army.id],
      },
    ];
  }
  return [];
}

function checkProvisions(movement: HistoryArmyMovement | undefined): HistoryCheckIssue[] {
  if (!movement?.army) {
    return [];
  }
  if (movement.army.troops <= 0 || movement.army.provisionsShi < 0) {
    return [
      {
        category: 'provisions',
        severity: 'warning',
        message: `“${movement.army.name}”的兵力或粮草数量无效。`,
        suggestion: '填写大于零的兵力，以及不小于零的随军粮草。',
        sourceText: movement.army.name,
        startOffset: null,
        endOffset: null,
        entityIds: [movement.army.id],
      },
    ];
  }

  const requiredShi = Math.ceil(
    movement.army.troops * movement.plannedDays * DAILY_GRAIN_PER_SOLDIER_SHI,
  );
  if (movement.army.provisionsShi >= requiredShi) {
    return [];
  }
  return [
    {
      category: 'provisions',
      severity: 'warning',
      message: `“${movement.army.name}”按每日每兵二升计算，${movement.plannedDays} 天需要 ${requiredShi.toLocaleString('zh-CN')} 石粮草，当前只有 ${movement.army.provisionsShi.toLocaleString('zh-CN')} 石。`,
      suggestion: `补齐 ${(requiredShi - movement.army.provisionsShi).toLocaleString('zh-CN')} 石，或缩短行军、就地筹粮并写明来源。`,
      sourceText: movement.army.name,
      startOffset: null,
      endOffset: null,
      entityIds: [movement.army.id],
    },
  ];
}

function checkGeographicDistance(
  input: HistoryRuleInput,
  proximity: { travelMinutes: number; nodeIds: string[] } | null,
): HistoryCheckIssue[] {
  const movement = input.armyMovement;
  if (!movement || !movement.army || !proximity) {
    return [];
  }
  const requiredDays = Math.max(1, Math.ceil(proximity.travelMinutes / 1_440));
  if (movement.plannedDays >= requiredDays) {
    return [];
  }
  const from = input.nodes.find((node) => node.id === movement.fromNodeId)?.name ?? '出发地';
  const to = input.nodes.find((node) => node.id === movement.toNodeId)?.name ?? '目的地';
  return [
    {
      category: 'geographic_distance',
      severity: 'warning',
      message: `从${from}到${to}沿地图道路至少需要 ${requiredDays} 天，当前安排只有 ${movement.plannedDays} 天。`,
      suggestion: `把行程改为至少 ${requiredDays} 天，或补充更快的路线并说明代价。`,
      sourceText: `${from} → ${to}`,
      startOffset: null,
      endOffset: null,
      entityIds: proximity.nodeIds,
    },
  ];
}

function findShortestRoute(
  fromNodeId: string,
  toNodeId: string,
  connections: HistoryRuleInput['connections'],
): { travelMinutes: number; nodeIds: string[] } | null {
  const adjacency = new Map<string, Array<{ nodeId: string; minutes: number }>>();
  for (const connection of connections) {
    adjacency.set(connection.fromNodeId, [
      ...(adjacency.get(connection.fromNodeId) ?? []),
      { nodeId: connection.toNodeId, minutes: connection.travelMinutes },
    ]);
    adjacency.set(connection.toNodeId, [
      ...(adjacency.get(connection.toNodeId) ?? []),
      { nodeId: connection.fromNodeId, minutes: connection.travelMinutes },
    ]);
  }

  const distances = new Map<string, number>([[fromNodeId, 0]]);
  const previous = new Map<string, string>();
  const pending = new Set<string>([fromNodeId]);

  while (pending.size > 0) {
    let current: string | null = null;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const nodeId of pending) {
      const distance = distances.get(nodeId) ?? Number.POSITIVE_INFINITY;
      if (distance < currentDistance) {
        current = nodeId;
        currentDistance = distance;
      }
    }
    if (current === null) {
      break;
    }
    pending.delete(current);
    if (current === toNodeId) {
      break;
    }
    for (const edge of adjacency.get(current) ?? []) {
      const nextDistance = currentDistance + edge.minutes;
      if (nextDistance < (distances.get(edge.nodeId) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.nodeId, nextDistance);
        previous.set(edge.nodeId, current);
        pending.add(edge.nodeId);
      }
    }
  }

  const travelMinutes = distances.get(toNodeId);
  if (travelMinutes === undefined) {
    return null;
  }
  const nodeIds = [toNodeId];
  let cursor = toNodeId;
  while (cursor !== fromNodeId) {
    const parent = previous.get(cursor);
    if (!parent) {
      return { travelMinutes, nodeIds: [fromNodeId, toNodeId] };
    }
    nodeIds.unshift(parent);
    cursor = parent;
  }
  return { travelMinutes, nodeIds };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
