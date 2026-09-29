const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');
const { listAllFiles } = require('./parser');

const BUILTINS = new Set(builtinModules);
const CODE_EXTS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts'];
const ASSET_EXTS = new Set([
  '.css', '.scss', '.sass', '.less', '.json', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.md',
]);

// STEP 1: what kind of import is this?
function classifySource(source) {
  if (source.startsWith('.')) return 'local';                       // './TopBar', '../models/User'
  if (source.startsWith('node:')) return 'builtin';                 // 'node:path'
  if (BUILTINS.has(source) || BUILTINS.has(source.split('/')[0])) return 'builtin'; // 'fs', 'fs/promises'
  if (source.startsWith('/') || source.startsWith('@/') || source.startsWith('~/') || source.startsWith('#')) {
    return 'alias';                                                 // project shortcuts, we can't resolve yet
  }
  return 'package';                                                 // 'react', '@babel/parser'
}

// 'lodash/get' -> 'lodash', '@babel/parser/lib' -> '@babel/parser'
function packageName(source) {
  const parts = source.split('/');
  return source.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

// STEP 2: find the real file that a local import points to
function resolveLocal(fromFile, source, fileSet, lowerMap) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), source));
  const candidates = [base];
  for (const ext of CODE_EXTS) candidates.push(base + ext);            // './User'  -> User.js, User.jsx ...
  for (const ext of CODE_EXTS) candidates.push(base + '/index' + ext); // './models' -> models/index.js ...
  if (base.endsWith('.js')) candidates.push(base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx'); // TS style

  for (const c of candidates) {
    if (fileSet.has(c)) return { file: c, caseMismatch: false };
  }
  // exact match failed: try ignoring capital letters (catches './sidebar' vs Sidebar.jsx)
  for (const c of candidates) {
    const real = lowerMap.get(c.toLowerCase());
    if (real) return { file: real, caseMismatch: true };
  }
  return null; // file does not exist
}

// what package.json files say the project needs
function readDeclared(rootDir) {
  const declared = Object.create(null);
  for (const rel of listAllFiles(rootDir)) {
    if (path.posix.basename(rel) !== 'package.json') continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, rel), 'utf8'));
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const name of Object.keys(pkg[field] || {})) {
          declared[name] = { dev: field === 'devDependencies', from: rel };
        }
      }
    } catch (e) { /* unreadable package.json: ignore */ }
  }
  return declared;
}

// STEP 3: build the graph from the parser result
function buildDependencyGraph(analysis, rootDir) {
  const files = analysis.files.filter((f) => !f.error);
  const fileSet = new Set(files.map((f) => f.path));
  const lowerMap = new Map(files.map((f) => [f.path.toLowerCase(), f.path]));
  const declared = readDeclared(rootDir);

  const edges = [];
  const broken = [];
  const assets = [];
  const aliases = [];
  const externals = Object.create(null); // package name -> Set of files using it
  const builtins = Object.create(null);  // builtin name -> Set of files using it

  for (const f of files) {
    for (const imp of f.imports) {
      const kind = classifySource(imp.source);

      if (kind === 'package') {
        const name = packageName(imp.source);
        if (!externals[name]) externals[name] = new Set();
        externals[name].add(f.path);
      } else if (kind === 'builtin') {
        const name = imp.source.replace(/^node:/, '');
        if (!builtins[name]) builtins[name] = new Set();
        builtins[name].add(f.path);
      } else if (kind === 'alias') {
        aliases.push({ from: f.path, source: imp.source, line: imp.line });
      } else if (ASSET_EXTS.has(path.extname(imp.source).toLowerCase())) {
        assets.push({ from: f.path, source: imp.source }); // css/json/images, not code
      } else {
        const hit = resolveLocal(f.path, imp.source, fileSet, lowerMap);
        if (!hit) {
          broken.push({ from: f.path, source: imp.source, line: imp.line });
        } else {
          edges.push({
            from: f.path, to: hit.file, names: imp.names, kind: imp.kind,
            typeOnly: imp.typeOnly, line: imp.line, caseMismatch: hit.caseMismatch,
          });
        }
      }
    }
  }

  // per-file view: what it uses, and who uses it
  const nodes = {};
  for (const f of files) nodes[f.path] = { uses: new Set(), usedBy: new Set() };
  for (const e of edges) {
    nodes[e.from].uses.add(e.to);
    nodes[e.to].usedBy.add(e.from);
  }
  for (const p of Object.keys(nodes)) {
    nodes[p] = { uses: [...nodes[p].uses].sort(), usedBy: [...nodes[p].usedBy].sort() };
  }

  const packages = Object.keys(externals).sort().map((name) => ({
    name,
    usedIn: [...externals[name]].sort(),
    declared: name in declared,
  }));

  const unusedPackages = Object.keys(declared)
    .filter((n) => !externals[n] && !n.startsWith('@types/'))
    .map((n) => ({ name: n, dev: declared[n].dev, from: declared[n].from }));

  const mostImported = Object.entries(nodes)
    .map(([p, n]) => ({ path: p, count: n.usedBy.length }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    summary: {
      localFiles: files.length,
      localLinks: edges.length,
      packagesUsed: packages.length,
      builtinsUsed: Object.keys(builtins).length,
      brokenImports: broken.length,
      caseMismatches: edges.filter((e) => e.caseMismatch).length,
    },
    nodes, edges, packages, unusedPackages, mostImported,
    builtins: Object.keys(builtins).sort(),
    broken, assets, aliases,
  };
}

module.exports = { classifySource, packageName, resolveLocal, buildDependencyGraph };