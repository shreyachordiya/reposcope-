const path = require('path');
const { classifySource, packageName } = require('./dependencies');

// ---------- package lists (used to recognise what a file is) ----------
const UI_PKGS = new Set(['react', 'react-dom', 'vue', 'svelte', 'preact', 'solid-js', 'next', '@angular/core']);
const SERVER_PKGS = new Set([
  'express', 'fastify', 'koa', 'hapi', '@hapi/hapi', 'hono', '@nestjs/core', '@nestjs/common', 'restify',
  '@apollo/server', 'apollo-server', 'apollo-server-express', 'graphql-yoga', 'socket.io',
]);
const DATA_PKGS = new Set([
  'mongoose', 'mongodb', 'prisma', '@prisma/client', 'sequelize', 'typeorm', 'pg', 'mysql', 'mysql2', 'knex', 'redis',
  'ioredis', 'drizzle-orm', 'firebase-admin', 'better-sqlite3', 'sqlite3', '@neondatabase/serverless',
]);
// NEW: packages that only live on the server, but do not make a file a "server" file by themselves
const BACKEND_HINT_PKGS = new Set([
  'jsonwebtoken', 'bcrypt', 'bcryptjs', 'argon2', 'passport', 'cors', 'helmet', 'morgan', 'multer', 'cookie-parser',
  'express-session', 'cookie-session', 'dotenv', 'nodemailer', 'express-rate-limit', 'express-validator', 'compression',
]);
// NEW: UI component / styling / animation libraries (MUI, Chakra, Radix, shadcn helpers, icons ...)
const UI_LIB_PREFIXES = [
  '@mui/', '@chakra-ui/', '@radix-ui/', '@headlessui/', '@mantine/', '@emotion/', '@ant-design/',
  '@nextui-org/', '@heroui/', '@fortawesome/', '@tabler/', '@primer/', '@react-three/',
];
const UI_LIB_PKGS = new Set([
  'antd', 'styled-components', 'framer-motion', 'motion', 'lucide-react', 'react-icons', 'react-bootstrap', 'bootstrap',
  'tailwindcss', 'daisyui', 'sonner', 'react-hot-toast', 'react-toastify', 'recharts', 'chart.js', 'react-chartjs-2',
  'three', 'gsap', 'swiper', 'class-variance-authority', 'tailwind-merge', 'clsx', 'cmdk', 'vaul', 'embla-carousel-react',
]);
// NEW: frontend support packages (routing, state, forms, data fetching on the client)
const FRONT_SUPPORT = new Set([
  'react-router', 'react-router-dom', '@tanstack/react-router', 'vue-router', 'redux', 'react-redux', '@reduxjs/toolkit',
  'zustand', 'jotai', 'recoil', 'mobx', 'pinia', 'swr', '@tanstack/react-query', 'react-hook-form', 'formik',
]);
const isUiLib = (p) => UI_LIB_PKGS.has(p) || UI_LIB_PREFIXES.some((x) => p.startsWith(x));

// NEW: used only for the "stack" summary (what the project is built with)
const STACK = {
  frontend: ['react', 'react-dom', 'vue', 'svelte', 'preact', 'solid-js', 'next', '@angular/core', 'vite', 'nuxt', 'astro', '@remix-run/react'],
  routing: ['react-router', 'react-router-dom', '@tanstack/react-router', 'vue-router'],
  state: ['redux', 'react-redux', '@reduxjs/toolkit', 'zustand', 'jotai', 'recoil', 'mobx', 'pinia'],
  dataFetching: ['axios', 'swr', '@tanstack/react-query', 'ky', '@apollo/client'],
  backend: [...SERVER_PKGS, 'cors', 'helmet', 'morgan', 'multer', 'cookie-parser', 'dotenv', 'nodemailer'],
  database: [...DATA_PKGS, '@supabase/supabase-js', 'firebase'],
  auth: ['passport', 'jsonwebtoken', 'bcrypt', 'bcryptjs', 'argon2', 'next-auth', 'express-session', 'cookie-session', '@clerk/clerk-react', '@auth0/auth0-react'],
  validation: ['zod', 'joi', 'yup', 'express-validator', 'ajv', 'class-validator', 'react-hook-form', 'formik'],
  testing: ['jest', 'vitest', 'mocha', 'supertest', 'cypress', 'playwright', '@playwright/test', '@testing-library/react'],
};
const STACK_LOOKUP = new Map();
for (const [cat, list] of Object.entries(STACK)) for (const p of list) if (!STACK_LOOKUP.has(p)) STACK_LOOKUP.set(p, cat);

const CONFIG_RE = /\.config\.(c|m)?[jt]s$|^\.?[a-z]+rc\.(c|m)?js$/i;
// NEW: tests, stories and type-definition files are not part of the app structure
const TEST_RE = /(^|\/)(__tests__|__mocks__|tests?|spec|specs|e2e|cypress)\/|\.(test|spec|stories)\.[cm]?[jt]sx?$|\.d\.ts$/i;
// NEW: copy-pasted UI kits (shadcn/ui, Magic UI, React Bits, Aceternity ...) live in these folders
const KIT_RE = /^(.*?(?:^|\/)components\/(ui|magicui|react-bits|reactbits|aceternity|animate-ui))\//i;
const NEXT_API_RE = /(^|\/)pages\/api\/|(^|\/)app\/.+\/route\.[jt]sx?$/;
const BACKEND_DIR = /(^|\/)(backend|server|controllers|models|middlewares?|routes|dao)(\/|$)|^api\//i;
const FRONTEND_DIR = /(^|\/)(client|frontend|components|pages|views|hooks|contexts?|store|layouts?|screens)(\/|$)|^(src|app)\//i;

// CHANGED #2: folder / file names that tell us what a backend file does
const MIDDLEWARE_DIR = /(^|\/)middlewares?(\/|$)/i;
const CONTROLLERS_DIR = /(^|\/)controllers?(\/|$)/i;
const MODELS_DIR = /(^|\/)models?(\/|$)/i;

// CHANGED #1: a file is only an ENTRY when it also has real entry evidence
const ENTRY_NAME = /^(index|main|server|app|www)\.[cm]?[jt]sx?$/i;
const NEXT_ENTRY_RE = /(^|\/)pages\/.+\.[jt]sx?$|(^|\/)app\/(.+\/)?(page|layout|route)\.[jt]sx?$/;

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

function kitInfo(p) {
  const m = KIT_RE.exec(p);
  return m ? { dir: m[1], name: m[2].toLowerCase() } : null;
}

// STEP 1: give one file a role, a side, and the reason (evidence)
// ctx = repo-wide knowledge: { hasUi, kitCounts }. Without it the old behaviour is kept.
function classifyFile(f, ctx = { hasUi: true, kitCounts: {} }) {
  const base = path.posix.basename(f.path);
  const R = (k) => f[k] || []; // new parser facts may be missing in old results

  if (CONFIG_RE.test(base)) return { role: 'config', side: 'config', reason: `config file (${base})` };

  // tests / stories / .d.ts: hidden from the diagram (counted in the summary)
  if (TEST_RE.test(f.path)) {
    return { role: 'config', side: 'hidden', kind: 'test', reason: 'test, story or type-definition file (not part of the app structure)' };
  }

  // copied UI kit components: hidden, otherwise every page draws 15 arrows to Button / Card
  const kit = kitInfo(f.path);
  if (kit && (kit.name !== 'ui' || (ctx.kitCounts[kit.dir] || 0) >= 5)) {
    return { role: 'config', side: 'hidden', kind: 'ui-kit', reason: `UI kit component (${kit.dir}: shadcn / React Bits style, copied into the repo)` };
  }

  // Next.js API routes are backend code even though the project is "a React app"
  if (NEXT_API_RE.test(f.path)) {
    return { role: 'server', side: 'backend', reason: 'Next.js API route (pages/api or app/**/route)' };
  }

  const pk = packagesOf(f);
  const found = (set) => [...pk].filter((p) => set.has(p));
  const server = found(SERVER_PKGS);
  const data = found(DATA_PKGS);
  const ui = found(UI_PKGS);
  const frontSignals = [...pk].filter((p) => isUiLib(p) || FRONT_SUPPORT.has(p));
  const backHints = found(BACKEND_HINT_PKGS);
  const why = [];
  let role = 'helper';
  let side = 'shared';

  if (R('routes').length || R('middleware').length || server.length) {
    role = 'server'; side = 'backend';
    if (R('routes').length) why.push(`defines ${R('routes').length} route(s)`);
    if (R('middleware').length) why.push(`registers ${R('middleware').length} middleware`);
    if (server.length) why.push(`imports ${server.join(', ')}`);
  } else if (R('models').length || R('dbCalls').length || R('dbConnections').length || data.length) {
    role = 'data'; side = 'backend';
    if (R('models').length) why.push(`defines ${R('models').length} model(s)`);
    if (R('dbCalls').length) why.push(`makes ${R('dbCalls').length} database call(s)`);
    if (R('dbConnections').length) why.push('connects to the database');
    if (data.length) why.push(`imports ${data.join(', ')}`);
  } else if (R('components').length || R('clientRoutes').length || ui.length) {
    role = 'ui'; side = 'frontend';
    if (R('components').length) why.push(`has ${R('components').length} component(s)`);
    if (R('clientRoutes').length) why.push(`defines ${R('clientRoutes').length} page route(s)`);
    if (ui.length) why.push(`imports ${ui.join(', ')}`);
  } else if (R('hooks').length || frontSignals.length) {
    role = 'helper'; side = 'frontend'; // custom hooks, state stores, small UI helpers
    if (R('hooks').length) why.push('uses React effects');
    if (frontSignals.length) why.push(`imports ${frontSignals.slice(0, 3).join(', ')}`);
  } else if (backHints.length) {
    role = 'helper'; side = 'backend';
    why.push(`server-only helper (imports ${backHints.slice(0, 3).join(', ')})`);
  } else if (ctx.hasUi && R('apiCalls').length && !usesBuiltins(f) && !BACKEND_DIR.test(f.path)) {
    role = 'helper'; side = 'frontend';
    why.push(`calls the backend API (${R('apiCalls').length} call(s))`);
  } else {
    why.push('no UI, server or data signals');
    if (usesBuiltins(f)) { side = 'backend'; why.push('uses Node built-ins (fs, path...)'); }
    else if (BACKEND_DIR.test(f.path)) { side = 'backend'; why.push('lives in a backend folder'); }
    // CHANGED: only guess "frontend" from a folder name when the repo really has a UI.
    // (NodeGoat keeps server code in app/, which used to be called frontend.)
    else if (ctx.hasUi && FRONTEND_DIR.test(f.path)) { side = 'frontend'; why.push('lives in a frontend folder'); }
  }

  // CHANGED #2: split the backend "server" / "data" / "helper" roles into middleware, controller and model.
  // Route files and app.js / server.js are left alone (they have real routes or are not in these folders).
  if (side === 'backend' && (role === 'server' || role === 'data' || role === 'helper')) {
    const realRoutes = R('routes').filter((r) => r.method !== 'USE').length;
    const verifies = R('auth').some((a) => a.kind === 'jwt.verify' || a.kind === 'passport.authenticate');
    if (!realRoutes && (MIDDLEWARE_DIR.test(f.path) || /middleware/i.test(base))) {
      role = 'middleware'; why.push('lives in a middleware folder / has middleware in its name');
    } else if (!realRoutes && (CONTROLLERS_DIR.test(f.path) || /controller/i.test(base))) {
      role = 'controller'; why.push('lives in a controllers folder / has controller in its name');
    } else if (R('models').length || (MODELS_DIR.test(f.path) && !realRoutes)) {
      role = 'model'; why.push(R('models').length ? 'defines a database model' : 'lives in a models folder');
    } else if (!realRoutes && verifies && role !== 'server') {
      role = 'middleware'; why.push('checks a token or login (jwt.verify / passport.authenticate)');
    }
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

// ---------- STEP 3: match frontend API calls to backend routes ----------

const EXTS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

// "/api" + "/users/" -> "/api/users"
function joinPath(...parts) {
  const p = ('/' + parts.filter(Boolean).join('/')).replace(/\/+/g, '/');
  return p.length > 1 ? p.replace(/\/$/, '') : p;
}

// "./routes/user" imported from "server.js" -> "routes/user.js" (if that file exists in the repo)
function resolveLocal(fromPath, source, fileSet) {
  if (!source.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), source));
  if (fileSet.has(base)) return base;
  for (const e of EXTS) if (fileSet.has(base + e)) return base + e;
  for (const e of EXTS) if (fileSet.has(base + '/index' + e)) return base + '/index' + e;
  return null;
}

// app.use('/api/users', userRoutes)  =>  mounts['routes/user.js'] = [{ from: 'server.js', prefix: '/api/users' }]
function buildMounts(files, fileSet) {
  const mounts = {};
  for (const f of files) {
    for (const mw of f.middleware || []) {
      if (!mw.path) continue;
      const name = String(mw.name).replace(/\(\)$/, '');
      const imp = f.imports.find((i) => (i.names || []).includes(name));
      const target = imp && resolveLocal(f.path, imp.source, fileSet);
      if (target && target !== f.path) (mounts[target] = mounts[target] || []).push({ from: f.path, prefix: mw.path });
    }
  }
  return mounts;
}

// all full prefixes of a router file (it may be mounted inside another router that is mounted too)
function prefixesOf(file, mounts, depth = 0, trail = new Set()) {
  const ms = mounts[file];
  if (!ms || depth > 4 || trail.has(file)) return [''];
  const t = new Set([...trail, file]);
  const out = [];
  for (const m of ms) for (const p of prefixesOf(m.from, mounts, depth + 1, t)) out.push(joinPath(p, m.prefix));
  return out.length ? [...new Set(out)].slice(0, 10) : [''];
}

// "https://api.x.com/users?id=1" -> external. "${}/users" -> "/users". "/u/${}" -> "/u/x"
function cleanUrl(url) {
  let u = String(url).replace(/^\$\{\}/, ''); // leading variable = base url
  const abs = /^https?:\/\/([^/]+)/i.exec(u);
  if (abs && !/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(abs[1])) return { external: true };
  u = u.replace(/\$\{\}/g, 'x').replace(/^https?:\/\/[^/]+/i, '').split('?')[0].split('#')[0];
  return { path: joinPath(u) };
}

function routeRegex(routePath) {
  const src = routePath
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp('^' + src + '/?$');
}

function findConnections(files, fileSet) {
  const mounts = buildMounts(files, fileSet);

  // every route with every full path it can have (mount prefix + its own path)
  const routes = [];
  for (const f of files) {
    const prefixes = prefixesOf(f.path, mounts);
    for (const r of f.routes) {
      if (!r.path || r.method === 'USE') continue;
      const fulls = [...new Set([...prefixes.map((p) => joinPath(p, r.path)), joinPath(r.path)])];
      routes.push({ file: f.path, ...r, regexes: fulls.map((full) => ({ full, re: routeRegex(full) })) });
    }
  }

  const connections = [];
  const unmatched = [];
  for (const f of files) {
    for (const a of f.apiCalls) {
      if (!a.url || a.url === '(dynamic)') {
        unmatched.push({ from: f.path, method: a.method, url: a.url || '(unknown)', line: a.line });
        continue;
      }
      // axios.create({ baseURL }) + api.get('/users')
      let target = a.url;
      if (a.baseURL && !String(a.baseURL).startsWith('env:')) target = String(a.baseURL).replace(/\/$/, '') + '/' + String(a.url).replace(/^\//, '');
      const u = cleanUrl(target);
      if (u.external) {
        unmatched.push({ from: f.path, method: a.method, url: a.url, line: a.line, external: true });
        continue;
      }

      const ok = (r) => r.method === 'ALL' || r.method === a.method;
      let guess = false;
      let hit = null;
      let full = null;
      const tryMatch = (p) => {
        for (const r of routes) {
          if (!ok(r)) continue;
          const x = r.regexes.find((q) => q.re.test(p));
          if (x) { hit = r; full = x.full; return true; }
        }
        return false;
      };
      if (!tryMatch(u.path)) {
        // mount prefix unknown (e.g. app.use('/api', require('./x'))): try without the first 1-2 segments
        const segs = u.path.split('/').filter(Boolean);
        for (const strip of [1, 2]) {
          if (segs.length > strip && tryMatch('/' + segs.slice(strip).join('/'))) { guess = true; break; }
        }
      }

      if (hit) {
        connections.push({
          from: f.path, to: hit.file, method: a.method, path: full,
          apiLine: a.line, routeLine: hit.line, handler: hit.handler,
          middleware: hit.middleware || [], guess,
        });
      } else {
        unmatched.push({ from: f.path, method: a.method, url: a.url, line: a.line });
      }
    }
  }
  return { connections, unmatched, mountCount: Object.keys(mounts).length };
}

// ---------- NEW: what is the project built with? ----------
function detectStack(files) {
  const seen = {}; // category -> name -> Set(files)
  const add = (cat, name, file) => {
    seen[cat] = seen[cat] || {};
    (seen[cat][name] = seen[cat][name] || new Set()).add(file);
  };
  for (const f of files) {
    for (const imp of f.imports) {
      if (classifySource(imp.source) !== 'package') continue;
      const pkg = packageName(imp.source);
      const prefix = UI_LIB_PREFIXES.find((x) => pkg.startsWith(x));
      if (prefix) add('uiLibraries', prefix + '*', f.path);
      else if (UI_LIB_PKGS.has(pkg)) add('uiLibraries', pkg, f.path);
      else if (STACK_LOOKUP.has(pkg)) add(STACK_LOOKUP.get(pkg), pkg, f.path);
    }
  }
  const out = {};
  for (const [cat, names] of Object.entries(seen)) {
    out[cat] = Object.entries(names)
      .map(([name, set]) => ({ name, files: set.size }))
      .sort((a, b) => b.files - a.files);
  }
  return out;
}

// STEP 4: put it all together
function buildArchitecture(analysis, deps) {
  const files = analysis.files.filter((f) => !f.error);
  const fileSet = new Set(files.map((f) => f.path));
  const info = {};

  // repo-wide knowledge used by classifyFile
  const hasUi = files.some((f) => (f.components || []).length || [...packagesOf(f)].some((p) => UI_PKGS.has(p)));
  const kitCounts = {};
  for (const f of files) {
    const k = kitInfo(f.path);
    if (k) kitCounts[k.dir] = (kitCounts[k.dir] || 0) + 1;
  }
  const ctx = { hasUi, kitCounts };

  for (const f of files) info[f.path] = { ...classifyFile(f, ctx), isEntry: false, layer: null };

  // CHANGED #1: entry file = imports others, nobody imports it, AND it looks like a real start point
  // (mounts React with react-dom, is named index / main / server / app / www, or is a Next.js page).
  // Pages that nothing imports (because a link is missing) are no longer wrongly marked ENTRY.
  const usesNext = files.some((f) => f.imports.some((x) => x.source === 'next' || x.source.startsWith('next/')));
  for (const f of files) {
    const n = deps.nodes[f.path];
    if (!n || info[f.path].role === 'config' || n.usedBy.length !== 0 || n.uses.length === 0) continue;
    const mountsReact = f.imports.some((x) => x.source === 'react-dom' || x.source === 'react-dom/client');
    if (mountsReact || ENTRY_NAME.test(path.posix.basename(f.path)) || (usesNext && NEXT_ENTRY_RE.test(f.path))) {
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

  const { connections, unmatched, mountCount } = findConnections(files, fileSet);
  const count = (side) => Object.values(info).filter((i) => i.side === side).length;
  const kind = (k) => Object.values(info).filter((i) => i.kind === k).length;

  return {
    summary: {
      frontendFiles: count('frontend'),
      backendFiles: count('backend'),
      sharedFiles: count('shared'),
      configFiles: count('config'),
      hiddenFiles: count('hidden'),   // tests + UI kit files (not drawn in the diagram)
      testFiles: kind('test'),
      uiKitFiles: kind('ui-kit'),
      entryFiles: Object.values(info).filter((i) => i.isEntry).length,
      frontendToBackendLinks: connections.length,
      routerMounts: mountCount,       // how many router files were found mounted with app.use('/x', router)
      hasUi,
      stack: detectStack(files),
    },
    files: info,
    sections,
    connections,
    unmatchedApiCalls: unmatched,
  };
}

module.exports = { buildArchitecture, classifyFile };