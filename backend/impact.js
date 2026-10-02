// impact.js (Phase 5) - "If I change this file, what can be affected?"
function riskLevel(n) {
  if (n === 0) return 'none';
  if (n <= 2) return 'low';
  if (n <= 7) return 'medium';
  return 'high';
}
const RULE = {
  none: '0 files affected',
  low: '1-2 files affected = low',
  medium: '3-7 files affected = medium',
  high: '8 or more files affected = high',
};

// names can be plain strings or objects, turn both into text
function label(x) {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') return x.name || x.imported || x.local || x.exported || 'default';
  return String(x);
}

function normalizeNodes(nodes) {
  if (Array.isArray(nodes)) {
    const m = {};
    for (const n of nodes) m[n.path || n.file || n.id] = n;
    return m;
  }
  return nodes || {};
}

// "importer|imported" -> { line, names }
function buildEdgeInfo(edges) {
  const info = {};
  for (const e of edges || []) {
    info[e.from + '|' + e.to] = {
      line: e.line || null,
      names: (e.names || []).map(label),
    };
  }
  return info;
}

// file path -> [{ name, line }]  (what the file offers to others)
function buildExports(facts) {
  const out = {};
  for (const f of (facts && facts.files) || []) {
    if (f.error) continue;
    out[f.path] = (f.exports || []).map((e) => ({
      name: label(e),
      line: (e && e.line) || null,
    }));
  }
  return out;
}

function impactOfOne(start, nodes, edgeInfo, exportsByFile) {
  const distance = { [start]: 0 };
  const parent = {};
  let queue = [start];

  while (queue.length) {
    const next = [];
    for (const cur of queue) {
      const usedBy = (nodes[cur] && nodes[cur].usedBy) || [];
      for (const user of usedBy) {
        if (distance[user] !== undefined) continue; // stops circular imports
        distance[user] = distance[cur] + 1;
        parent[user] = cur;
        next.push(user);
      }
    }
    queue = next;
  }

  const step = (importer, imported) => {
    const i = edgeInfo[importer + '|' + imported] || {};
    return { file: importer, imports: imported, line: i.line || null, names: i.names || [] };
  };

  const affected = Object.keys(distance).filter((f) => f !== start);

  const direct = affected.filter((f) => distance[f] === 1).map((f) => step(f, start));

  const indirect = affected
    .filter((f) => distance[f] > 1)
    .map((f) => {
      const steps = [];
      let cur = f;
      while (parent[cur] !== undefined) {
        steps.push(step(cur, parent[cur]));
        cur = parent[cur];
      }
      return { file: f, distance: distance[f], steps };
    })
    .sort((a, b) => a.distance - b.distance);

  const risk = riskLevel(affected.length);
  return {
    direct,
    indirect,
    total: affected.length,
    risk,
    rule: RULE[risk],
    exports: exportsByFile[start] || [],
  };
}

function buildImpact(a, b) {
  // accept (dependencies, facts) in either order
  const hasGraph = (x) => x && (x.edges || x.nodes);
  const dependencies = hasGraph(a) ? a : b || {};
  const facts = hasGraph(a) ? b : a;

  const edges = dependencies.edges || [];

  // rebuild nodes from edges so we never depend on dependencies.nodes
  const sets = {};
  const ensure = (p) => {
    if (!sets[p]) sets[p] = { uses: new Set(), usedBy: new Set() };
  };
  for (const f of (facts && facts.files) || []) if (!f.error) ensure(f.path);
  for (const p of Object.keys(dependencies.nodes || {})) ensure(p);
  for (const e of edges) {
    ensure(e.from);
    ensure(e.to);
    sets[e.from].uses.add(e.to);
    sets[e.to].usedBy.add(e.from);
  }
  const nodes = {};
  for (const p of Object.keys(sets)) {
    nodes[p] = { uses: [...sets[p].uses], usedBy: [...sets[p].usedBy] };
  }

  const edgeInfo = buildEdgeInfo(edges);
  const exportsByFile = buildExports(facts);

  const files = {};
  for (const f of Object.keys(nodes)) files[f] = impactOfOne(f, nodes, edgeInfo, exportsByFile);

  const ranking = Object.keys(files)
    .map((file) => ({ file, total: files[file].total, risk: files[file].risk }))
    .sort((x, y) => y.total - x.total);
  const count = (r) => ranking.filter((x) => x.risk === r).length;

  return {
    summary: {
      totalFiles: ranking.length,
      high: count('high'), medium: count('medium'), low: count('low'), none: count('none'),
    },
    files,
    ranking,
  };
}
module.exports = { buildImpact };