export type ChangeTargetType =
  | 'entity'
  | 'outline'
  | 'chapter'
  | 'fact'
  | 'knowledge'
  | 'plot_line'
  | 'map'
  | 'faction'
  | 'power_item'
  | 'timeline'
  | 'story_bible'
  | 'work';

export type ChangeSource = 'author' | 'ai' | 'import' | 'batch';
export type ChangeRisk = 'low' | 'medium' | 'high';
export type ChangeClassification = 'safe' | 'repairable' | 'structural';
export type ChangeCheckStep =
  'structure' | 'hard_rules' | 'fact_diff' | 'knowledge_pov' | 'narrative' | 'downstream';
export type ChangeCheckStatus = 'passed' | 'warning' | 'conflict';

export type ChangeAffectedItem = {
  id: string;
  title: string;
  detail: string;
  status?: string;
  chapterNumber?: number | null;
};

export type ChangeAffected = {
  entities: ChangeAffectedItem[];
  facts: ChangeAffectedItem[];
  chapters: ChangeAffectedItem[];
  outlines: ChangeAffectedItem[];
  plotLines: ChangeAffectedItem[];
  knowledge: ChangeAffectedItem[];
  maps: ChangeAffectedItem[];
  factions: ChangeAffectedItem[];
  powerItems: ChangeAffectedItem[];
  timeline: ChangeAffectedItem[];
};

export type ChangeCheck = {
  step: ChangeCheckStep;
  label: string;
  status: ChangeCheckStatus;
  statusLabel: string;
  summary: string;
  suggestion: string;
  confidence: number;
};

export type ChangeImpactInput = {
  change: {
    title: string;
    reason: string;
    targetType: ChangeTargetType;
    targetId: string | null;
    targetLabel: string;
    targetStatus: string;
    targetLocked: boolean;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    source: ChangeSource;
    risk: ChangeRisk;
  };
  snapshot: {
    bible: {
      locked: boolean;
      worldIronLaws: string[];
    };
    entities: Array<{
      id: string;
      name: string;
      type: string;
      status: string;
      summary: string;
      aliases: string[];
    }>;
    facts: Array<{
      id: string;
      statement: string;
      type: string;
      chapterNumber: number | null;
    }>;
    chapters: Array<{
      id: string;
      title: string;
      chapterNumber: number;
      status: string;
      content: string;
    }>;
    outlines: Array<{
      id: string;
      title: string;
      chapterNumber: number | null;
      chapterGoal: string;
      sceneBeats: string[];
      chapterEndHook: string;
      locked: boolean;
    }>;
    plotLines: Array<{
      id: string;
      name: string;
      type: string;
      status: string;
      summary: string;
    }>;
    knowledge: Array<{
      id: string;
      characterId: string;
      characterName: string;
      title: string;
      objectiveTruth: string;
      characterBelief: string;
    }>;
    mapNodes: Array<{
      id: string;
      entityId: string;
      name: string;
      level: string;
    }>;
    relations: Array<{
      id: string;
      fromEntityId: string;
      fromName: string;
      predicate: string;
      toEntityId: string;
      toName: string;
    }>;
    powerItems: Array<{
      id: string;
      name: string;
      type: string;
      summary: string;
    }>;
    timeline: Array<{
      id: string;
      title: string;
      summary: string;
      dateLabel: string;
    }>;
  };
};

export type ChangeImpactResult = {
  affected: ChangeAffected;
  classification: ChangeClassification;
  confidence: number;
  summary: string;
  suggestions: string[];
  checks: ChangeCheck[];
};

const CHECK_LABELS: Record<ChangeCheckStep, string> = {
  structure: '结构检查',
  hard_rules: '硬规则检查',
  fact_diff: '事实差异',
  knowledge_pov: '知识与视角',
  narrative: '叙事检查',
  downstream: '后续影响',
};

const CHECK_STATUS_LABELS: Record<ChangeCheckStatus, string> = {
  passed: '通过',
  warning: '需要处理',
  conflict: '存在冲突',
};

function emptyAffected(): ChangeAffected {
  return {
    entities: [],
    facts: [],
    chapters: [],
    outlines: [],
    plotLines: [],
    knowledge: [],
    maps: [],
    factions: [],
    powerItems: [],
    timeline: [],
  };
}

function check(
  step: ChangeCheckStep,
  status: ChangeCheckStatus,
  summary: string,
  suggestion: string,
  confidence: number,
): ChangeCheck {
  return {
    step,
    label: CHECK_LABELS[step],
    status,
    statusLabel: CHECK_STATUS_LABELS[status],
    summary,
    suggestion,
    confidence,
  };
}

function matchesTerms(text: string, terms: string[]): boolean {
  const normalized = text.trim().toLocaleLowerCase('zh-CN');
  if (!normalized) {
    return false;
  }
  return terms.some((term) => normalized.includes(term.toLocaleLowerCase('zh-CN')));
}

function valuesText(values: Record<string, unknown>): string {
  return Object.values(values)
    .flatMap((value) => {
      if (Array.isArray(value)) {
        return value.map((item) => String(item));
      }
      if (value && typeof value === 'object') {
        return [JSON.stringify(value)];
      }
      return value === null || value === undefined ? [] : [String(value)];
    })
    .join(' ');
}

function referenceTerms(input: ChangeImpactInput): string[] {
  const changedText = `${valuesText(input.change.before)} ${valuesText(input.change.after)}`;
  return Array.from(
    new Set(
      [
        input.change.targetLabel.trim(),
        ...input.snapshot.entities
          .map((entity) => entity.name.trim())
          .filter((name) => name.length >= 2 && changedText.includes(name)),
      ].filter((term) => term.length >= 2),
    ),
  );
}

function affected(input: ChangeImpactInput): ChangeAffected {
  const terms = referenceTerms(input);
  const targetId = input.change.targetId;
  const result = emptyAffected();

  result.entities = input.snapshot.entities
    .filter(
      (entity) =>
        entity.id !== targetId &&
        matchesTerms([entity.name, entity.summary, entity.aliases.join(' ')].join(' '), terms),
    )
    .map((entity) => ({
      id: entity.id,
      title: entity.name,
      detail: entity.summary,
      status: entity.status,
    }));

  result.facts = input.snapshot.facts
    .filter((fact) => fact.id !== targetId && matchesTerms(fact.statement, terms))
    .map((fact) => ({
      id: fact.id,
      title: fact.statement,
      detail: '已确认设定可能与这次修改不一致。',
      chapterNumber: fact.chapterNumber,
    }));

  result.chapters = input.snapshot.chapters
    .filter(
      (chapter) =>
        chapter.id !== targetId && matchesTerms(`${chapter.title} ${chapter.content}`, terms),
    )
    .map((chapter) => ({
      id: chapter.id,
      title: `第 ${chapter.chapterNumber} 章 · ${chapter.title}`,
      detail: chapter.content.slice(0, 120),
      status: chapter.status,
      chapterNumber: chapter.chapterNumber,
    }));

  result.outlines = input.snapshot.outlines
    .filter(
      (outline) =>
        outline.id !== targetId &&
        matchesTerms(
          [
            outline.title,
            outline.chapterGoal,
            outline.sceneBeats.join(' '),
            outline.chapterEndHook,
          ].join(' '),
          terms,
        ),
    )
    .map((outline) => ({
      id: outline.id,
      title:
        outline.chapterNumber === null
          ? outline.title
          : `第 ${outline.chapterNumber} 章大纲 · ${outline.title}`,
      detail: outline.chapterGoal,
      status: outline.locked ? 'locked' : 'draft',
      chapterNumber: outline.chapterNumber,
    }));

  result.plotLines = input.snapshot.plotLines
    .filter((line) => line.id !== targetId && matchesTerms(`${line.name} ${line.summary}`, terms))
    .map((line) => ({
      id: line.id,
      title: line.name,
      detail: line.summary,
      status: line.status,
    }));

  result.knowledge = input.snapshot.knowledge
    .filter(
      (entry) =>
        entry.characterId !== targetId &&
        entry.id !== targetId &&
        matchesTerms(
          [entry.characterName, entry.title, entry.objectiveTruth, entry.characterBelief].join(' '),
          terms,
        ),
    )
    .map((entry) => ({
      id: entry.id,
      title: `${entry.characterName} · ${entry.title}`,
      detail: `角色认为“${entry.characterBelief}”，客观事实是“${entry.objectiveTruth}”。`,
    }));

  result.maps = input.snapshot.mapNodes
    .filter(
      (node) =>
        node.entityId !== targetId && node.id !== targetId && matchesTerms(node.name, terms),
    )
    .map((node) => ({
      id: node.id,
      title: node.name,
      detail: `地图层级：${node.level}`,
    }));

  result.factions = input.snapshot.entities
    .filter(
      (entity) =>
        entity.type === 'faction' &&
        entity.id !== targetId &&
        matchesTerms(`${entity.name} ${entity.summary}`, terms),
    )
    .map((entity) => ({
      id: entity.id,
      title: entity.name,
      detail: entity.summary,
      status: entity.status,
    }));

  const matchingRelations = input.snapshot.relations.filter(
    (relation) =>
      relation.fromEntityId === targetId ||
      relation.toEntityId === targetId ||
      matchesTerms(`${relation.fromName} ${relation.toName}`, terms),
  );
  for (const relation of matchingRelations) {
    const faction = input.snapshot.entities.find(
      (entity) => entity.id === relation.fromEntityId && entity.type === 'faction',
    );
    if (faction && !result.factions.some((item) => item.id === faction.id)) {
      result.factions.push({
        id: faction.id,
        title: faction.name,
        detail: `${faction.name}${relation.predicate === 'controls' ? '控制' : '关联'}${relation.toName}`,
        status: faction.status,
      });
      continue;
    }
    if (
      relation.predicate === 'controls' &&
      !result.factions.some((item) => item.id === relation.fromEntityId)
    ) {
      result.factions.push({
        id: relation.fromEntityId,
        title: relation.fromName,
        detail: `${relation.fromName}控制${relation.toName}`,
      });
    }
  }

  result.powerItems = input.snapshot.powerItems
    .filter((item) => item.id !== targetId && matchesTerms(`${item.name} ${item.summary}`, terms))
    .map((item) => ({
      id: item.id,
      title: item.name,
      detail: item.summary,
      status: item.type,
    }));

  result.timeline = input.snapshot.timeline
    .filter((node) => node.id !== targetId && matchesTerms(`${node.title} ${node.summary}`, terms))
    .map((node) => ({
      id: node.id,
      title: node.title,
      detail: `${node.dateLabel} ${node.summary}`.trim(),
    }));

  return result;
}

function hasStructuralDownstream(
  input: ChangeImpactInput,
  affectedResult: ChangeAffected,
): boolean {
  if (input.change.targetLocked) {
    return true;
  }
  if (
    (input.change.targetType === 'story_bible' || input.change.targetType === 'work') &&
    input.snapshot.bible.locked
  ) {
    return true;
  }
  return (
    affectedResult.chapters.some(
      (chapter) => chapter.status === 'locked' || chapter.status === 'published',
    ) || affectedResult.outlines.some((outline) => outline.status === 'locked')
  );
}

function hardRuleConflict(input: ChangeImpactInput): boolean {
  const proposed = valuesText(input.change.after);
  if (!proposed) {
    return false;
  }
  const removesRequiredCost =
    /(无需|不必|不用|没有|不受).{0,16}(代价|成本|付出|限制|约束)/.test(proposed) ||
    /(无视|绕开|跳过).{0,12}(规则|铁律|代价|限制)/.test(proposed);
  if (!removesRequiredCost) {
    return false;
  }
  return input.snapshot.bible.worldIronLaws.some((rule) =>
    /(必须|需要|代价|不能|不可|不得|限制)/.test(rule),
  );
}

function affectedCount(affectedResult: ChangeAffected): number {
  return Object.values(affectedResult).reduce((total, items) => total + items.length, 0);
}

export function analyzeChangeImpact(input: ChangeImpactInput): ChangeImpactResult {
  const affectedResult = affected(input);
  const count = affectedCount(affectedResult);
  const structural = hasStructuralDownstream(input, affectedResult);
  const violatesHardRules = hardRuleConflict(input);
  const targetMissing =
    !input.change.targetId &&
    input.change.targetType !== 'story_bible' &&
    input.change.targetType !== 'work';
  const classification: ChangeClassification =
    structural || violatesHardRules || targetMissing
      ? 'structural'
      : count > 0
        ? 'repairable'
        : 'safe';
  const checks = [
    targetMissing
      ? check(
          'structure',
          'conflict',
          '在当前创作线里找不到这次修改的对象。',
          '重新选择修改对象，或先确认它仍属于当前作品和创作线。',
          0.98,
        )
      : check(
          'structure',
          'passed',
          '修改对象和字段结构可以识别。',
          '可以继续审阅影响范围。',
          0.96,
        ),
    violatesHardRules
      ? check(
          'hard_rules',
          'conflict',
          '新内容取消了故事铁律要求的代价或限制。',
          '回到硬规则，补回必须付出的代价、限制或禁用条件，再重新检查。',
          0.91,
        )
      : check('hard_rules', 'passed', '没有发现与故事铁律冲突。', '保持现有规则约束。', 0.9),
    affectedResult.facts.length === 0
      ? check(
          'fact_diff',
          'passed',
          '没有已确认设定需要同步改写。',
          '应用后继续按现有设定写作。',
          0.9,
        )
      : check(
          'fact_diff',
          'warning',
          `有 ${affectedResult.facts.length} 条已确认设定需要同步核对。`,
          '把受影响的已确认设定改成与新内容一致，并保留修改理由。',
          0.86,
        ),
    affectedResult.knowledge.length === 0
      ? check(
          'knowledge_pov',
          'passed',
          '没有人物认知或视角需要同步调整。',
          '保持当前信息边界。',
          0.9,
        )
      : check(
          'knowledge_pov',
          'warning',
          `有 ${affectedResult.knowledge.length} 条人物认知可能需要调整。`,
          '确认谁知道什么，再同步人物认知和叙事视角，避免提前知道或错误遗忘。',
          0.82,
        ),
    affectedResult.plotLines.length === 0
      ? check('narrative', 'passed', '没有剧情线或伏笔受到影响。', '按现有叙事计划继续。', 0.9)
      : check(
          'narrative',
          'warning',
          `有 ${affectedResult.plotLines.length} 条剧情线可能与新内容不一致。`,
          '核对剧情线摘要、里程碑和伏笔回收计划，再调整相关承诺。',
          0.8,
        ),
    structural
      ? check(
          'downstream',
          'conflict',
          '后续内容里有已锁定或已发布的部分，不能直接覆盖。',
          '为这次修改另开平行版本，保留已经写定的内容。',
          0.94,
        )
      : affectedResult.chapters.length + affectedResult.outlines.length === 0
        ? check('downstream', 'passed', '没有已写章节或下游大纲需要处理。', '可以直接应用。', 0.92)
        : check(
            'downstream',
            'warning',
            `有 ${affectedResult.chapters.length + affectedResult.outlines.length} 处章节或大纲需要同步。`,
            '先修正受影响的章节和大纲，再应用这次修改。',
            0.84,
          ),
  ];

  const confidence =
    classification === 'structural'
      ? 0.94
      : classification === 'repairable'
        ? Math.max(0.72, 0.9 - count * 0.01)
        : 0.92;
  const summary =
    classification === 'structural'
      ? '这次修改会影响已经写定或锁定的内容，建议另开平行版本。'
      : classification === 'repairable'
        ? '影响范围明确，需要同步修正相关内容后再应用。'
        : '影响范围可控，可以直接应用这次修改。';
  const suggestions = checks
    .filter((item) => item.status !== 'passed')
    .map((item) => item.suggestion);

  return {
    affected: affectedResult,
    classification,
    confidence,
    summary,
    suggestions:
      suggestions.length > 0 ? suggestions : ['应用后保留版本记录，继续按现有内容写作。'],
    checks,
  };
}
