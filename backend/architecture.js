const path = require('path');
const { classifySource, packageName } = require('./dependencies');

const UI_PKGS = new Set(['react', 'react-dom', 'vue', 'svelte', 'preact', 'solid-js', 'next', '@angular/core']);
const SERVER_PKGS = new Set(['express', 'fastify', 'koa', 'hapi', '@hapi/hapi', 'hono']);
const DATA_PKGS = new Set([
  'mongoose', 'mongodb', 'prisma', '@prisma/client', 'sequelize', 'typeorm', 'pg', 'mysql', 'mysql2', 'knex', 'redis',
]);
const CONFIG_RE = /\.config\.(c|m)?[jt]s$|^\.?[a-z]+rc\.(c|m)?js$/i;

function packagesOf(file) {
  const out = new Set();
  for (const imp of file.imports) {
    if (classifySource(imp.source) === 'package') out.add(packageName(imp.source));
  }
  return out;
}

function usesBuiltins(file) {
  return file.imports.some((i) => classifySource(i.source) === 'builtin');
}

// STEP 1: give one file a role, a side, and the reason (evidence)
function classifyFile(f) {
  const base = path.posix.basename(f.path);
  if (CONFIG_RE.test(base)) return { role: 'config', side: 'config', reason: `config file (${base})` };

  const pk = packagesOf(f);
  const found = (set) => [...pk].filter((p) => set.has(p));
  const server = found(SERVER_PKGS);
  const data = found(DATA_PKGS);
  const ui = found(UI_PKGS);
  const why = [];
  let role = 'helper';
  let side = 'shared';

  if (f.routes.length || server.length) {
    role = 'server'; side = 'backend';
    if (f.routes.length) why.push(`defines ${f.routes.length} route(s)`);
    if (server.length) why.push(`imports ${server.join(', ')}`);
  } else if (f.models.length || f.dbCalls.length || data.length) {
    role = 'data'; side = 'backend';
    if (f.models.length) why.push(`defines ${f.models.length} model(s)`);
    if (f.dbCalls.length) why.push(`makes ${f.dbCalls.length} database call(s)`);
    if (data.length) why.push(`imports ${data.join(', ')}`);
  } else if (f.components.length || ui.length) {
    role = 'ui'; side = 'frontend';
    if (f.components.length) why.push(`has ${f.components.length} component(s)`);
    if (ui.length) why.push(`imports ${ui.join(', ')}`);
  } else {
    why.push('no UI, server or data signals');
    if (usesBuiltins(f)) { side = 'backend'; why.push('uses Node built-ins (fs, path...)'); }
    else if (/^(backend|server|api)\//i.test(f.path)) { side = 'backend'; why.push('lives in a backend folder'); }
    else if (/^(src|client|frontend|app)\//i.test(f.path)) { side = 'frontend'; why.push('lives in a frontend folder'); }
  }
  return { role, side, reason: why.join(', ') };
}

// STEP 2: layer = how many import steps from an entry file (0 = entry)
function assignLayers(info, deps) {
  for (const side of ['frontend', 'backend', 'shared']) {
    const starts = Object.keys(info).filter(
      (p) => info[p].isEntry && (side === 'shared' || info[p].side === side)
    );
    const seen = new Map(starts.map((p) => [p, 0]));
    const queue = [...starts];
    while (queue.length) {
      const p = queue.shift();
      for (const q of (deps.nodes[p] && deps.nodes[p].uses) || []) {
        if (!seen.has(q)) { seen.set(q, seen.get(p) + 1); queue.push(q); }
      }
    }
    for (const [p, d] of seen) {
      if (info[p] && info[p].side === side && info[p].layer === null) info[p].layer = d;
    }
  }
}

// STEP 3: match frontend API calls to backend routes
function urlPath(url) {
  const p = url.replace(/\$\{\}/g, 'x').replace(/^https?:\/\/[^/]+/i, '').split('?')[0];
  return p.startsWith('/') ? p : '/' + p;
}

function routeRegex(routePath) {
  const src = routePath
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp('^' + src + '/?$');
}

function findConnections(files) {
  const routes = [];
  for (const f of files) for (const r of f.routes) routes.push({ file: f.path, ...r });

  const connections = [];
  const unmatched = [];
  for (const f of files) {
    for (const a of f.apiCalls) {
      if (!a.url || a.url === '(dynamic)') {
        unmatched.push({ from: f.path, method: a.method, url: a.url || '(unknown)', line: a.line });
        continue;
      }
      const p = urlPath(a.url);
      const hit = routes.find(
        (r) => r.path && r.method !== 'USE' && (r.method === 'ALL' || r.method === a.method) && routeRegex(r.path).test(p)
      );
      if (hit) {
        connections.push({
          from: f.path, to: hit.file, method: a.method, path: hit.path,
          apiLine: a.line, routeLine: hit.line, handler: hit.handler,
        });
      } else {
        unmatched.push({ from: f.path, method: a.method, url: a.url, line: a.line });
      }
    }
  }
  return { connections, unmatched };
}

// STEP 4: put it all together
function buildArchitecture(analysis, deps) {
  const files = analysis.files.filter((f) => !f.error);
  const info = {};

  for (const f of files) info[f.path] = { ...classifyFile(f), isEntry: false, layer: null };

  // entry file = imports others but nobody imports it
  for (const f of files) {
    const n = deps.nodes[f.path];
    if (n && info[f.path].role !== 'config' && n.usedBy.length === 0 && n.uses.length > 0) {
      info[f.path].isEntry = true;
    }
  }

  assignLayers(info, deps);

  const SIDES = [
    ['frontend', 'Frontend'], ['backend', 'Backend'], ['shared', 'Shared / other'], ['config', 'Config files'],
  ];
  const sections = SIDES.map(([side, title]) => {
    const paths = Object.keys(info).filter((p) => info[p].side === side).sort();
    const byLayer = new Map();
    const loose = [];
    for (const p of paths) {
      if (info[p].layer === null) loose.push(p);
      else {
        if (!byLayer.has(info[p].layer)) byLayer.set(info[p].layer, []);
        byLayer.get(info[p].layer).push(p);
      }
    }
    const rows = [...byLayer].sort((a, b) => a[0] - b[0])
      .map(([layer, list]) => ({ label: layer === 0 ? 'Entry' : `Layer ${layer}`, files: list }));
    if (loose.length) rows.push({ label: side === 'config' ? 'Config' : 'Not reached from an entry file', files: loose });
    return { side, title, rows };
  }).filter((s) => s.rows.length);

  const { connections, unmatched } = findConnections(files);
  const count = (side) => Object.values(info).filter((i) => i.side === side).length;

  return {
    summary: {
      frontendFiles: count('frontend'),
      backendFiles: count('backend'),
      sharedFiles: count('shared'),
      configFiles: count('config'),
      entryFiles: Object.values(info).filter((i) => i.isEntry).length,
      frontendToBackendLinks: connections.length,
    },
    files: info,
    sections,
    connections,
    unmatchedApiCalls: unmatched,
  };
}

module.exports = { buildArchitecture, classifyFile };