export type ContextFactCandidate = {
  id: string;
  chapterNumber: number;
  type: string;
  typeLabel: string;
  statement: string;
  sourceSentence: string;
};

type ContextOutline = {
  chapterNumber: number;
  chapterGoal: string;
  pov: string;
  sceneBeats: string[];
  chapterEndHook: string;
};

type ContextWritingControls = {
  mustInclude: string[];
  mustAvoid: string[];
};

type ContextFactBudget = {
  maxFacts: number;
  maxCharacters: number;
  recentChapters: number;
};

const DEFAULT_BUDGET: ContextFactBudget = {
  maxFacts: 240,
  maxCharacters: 16_000,
  recentChapters: 12,
};

export function selectContextFacts(
  candidates: ContextFactCandidate[],
  outline: ContextOutline,
  controls: ContextWritingControls,
  budget: ContextFactBudget = DEFAULT_BUDGET,
): ContextFactCandidate[] {
  if (candidates.length === 0 || budget.maxFacts <= 0 || budget.maxCharacters <= 0) {
    return [];
  }

  const terms = searchTerms(
    [
      outline.chapterGoal,
      outline.pov,
      outline.sceneBeats.join(' '),
      outline.chapterEndHook,
      controls.mustInclude.join(' '),
      controls.mustAvoid.join(' '),
    ].join(' '),
  );
  const recentStart = outline.chapterNumber - Math.max(1, budget.recentChapters);
  const recent = candidates
    .filter(
      (fact) =>
        fact.chapterNumber > recentStart && fact.chapterNumber <= outline.chapterNumber,
    )
    .sort((left, right) => left.chapterNumber - right.chapterNumber);
  const scored = candidates
    .filter((fact) => fact.chapterNumber <= outline.chapterNumber)
    .map((fact) => ({
      fact,
      score: relevanceScore(fact, terms),
    }))
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.fact.chapterNumber - left.fact.chapterNumber,
    );
  const fallback = [...candidates]
    .filter((fact) => fact.chapterNumber <= outline.chapterNumber)
    .sort((left, right) => right.chapterNumber - left.chapterNumber);

  const selected: ContextFactCandidate[] = [];
  const selectedIds = new Set<string>();
  let characters = 0;

  const include = (fact: ContextFactCandidate): void => {
    if (selected.length >= budget.maxFacts || selectedIds.has(fact.id)) {
      return;
    }
    const nextCharacters = fact.statement.length + fact.sourceSentence.length;
    if (characters + nextCharacters > budget.maxCharacters) {
      return;
    }
    selected.push(fact);
    selectedIds.add(fact.id);
    characters += nextCharacters;
  };

  recent.forEach(include);
  scored.forEach(({ fact }) => include(fact));
  fallback.forEach(include);

  return selected.sort(
    (left, right) =>
      left.chapterNumber - right.chapterNumber || left.statement.localeCompare(right.statement),
  );
}

function relevanceScore(fact: ContextFactCandidate, terms: string[]): number {
  const text = `${fact.statement} ${fact.sourceSentence}`.toLocaleLowerCase('zh-CN');
  return terms.reduce((score, term) => score + (text.includes(term) ? term.length : 0), 0);
}

function searchTerms(value: string): string[] {
  const normalized = value.toLocaleLowerCase('zh-CN');
  const terms = new Set<string>();
  for (const segment of normalized.match(/[\p{Script=Han}]+|[a-z0-9]+/gu) ?? []) {
    if (segment.length <= 2) {
      terms.add(segment);
      continue;
    }
    for (let index = 0; index < segment.length - 1; index += 1) {
      terms.add(segment.slice(index, index + 2));
    }
  }
  return [...terms].filter((term) => term.length > 0);
}
