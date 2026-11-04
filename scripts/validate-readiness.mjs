import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const errors = [];
const requireCheck = (condition, message) => {
  if (!condition) errors.push(message);
};
const pipeCells = (line) => line.split('|').map((cell) => cell.trim());

const manifest = read('../docs/planning/v1-capability-manifest.md');
const traceability = read('../docs/planning/v1-capability-traceability.md');
const uiMatrix = read('../docs/ui/v1-ui-parity-matrix.md');
const graph = JSON.parse(read('../docs/planning/v1-issue-dependency-graph.json'));
const nodes = graph.nodes || {};
const nodeIds = Object.keys(nodes);

requireCheck(graph.schema_version === 1, 'Unsupported or missing dependency graph schema_version.');
requireCheck(nodeIds.length > 0, 'Dependency graph has no nodes.');

const manifestIds = manifest.split('\n')
  .map((line) => line.match(/^\|\s*([A-Z]+-\d{3})\s*\|/))
  .filter(Boolean)
  .map((match) => match[1]);
const traceRows = traceability.split('\n')
  .filter((line) => /^\|\s*[A-Z]+-\d{3}\s*\|/.test(line))
  .map(pipeCells);
const traceIds = traceRows.map((cells) => cells[1]);
const manifestSet = new Set(manifestIds);
const traceSet = new Set(traceIds);

requireCheck(manifestIds.length === manifestSet.size, 'Capability manifest contains duplicate IDs.');
requireCheck(traceIds.length === traceSet.size, 'Traceability ledger contains duplicate capability rows.');
requireCheck(manifestSet.size === traceSet.size &&
  [...manifestSet].every((id) => traceSet.has(id)),
'Manifest and traceability capability ID sets differ.');

for (const cells of traceRows) {
  const id = cells[1];
  const scope = cells[3];
  const status = cells[4];
  const primary = cells[5];

  if (scope === '后续' || status === 'deferred') {
    requireCheck(status === 'deferred' && primary === '—',
      `Deferred capability ${id} must have status deferred and no primary issue.`);
    continue;
  }

  requireCheck(status !== 'deferred', `V1 capability ${id} cannot be deferred.`);
  requireCheck(/^#\d+$/.test(primary), `V1 capability ${id} has no single primary issue.`);
  if (/^#\d+$/.test(primary)) {
    const issueId = primary.slice(1);
    requireCheck(Boolean(nodes[issueId]),
      `Primary issue ${primary} for ${id} is missing from dependency graph.`);
  }
}

const productionPageIds = [
  'auth', 'dashboard', 'new-project', 'work-overview', 'bible', 'settings',
  'outline', 'foreshadows', 'writing', 'batch', 'changes', 'export-publish',
  'work-settings', 'entity-detail', 'account-settings', 'help', 'legal',
];
const productionPageSet = new Set(productionPageIds);
const productionRows = [];
const prototypeOnlyRows = [];

for (const line of uiMatrix.split('\n')) {
  if (!/^\|\s*[a-z-]+\s*\|/.test(line)) continue;
  const cells = pipeCells(line);
  const page = cells[1];
  if (page === 'states') prototypeOnlyRows.push(cells);
  else if (productionPageSet.has(page)) productionRows.push(cells);
}

requireCheck(productionRows.length === productionPageIds.length,
  `Expected ${productionPageIds.length} production UI rows, found ${productionRows.length}.`);
requireCheck(new Set(productionRows.map((cells) => cells[1])).size === productionPageIds.length,
  'Production UI matrix contains duplicate or missing page IDs.');
requireCheck(prototypeOnlyRows.length === 1,
  `Expected exactly one prototype-only states row, found ${prototypeOnlyRows.length}.`);
requireCheck(!/\bTBD\b|待定/i.test(uiMatrix),
  'UI parity matrix still contains TBD/待定 placeholders.');

for (const cells of productionRows) {
  const page = cells[1];
  const primaryIssue = cells[5];
  requireCheck(/^#\d+$/.test(primaryIssue),
    `Production page ${page} has no primary page issue.`);

  if (/^#\d+$/.test(primaryIssue)) {
    const owner = nodes[primaryIssue.slice(1)];
    requireCheck(owner?.type === 'leaf',
      `Production page ${page} must be owned by a leaf issue, not a package.`);
  }

  requireCheck(cells[10]?.includes('apps/web/e2e/parity/'),
    `Production page ${page} has no production Playwright spec path.`);
  requireCheck(cells[11]?.includes('artifacts/ui/golden/'),
    `Production page ${page} has no production golden path.`);
  requireCheck(cells[12] === 'production-pending',
    `Production page ${page} cannot be marked verified before production evidence exists.`);
}

if (prototypeOnlyRows[0]) {
  requireCheck(prototypeOnlyRows[0][12] === 'prototype-only',
    'states gallery must remain prototype-only.');
}

for (const [id, node] of Object.entries(nodes)) {
  requireCheck(['leaf', 'package', 'integration'].includes(node.type),
    `Issue #${id} has an unknown dependency node type.`);
  requireCheck(Array.isArray(node.blocked_by),
    `Issue #${id} must declare blocked_by as an array.`);
  requireCheck(Array.isArray(node.children),
    `Issue #${id} must declare children as an array.`);

  const blockers = Array.isArray(node.blocked_by) ? node.blocked_by : [];
  const children = Array.isArray(node.children) ? node.children : [];

  requireCheck(!blockers.some((blocker) => String(blocker) === id),
    `Issue #${id} has a self-dependency.`);
  requireCheck(new Set(blockers.map(String)).size === blockers.length,
    `Issue #${id} has duplicate blocker edges.`);

  for (const blocker of blockers) {
    requireCheck(Boolean(nodes[String(blocker)]),
      `Issue #${id} references missing blocker #${blocker}.`);
  }

  for (const child of children) {
    requireCheck(Boolean(nodes[String(child)]),
      `Package #${id} references missing child #${child}.`);
    requireCheck(String(nodes[String(child)]?.parent) === id,
      `Package #${id} and child #${child} have inconsistent parent metadata.`);
  }

  if (node.parent !== null && node.parent !== undefined) {
    requireCheck(Boolean(nodes[String(node.parent)]),
      `Issue #${id} references missing parent #${node.parent}.`);
    requireCheck(nodes[String(node.parent)]?.children?.map(String).includes(id),
      `Issue #${id} parent #${node.parent} does not list it as a child.`);
  }
}

const temporary = new Set();
const permanent = new Set();
function visit(id, path = []) {
  if (permanent.has(id)) return;
  if (temporary.has(id)) {
    errors.push(`Dependency cycle detected: ${[...path, id].join(' -> ')}`);
    return;
  }

  temporary.add(id);
  const blockers = Array.isArray(nodes[id]?.blocked_by) ? nodes[id].blocked_by : [];
  for (const blocker of blockers) visit(String(blocker), [...path, id]);
  temporary.delete(id);
  permanent.add(id);
}

for (const id of nodeIds) visit(id);

if (errors.length) {
  console.error('READINESS VALIDATION FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const blockerEdges = nodeIds.reduce((sum, id) =>
    sum + (Array.isArray(nodes[id].blocked_by) ? nodes[id].blocked_by.length : 0), 0);
  console.log('READINESS VALIDATION PASSED');
  console.log(`Capabilities: ${manifestSet.size}`);
  console.log(`Primary issue mappings: ${traceRows.length}`);
  console.log(`Production UI pages: ${productionRows.length}; prototype-only pages: ${prototypeOnlyRows.length}`);
  console.log(`Dependency graph: ${nodeIds.length} nodes; ${blockerEdges} blocker edges; acyclic.`);
}
