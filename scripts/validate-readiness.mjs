import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const errors = [];
const requireCheck = (condition, message) => { if (!condition) errors.push(message); };
const pipeCells = (line) => line.split('|').map((cell) => cell.trim());

const manifest = read('../docs/planning/v1-capability-manifest.md');
const traceability = read('../docs/planning/v1-capability-traceability.md');
const uiMatrix = read('../docs/ui/v1-ui-parity-matrix.md');
const graph = JSON.parse(read('../docs/planning/v1-issue-dependency-graph.json'));

const manifestIds = manifest.split('\n')
  .map((line) => line.match(/^\|\s*([A-Z]+-\d{3})\s*\|/))
  .filter(Boolean).map((match) => match[1]);
const traceRows = traceability.split('\n')
  .filter((line) => /^\|\s*[A-Z]+-\d{3}\s*\|/.test(line))
  .map(pipeCells);
const traceIds = traceRows.map((cells) => cells[1]);
const manifestSet = new Set(manifestIds);
const traceSet = new Set(traceIds);

requireCheck(manifestIds.length === manifestSet.size, 'Capability manifest contains duplicate IDs.');
requireCheck(traceIds.length === traceSet.size, 'Traceability ledger contains duplicate capability rows.');
requireCheck(manifestSet.size === traceSet.size && [...manifestSet].every((id) => traceSet.has(id)),
  'Manifest and traceability capability ID sets differ.');

for (const cells of traceRows) {
  const id = cells[1];
  const scope = cells[3];
  const status = cells[4];
  const primary = cells[5];
  if (scope === '后续' || status === 'deferred') {
    requireCheck(status === 'deferred' && primary === '—',
      `Deferred capability ${id} must have status deferred and no primary issue.`);
  } else {
    requireCheck(status !== 'deferred', `V1 capability ${id} cannot be deferred.`);
    requireCheck(/^#\d+$/.test(primary), `V1 capability ${id} has no single primary issue.`);
    if (/^#\d+$/.test(primary)) {
      const issueId = primary.slice(1);
      requireCheck(Boolean(graph.nodes[issueId]), `Primary issue ${primary} for ${id} is missing from dependency graph.`);
    }
  }
}

const uiLines = uiMatrix.split('\n');
const productionRows = [];
const prototypeOnlyRows = [];
for (const line of uiLines) {
  if (!/^\|\s*[a-z-]+\s*\|/.test(line)) continue;
  const cells = pipeCells(line);
  const page = cells[1];
  if (page === 'states') prototypeOnlyRows.push(cells);
  else if (['auth','dashboard','new-project','work-overview','bible','settings','outline','foreshadows','writing','batch','changes','export-publish','work-settings','entity-detail','account-settings','help','legal'].includes(page)) productionRows.push(cells);
}
requireCheck(productionRows.length === 17, `Expected 17 production UI rows, found ${productionRows.length}.`);
requireCheck(prototypeOnlyRows.length === 1, `Expected exactly one prototype-only states row, found ${prototypeOnlyRows.length}.`);
requireCheck(!/\bTBD\b|待定/i.test(uiMatrix), 'UI parity matrix still contains TBD/待定 placeholders.');
for (const cells of productionRows) {
  const page = cells[1];
  requireCheck(/^#\d+$/.test(cells[5]), `Production page ${page} has no primary page issue.`);
  if (/^#\d+$/.test(cells[5])) {
    const owner = nodes[cells[5].slice(1)];
    requireCheck(owner?.type === 'leaf', `Production page ${page} must be owned by a leaf issue, not a package.`);
  }
  requireCheck(cells[10].includes('apps/web/e2e/parity/'), `Production page ${page} has no production Playwright spec path.`);
  requireCheck(cells[11].includes('artifacts/ui/golden/'), `Production page ${page} has no production golden path.`);
  requireCheck(cells[12] === 'production-pending', `Production page ${page} cannot be marked verified before production evidence exists.`);
}
if (prototypeOnlyRows[0]) {
  requireCheck(prototypeOnlyRows[0][12] === 'prototype-only', 'states gallery must remain prototype-only.');
}

const nodes = graph.nodes || {};
const ids = Object.keys(nodes);
requireCheck(ids.length > 0, 'Dependency graph has no nodes.');
for (const [id, node] of Object.entries(nodes)) {
  requireCheck(!node.blocked_by.includes(Number(id)) && !node.blocked_by.includes(id),
    `Issue #${id} has a self-dependency.`);
  for (const blocker of node.blocked_by) {
    requireCheck(Boolean(nodes[String(blocker)]), `Issue #${id} references missing blocker #${blocker}.`);
  }
  for (const child of node.children) {
    requireCheck(Boolean(nodes[String(child)]), `Package #${id} references missing child #${child}.`);
    requireCheck(String(nodes[String(child)]?.parent) === id,
      `Package #${id} and child #${child} have inconsistent parent metadata.`);
  }
  if (node.parent !== null && node.parent !== undefined) {
    requireCheck(Boolean(nodes[String(node.parent)]), `Issue #${id} references missing parent #${node.parent}.`);
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
  for (const blocker of nodes[id]?.blocked_by || []) visit(String(blocker), [...path, id]);
  temporary.delete(id);
  permanent.add(id);
}
for (const id of ids) visit(id);

if (errors.length) {
  console.error('READINESS VALIDATION FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('READINESS VALIDATION PASSED');
  console.log(`Capabilities: ${manifestSet.size} (117 original + 2 cross-cutting)`);
  console.log(`Primary issue mappings: ${traceRows.length}`);
  console.log(`Production UI pages: ${productionRows.length}; prototype-only pages: ${prototypeOnlyRows.length}`);
  console.log(`Dependency graph: ${ids.length} nodes; ${ids.reduce((sum, id) => sum + nodes[id].blocked_by.length, 0)} blocker edges; acyclic.`);
}
