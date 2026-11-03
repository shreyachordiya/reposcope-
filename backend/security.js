// reposcope-ignore-file
// security.js — Phase 7. Finds security EVIDENCE in a cloned repo.
// No LLM and no guessing: every finding points at a real file and line.
// Usage: const security = buildSecurity(rootDir);   (run BEFORE the temp clone is deleted)

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', 'vendor', 'out', '.turbo']);
const MAX_FILES = 4000;
const MAX_BYTES = 1024 * 1024;
const MAX_PER_RULE = 40;
const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const DATA_EXT = new Set(['.json', '.yml', '.yaml', '.html', '.toml']);

/* ---------- 1. What each rule means (one place, so UI + LLM share it) ---------- */

const m = (category, severity, confidence, title, why, fix) => ({ category, severity, confidence, title, why, fix });
const REVOKE = 'Revoke this key now, create a new one, and load it from an environment variable (process.env.NAME). Never commit it.';

const META = {
  // secrets
  'secret-key': m('secrets', 'high', 'high', 'API key or token written in code',
    'Anyone who can read this repo can use this key, and you pay for what they do with it. Bots scan public GitHub for keys within minutes.', REVOKE),
  'secret-private-key': m('secrets', 'high', 'high', 'Private key stored in the repo',
    'A private key proves identity. Anyone with this file can impersonate your server or account.',
    'Remove the file from the repo, rotate the key, and keep it outside git.'),
  'secret-db-url': m('secrets', 'high', 'high', 'Database password written in a connection string',
    'Anyone who can read the repo can open your database and read, change or delete everything.',
    'Change the database password now and move the connection string to an environment variable.'),
  'secret-jwt': m('secrets', 'high', 'medium', 'Hardcoded JWT or service token',
    'This looks like a signed token (for example a Supabase service key). Service keys bypass all access rules.',
    'Revoke it in the provider dashboard and load it from an environment variable. Only public "anon" keys may be in frontend code.'),
  'secret-fallback': m('secrets', 'high', 'high', 'Secret has a hardcoded fallback value',
    'If the environment variable is missing, the app silently runs with a secret that everyone can read in the repo, so login tokens can be forged.',
    'Remove the fallback and make the app refuse to start when the variable is missing.'),
  'secret-assign': m('secrets', 'high', 'medium', 'Possible hardcoded secret',
    'A variable named like a password or key is assigned a fixed value. If it is real, anyone with the repo can use it.',
    'If it is real, rotate it and move it to an environment variable. If it is only a label or example, ignore this.'),
  'env-committed': m('secrets', 'high', 'high', '.env file is committed to the repo',
    'A .env file normally holds all your secrets in one place. Because it is in the repo, everyone who can see the repo can read them.',
    'Delete it from git (git rm --cached .env), add .env to .gitignore, and rotate every secret that was inside.'),
  'env-secret': m('secrets', 'high', 'high', 'Secret value inside a committed .env file',
    'This value is readable by anyone with access to the repo.', REVOKE),
  'env-public-prefix': m('secrets', 'high', 'high', 'Secret exposed to the browser through a public prefix',
    'Variables starting with VITE_, REACT_APP_ or NEXT_PUBLIC_ are copied into the website for every visitor to read.',
    'Keep real secrets on the server only. Call the service from your backend instead of the browser.'),
  'secret-frontend-env': m('secrets', 'medium', 'medium', 'Key read in frontend code',
    'Frontend code is downloaded by every visitor, so anything it reads can be seen. Some keys (Firebase, Google Maps) are designed to be public, others are not.',
    'Check the provider docs. If this key must stay private, move the call to your backend.'),
  // browser
  'llm-frontend': m('browser', 'high', 'medium', 'AI provider called directly from the browser',
    'To call this from the browser, the API key has to be in the browser too, where anyone can copy it.',
    'Send the request to your own backend and call the provider from there.'),
  'storage-token': m('browser', 'medium', 'high', 'Token or secret stored in localStorage / sessionStorage',
    'Any script injected into the page (XSS) can read browser storage. An httpOnly cookie cannot be read by JavaScript.',
    'Prefer an httpOnly, secure, sameSite cookie set by the server for session tokens.'),
  'html-danger': m('browser', 'medium', 'medium', 'dangerouslySetInnerHTML used',
    'It inserts raw HTML. If any part comes from a user or an API, an attacker can run scripts on your page (XSS).',
    'Render text normally, or sanitize the HTML first (for example with DOMPurify).'),
  'html-inner': m('browser', 'medium', 'medium', 'innerHTML / outerHTML assigned',
    'Raw HTML inserted this way can run attacker scripts if any part is user-controlled.',
    'Use textContent, or sanitize the HTML first.'),
  'doc-write': m('browser', 'low', 'medium', 'document.write used',
    'It writes raw HTML into the page and is a common XSS path.', 'Use normal DOM methods or your framework.'),
  'eval': m('browser', 'high', 'medium', 'eval() used',
    'eval runs a string as code. If the string can be influenced by a user, they can run their own code.',
    'Remove eval. Parse data with JSON.parse and use real functions for logic.'),
  'new-function': m('browser', 'high', 'medium', 'new Function() used',
    'It builds code from a string, the same risk as eval.', 'Replace it with a normal function.'),
  'doc-cookie': m('browser', 'low', 'medium', 'Cookie written from JavaScript',
    'Cookies set with document.cookie cannot be httpOnly, so scripts can read them.',
    'Set session cookies from the server with httpOnly, secure and sameSite.'),
  // server
  'cors-open': m('server', 'medium', 'high', 'CORS allows every website',
    'cors() with no options lets any website call your API from a visitor\'s browser.',
    'Pass an allow-list: cors({ origin: ["https://your-site.com"] }).'),
  'cors-origin': m('server', 'medium', 'medium', 'CORS origin set to everything',
    'origin "*" or true lets any website call your API.', 'Use an explicit list of allowed origins.'),
  'tls-off': m('server', 'high', 'high', 'HTTPS certificate checking is turned off',
    'With checking off, an attacker on the network can pretend to be the server you connect to.',
    'Remove the setting. Fix the certificate instead of disabling the check.'),
  'weak-hash': m('server', 'medium', 'medium', 'MD5 or SHA1 hashing',
    'These are fast and broken for passwords; attackers can try billions of guesses per second.',
    'Hash passwords with bcrypt, scrypt or argon2.'),
  'nosql-body': m('server', 'high', 'medium', 'Request data passed straight into a database query',
    'An attacker can send an object like {"$ne": null} instead of a value and skip the check (NoSQL injection).',
    'Pick the fields you need, make sure they are strings, or use a sanitizer such as express-mongo-sanitize.'),
  // NEW rule: the most common NoSQL injection shape, findOne({ email: req.body.email })
  'nosql-field': m('server', 'medium', 'low', 'Request value placed straight into a database query',
    'If the client sends an object like {"$ne": null} instead of a string, the query can match every record (NoSQL injection). A classic result is logging in without a password.',
    'Convert the value to a string first (String(req.body.email)), validate it with zod/joi, or use express-mongo-sanitize.'),
  'nosql-where': m('server', 'high', 'medium', '$where used in a query',
    '$where runs JavaScript inside the database and is a known injection route.', 'Use normal query operators instead.'),
  'sql-concat': m('server', 'high', 'medium', 'SQL query built by joining strings',
    'If any joined part is user input, an attacker can change the query (SQL injection).',
    'Use parameterized queries (placeholders like $1 or ?).'),
  'cmd-inject': m('server', 'high', 'medium', 'Shell command built from variables',
    'If a variable contains user input, an attacker can run their own commands on your server.',
    'Use execFile/spawn with an argument list and never put user input in a command string.'),
  'path-trav': m('server', 'medium', 'medium', 'File path built from request data',
    'A user can send ../../ to read files outside the intended folder (path traversal).',
    'Resolve the path and check it stays inside an allowed folder, or look files up by id.'),
  'jwt-expiry': m('server', 'medium', 'medium', 'JWT signed without expiry',
    'A stolen token would work forever.', 'Add { expiresIn: "15m" } (or similar) to jwt.sign options.'),
  'cookie-flags': m('server', 'medium', 'medium', 'Cookie set without safe flags',
    'Without httpOnly scripts can read the cookie, without secure it travels over plain HTTP, without sameSite it can be sent from other sites.',
    'Set { httpOnly: true, secure: true, sameSite: "lax" } (or "strict").'),
  'route-noauth': m('server', 'medium', 'medium', 'Write route with no visible authentication',
    'POST/PUT/PATCH/DELETE routes change data. No auth middleware was found on this route, so anyone may be able to call it.',
    'Add an authentication middleware to the route, or confirm it is protected where the router is mounted.'),
  // packages
  'pkg-helmet': m('packages', 'low', 'high', 'No helmet (security headers)',
    'Helmet sets headers that block common browser attacks. This Express app does not list it.', 'npm i helmet, then app.use(helmet()).'),
  'pkg-ratelimit': m('packages', 'medium', 'high', 'No rate limiting',
    'Without a limit, login and expensive routes can be hammered by bots (brute force, cost abuse).', 'Add express-rate-limit, at least on login and any costly route.'),
  'pkg-validation': m('packages', 'low', 'medium', 'No input validation library',
    'Without validation, routes trust whatever the client sends.', 'Add zod, joi or express-validator and validate req.body.'),
  'gitignore-env': m('packages', 'low', 'high', '.env is not in .gitignore',
    'The next commit could include your secrets by accident.', 'Add a line ".env" to .gitignore.'),
  // ci
  'ci-target': m('ci', 'medium', 'medium', 'Workflow uses pull_request_target',
    'It runs with repo secrets on code from pull requests, including pull requests from strangers.',
    'Use pull_request, or never check out or run the pull request\'s code in this workflow.'),
  'ci-inject': m('ci', 'high', 'medium', 'Untrusted text used inside a workflow',
    'Issue titles, branch names and commit messages are written by outsiders. Placed in a script, they can run commands in your pipeline.',
    'Pass the value through an environment variable and use "$VAR" in the script.'),
  'ci-perms': m('ci', 'medium', 'high', 'Workflow has write-all permissions',
    'If anything in the pipeline is compromised, it can change your repo freely.', 'Set the minimum permissions per job.'),
  'ci-unpinned': m('ci', 'low', 'medium', 'Action pinned to a moving branch',
    'A third-party action on @main or @master can change under you.', 'Pin to a version tag or a commit SHA.'),
  'ci-echo': m('ci', 'medium', 'medium', 'Secret printed in a workflow step',
    'Secrets echoed into logs can leak.', 'Never echo secrets. Pass them to the tool that needs them as environment variables.'),
  // packages (live lookup)
  'pkg-vuln': m('packages', 'medium', 'high', 'Package with known vulnerabilities',
    'This version of a package you use is listed in a public vulnerability database (OSV). Attackers know about these holes.',
    'Update the package to a patched version and run your tests.'),
  // database rules
  'rules-open': m('server', 'high', 'high', 'Database rules allow everyone',
    'The rules say anyone can read or write, even people who are not logged in.',
    'Require login and check ownership, for example: allow read, write: if request.auth.uid == userId.'),
  'supabase-no-rls': m('server', 'high', 'medium', 'Supabase table without row-level security',
    'Without row-level security, anyone holding your public anon key (it is in your frontend) can read and change this table.',
    'Run: alter table <name> enable row level security; then add policies. If you enabled it in the dashboard, ignore this.'),
  'supabase-policy-open': m('server', 'medium', 'low', 'Row-level policy lets every row through',
    'A policy with using (true) allows everyone. That is fine for data meant to be public, dangerous for private data.',
    'Check what this table holds. For private data restrict it, for example using (auth.uid() = user_id).'),
  'mass-assign': m('server', 'medium', 'medium', 'Request body saved without choosing fields',
    'Saving req.body as a whole lets a user add fields you did not expect, like {"isAdmin": true}.',
    'Pick the allowed fields: const { name, email } = req.body, and save only those.'),
};

/* ---------- 2. Helpers ---------- */

function mask(value) {
  return value.length <= 8 ? '••••••' : value.slice(0, 4) + '••••••';
}
function maskLine(line, value) {
  return line.split(value).join(mask(value)).trim().slice(0, 200);
}
// CHANGED: a keyword only counts when a letter does not follow it ("test123" is a placeholder, "testing" is not)
function isPlaceholder(v) {
  const s = String(v).toLowerCase();
  if (/^(?:<|\{\{|\$\{|%|\*{3,}|\.{3,})/.test(s)) return true;
  if (/^(?:your|my|xxx+|changeme|change_me|change-me|example|sample|placeholder|dummy|test|todo|replace|insert|enter|none|null|undefined|true|false)(?![a-z])/.test(s)) return true;
  if (/^(?:secret|password)$/.test(s)) return true;
  if (/(your[_-]|_here|-here|xxxx|example|placeholder)/.test(s)) return true;
  return new Set(s).size <= 2;
}
function isComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('#');
}
const isTestPath = (rel) => /(^|\/)(__tests__|tests?|spec|specs|mocks?|fixtures?|e2e|cypress)(\/|$)|[._-](test|spec)\.[jt]sx?$|(^|\/)(test|spec)\.[jt]sx?$/i.test(rel);
// NEW: copy-pasted UI kits (shadcn/ui, React Bits, Magic UI ...). They legitimately use things like dangerouslySetInnerHTML.
const KIT_PATH = /(^|\/)components\/(ui|magicui|react-bits|reactbits|aceternity|animate-ui)\//i;
const isBackendPath = (rel) => /(^|\/)(backend|server|api|routes|controllers|middleware|models)(\/|$)/i.test(rel);

// NEW: decide frontend / backend from the file CONTENT first, folder name last.
// (Before, any file under src/ was "frontend", so Express apps in src/ skipped every server rule.)
// "res.json()" is NOT used as a signal on purpose: React code calls it on fetch responses.
const BACKEND_CONTENT = /\breq\.(?:body|params|query|headers|cookies)\b|\(\s*req\s*,\s*res\b|\b(?:from\s+|require\(\s*)['"](?:express|fastify|koa|@nestjs\/[\w-]+|mongoose|mongodb|pg|mysql2?|sequelize|@prisma\/client|jsonwebtoken|bcrypt(?:js)?|child_process)['"]/;
const FRONTEND_CONTENT = /\b(?:from\s+|require\(\s*)['"](?:react|react-dom|vue|svelte|preact|solid-js|next\/[\w\/-]+|@angular\/core)['"]|\b(?:window|document|localStorage|sessionStorage|navigator)\./;
function sideOf(rel, text) {
  if (BACKEND_CONTENT.test(text)) return 'backend';
  if (/\.(jsx|tsx|vue|svelte)$/.test(rel) || FRONTEND_CONTENT.test(text)) return 'frontend';
  if (isBackendPath(rel)) return 'backend';
  return 'unknown'; // unknown files get BOTH rule sets
}

function fileKind(f) {
  const ext = path.extname(f.name).toLowerCase();
  if (/^\.env(\..+)?$/.test(f.name)) return /\.(example|sample|template|dist)$/i.test(f.name) ? null : 'env';
  if (/\.rules$/.test(f.name) || /rules\.json$/.test(f.name)) return 'rules';
  if (ext === '.sql') return 'sql';
  if (/(-lock\.json|\.lock|\.min\.js|\.map)$/.test(f.name)) return null;
  if (f.rel.startsWith('.github/workflows/') && (ext === '.yml' || ext === '.yaml')) return 'ci';
  if (CODE_EXT.has(ext)) return 'code';
  if (DATA_EXT.has(ext)) return 'data';
  return null;
}

function listFiles(root) {
  const out = [];
  (function walk(dir) {
    if (out.length >= MAX_FILES) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(abs); }
      else if (e.isFile()) out.push({ abs, name: e.name, rel: path.relative(root, abs).split(path.sep).join('/') });
    }
  })(root);
  return out;
}

/* ---------- 3. Pattern tables ---------- */

// Secrets with a known shape. The value that gets masked is the LAST capture group, or the whole match.
const SECRET_PATTERNS = [
  { id: 'secret-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'secret-key', re: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { id: 'secret-key', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { id: 'secret-key', re: /\bsk-(?:ant-|proj-|live-)?[A-Za-z0-9_\-]{32,}\b/g },
  { id: 'secret-key', re: /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/g },
  { id: 'secret-key', re: /\bxox[baprs]-[0-9A-Za-z\-]{10,}\b/g },
  // NEW key shapes: Hugging Face, Groq, SendGrid, npm, Google OAuth client secret
  { id: 'secret-key', re: /\bhf_[A-Za-z0-9]{34,}\b/g },
  { id: 'secret-key', re: /\bgsk_[A-Za-z0-9]{40,}\b/g },
  { id: 'secret-key', re: /\bSG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}\b/g },
  { id: 'secret-key', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: 'secret-key', re: /\bGOCSPX-[A-Za-z0-9_\-]{20,}/g },
  { id: 'secret-private-key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, noMask: true },
  // CHANGED: not only mongodb, also postgres / mysql / redis / amqp connection strings with a password
  { id: 'secret-db-url', re: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp):\/\/[^:\s'"`\/@]*:([^@\s'"`]+)@/g },
  { id: 'secret-jwt', re: /\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g },
  // CHANGED: JWT added to the names
  { id: 'secret-fallback', re: /process\.env\.[A-Z0-9_]*(?:SECRET|KEY|TOKEN|PASSWORD|JWT)[A-Z0-9_]*\s*(?:\|\||\?\?)\s*['"`]([^'"`]{3,})['"`]/g, keepPlaceholders: true },
];

const GENERIC_ASSIGN = /["']?([A-Za-z0-9_.\-]*(?:secret|password|passwd|pwd|api[_-]?key|apikey|access[_-]?key|private[_-]?key|auth[_-]?token|jwt)[A-Za-z0-9_.\-]*)["']?\s*[:=]\s*["']([^"'\s]{8,})["']/i;

const SECRETISH = /(SECRET|PASSWORD|PASSWD|PRIVATE|TOKEN|API_?KEY|ACCESS_?KEY|SERVICE_?ROLE|DATABASE_URL|MONGO(DB)?_URI|JWT)/i;
const PUBLIC_PREFIX = /^(VITE|REACT_APP|NEXT_PUBLIC|NUXT_PUBLIC|EXPO_PUBLIC|GATSBY)_/;

// Simple one-line rules. scope: 'frontend' | 'backend' | 'any'
const LINE_RULES = [
  { id: 'llm-frontend', scope: 'frontend', re: /https?:\/\/(?:api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.groq\.com|api\.mistral\.ai)/ },
  // CHANGED: the bare word "key" was removed (it matched 'hotkeys', 'sortKey' ...)
  { id: 'storage-token', scope: 'frontend', re: /\b(?:localStorage|sessionStorage)\.setItem\(\s*['"`][^'"`]*(?:token|jwt|auth|secret|password|session|apikey|api_key)[^'"`]*['"`]/i },
  { id: 'html-danger', scope: 'frontend', re: /dangerouslySetInnerHTML/ },
  // CHANGED: innerHTML = '' (clearing an element) is no longer reported
  { id: 'html-inner', scope: 'frontend', re: /\.(?:innerHTML|outerHTML)\s*\+?=(?!=)(?!\s*(?:''|""|``))|\.insertAdjacentHTML\(/ },
  { id: 'doc-write', scope: 'frontend', re: /document\.write\(/ },
  { id: 'doc-cookie', scope: 'frontend', re: /document\.cookie\s*=(?!=)/ },
  { id: 'eval', scope: 'any', re: /(?<![\w.])eval\s*\(/ },
  { id: 'new-function', scope: 'any', re: /new Function\s*\(/ },
  { id: 'cors-open', scope: 'backend', re: /\bcors\(\s*\)/ },
  { id: 'cors-origin', scope: 'backend', re: /origin\s*:\s*(?:['"`]\*['"`]|true\b)/ },
  { id: 'tls-off', scope: 'any', re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED['"\]]*\s*=\s*['"]?0/ },
  { id: 'weak-hash', scope: 'backend', re: /createHash\(\s*['"](?:md5|sha1)['"]\s*\)/ },
  { id: 'nosql-body', scope: 'backend', re: /\.(?:find|findOne|findOneAndUpdate|findOneAndDelete|updateOne|updateMany|deleteOne|deleteMany|countDocuments)\(\s*req\.(?:body|query|params)\s*[,)]/ },
  // NEW: findOne({ email: req.body.email })
  { id: 'nosql-field', scope: 'backend', re: /\.(?:find|findOne|findOneAndUpdate|findOneAndDelete|updateOne|deleteOne|countDocuments)\(\s*\{[^}]*:\s*req\.(?:body|query)\.[A-Za-z_$][\w$]*/ },
  { id: 'mass-assign', scope: 'backend', re: /\.(?:create|insertOne|insertMany)\(\s*req\.body\s*[,)]|new\s+[A-Z]\w*\(\s*req\.body\s*\)|\b(?:findByIdAndUpdate|findOneAndUpdate|updateOne|updateMany)\([^;]*?,\s*req\.body\s*[,)]|Object\.assign\([^,]+,\s*req\.body\s*\)|\{\s*\.\.\.req\.body\s*\}/ },
  { id: 'nosql-where', scope: 'backend', re: /\$where\b/ },
  { id: 'sql-concat', scope: 'backend', re: /\.(?:query|execute|raw)\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+)/ },
  // CHANGED: also finds child_process.exec( / cp.exec( (before, anything with a dot in front was skipped)
  // and exec('ls ' + dir) where the variable is not literally req.something
  { id: 'cmd-inject', scope: 'backend', re: /(?:(?<![\w.])|\b(?:child_process|childProcess|cp)\.)(?:exec|execSync)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+|[^)]*\+\s*req\.)/ },
  { id: 'path-trav', scope: 'backend', re: /\b(?:readFile|readFileSync|sendFile|createReadStream|unlink|unlinkSync)\s*\([^)]*req\.(?:params|query|body)/ },
];

// CHANGED: also userRoutes.post(...), routes.post(...), authRouter.post(...) (before only app / router / xRouter)
const ROUTE_RE = /\b(?:app|router|routes?|server|\w*Routers?|\w*Routes?)\.(post|put|patch|delete)\s*\(\s*(['"`])([^'"`]*)\2(.*)$/;
const AUTH_RE = /(auth|protect|verify|jwt|passport|session|requireUser|isLoggedIn|ensureLogged|guard|permission|checkRole|isAdmin|token)/i;
const PUBLIC_PATH = /(login|signin|sign-in|register|signup|sign-up|webhook|forgot|reset|health|ping|contact|subscribe)/i;
// CHANGED: only a REAL auth middleware counts. Before, app.use('/api/auth', authRoutes) matched the word "auth"
// and marked the whole file as protected, which hid every unprotected route in server.js.
const GLOBAL_AUTH = /\.use\(\s*(?:['"`][^'"`]*['"`]\s*,\s*)?(?:auth|authenticate|authMiddleware|protect|verifyToken|verifyJWT|requireAuth|isAuthenticated|isLoggedIn|ensureAuthenticated|checkAuth|passport\.authenticate\([^)]*\)|expressjwt\([^)]*\)|jwt\([^)]*\))\s*[,)(]/i;

/* ---------- 4. The scanner ---------- */

function buildSecurity(rootDir) {
  const findings = [];
  const seen = new Set();
  const perRule = {};
  const files = listFiles(rootDir);
  const packages = [];
  let gitignoreHasEnv = false;
  let sawGitignore = false;
  let scanned = 0;
  const sqlTables = [];
  const sqlRls = new Set();
  let sqlSupabase = false;

  function add(id, file, line, evidence, over = {}) {
    const key = `${id}:${file}:${line}`;
    if (seen.has(key)) return;
    perRule[id] = (perRule[id] || 0) + 1;
    if (perRule[id] > MAX_PER_RULE) return;
    seen.add(key);
    const meta = META[id];
    const finding = {
      id: key, rule: id, title: meta.title, category: meta.category,
      severity: meta.severity, confidence: meta.confidence,
      file, line, evidence, why: meta.why, fix: meta.fix, ...over,
    };
    // Test files often hold fake passwords on purpose: keep the finding, but lower it.
    if (isTestPath(file)) {
      finding.severity = 'low';
      finding.confidence = 'low';
      finding.title += ' (test file)';
    } else if (KIT_PATH.test(file) && finding.category === 'browser') {
      // NEW: copied UI-kit components (shadcn chart.tsx uses dangerouslySetInnerHTML on purpose)
      finding.severity = 'low';
      finding.confidence = 'low';
      finding.title += ' (UI kit file)';
    }
    findings.push(finding);
  }

  for (const f of files) {
    if (f.name === '.gitignore') {
      sawGitignore = true;
      try { if (/^\s*\/?\*?\.env/m.test(fs.readFileSync(f.abs, 'utf8'))) gitignoreHasEnv = true; } catch { /* ignore */ }
      continue;
    }
    const kind = fileKind(f);
    if (!kind) continue;
    let text;
    try {
      if (fs.statSync(f.abs).size > MAX_BYTES) continue;
      text = fs.readFileSync(f.abs, 'utf8');
    } catch { continue; }
    if (text.slice(0, 300).includes('reposcope-ignore-file')) continue;
    scanned++;

    if (f.name === 'package.json') {
      try { packages.push({ rel: f.rel, json: JSON.parse(text) }); } catch { /* ignore */ }
    }

    const lines = text.split('\n');
    // CHANGED: side comes from the content first (see sideOf)
    const side = kind === 'code' ? sideOf(f.rel, text) : 'unknown';
    const front = side === 'frontend';
    const back = side === 'backend';
    const test = isTestPath(f.rel);

    if (kind === 'env') {
      add('env-committed', f.rel, 1, f.name + ' (values hidden)');
      lines.forEach((line, i) => {
        const mm = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)$/);
        if (!mm) return;
        const value = mm[2].replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '').trim();
        if (!value || isPlaceholder(value) || !SECRETISH.test(mm[1])) return;
        add('env-secret', f.rel, i + 1, `${mm[1]}=${mask(value)}`);
        if (PUBLIC_PREFIX.test(mm[1])) add('env-public-prefix', f.rel, i + 1, `${mm[1]}=${mask(value)}`);
      });
      continue;
    }

    if (kind === 'ci') {
      // CHANGED: ci-inject only counts inside "run:" / "script:" blocks. In env:, with: and if: the same
      // expression is safe, so reporting it there was a false alarm.
      let runIndent = null;
      lines.forEach((line, i) => {
        const n = i + 1;
        const ev = line.trim().slice(0, 200);
        if (isComment(line)) return;

        const ind = line.match(/^\s*/)[0].length;
        let inRun = false;
        if (runIndent !== null) {
          if (line.trim() === '' || ind > runIndent) inRun = true;
          else runIndent = null;
        }
        const start = line.match(/^(\s*)(?:-\s+)?(?:run|script)\s*:/);
        if (!inRun && start) {
          runIndent = start[1].length + (/^\s*-\s+/.test(line) ? 2 : 0);
          inRun = true; // the same line may already hold the command
        }

        if (/\bpull_request_target\b/.test(line)) add('ci-target', f.rel, n, ev);
        if (inRun && /\$\{\{\s*github\.(?:event\.(?:issue|pull_request|comment|review|head_commit)[^}]*(?:title|body|message|label)|head_ref)[^}]*\}\}/.test(line)) add('ci-inject', f.rel, n, ev);
        if (/permissions\s*:\s*write-all/.test(line)) add('ci-perms', f.rel, n, ev);
        if (/uses\s*:\s*[\w.\-]+\/[\w.\-\/]+@(?:main|master)\b/.test(line)) add('ci-unpinned', f.rel, n, ev);
        if (/\becho\b.*\$\{\{\s*secrets\./.test(line)) add('ci-echo', f.rel, n, ev);
      });
      continue;
    }

    if (kind === 'rules') {
      lines.forEach((line, i) => {
        if (isComment(line)) return;
        if (/allow\s+[^:;]*:\s*if\s+true\b/.test(line) || /"\.(?:read|write)"\s*:\s*(?:true|"true")/.test(line)) {
          add('rules-open', f.rel, i + 1, line.trim().slice(0, 200));
        }
      });
      continue;
    }

    if (kind === 'sql') {
      const supa = /supabase/i.test(f.rel) || /auth\.(uid|users|role)\b/i.test(text);
      if (supa) sqlSupabase = true;
      lines.forEach((line, i) => {
        const schema = line.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?(\w+)["`]?\./i);
        const c = line.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?["`]?(\w+)["`]?/i);
        if (c && !(schema && schema[1].toLowerCase() !== 'public')) {
          sqlTables.push({ name: c[1].toLowerCase(), file: f.rel, line: i + 1, text: line.trim().slice(0, 200) });
        }
        const r = line.match(/alter\s+table\s+(?:only\s+)?(?:public\.)?["`]?(\w+)["`]?\s+enable\s+row\s+level\s+security/i);
        if (r) sqlRls.add(r[1].toLowerCase());
        if (supa && /(using|with\s+check)\s*\(\s*true\s*\)/i.test(line)) add('supabase-policy-open', f.rel, i + 1, line.trim().slice(0, 200));
      });
      continue;
    }

    const isPkgJson = f.name === 'package.json' || f.name === 'tsconfig.json';
    let globalAuth = null;

    lines.forEach((line, i) => {
      if (line.length > 2000) return; // minified
      const n = i + 1;
      const ev = line.trim().slice(0, 200);

      // ---- secrets (all file kinds) ----
      let specificHit = false;
      for (const p of SECRET_PATTERNS) {
        for (const mm of line.matchAll(p.re)) {
          const value = mm.length > 1 ? mm[mm.length - 1] : mm[0];
          if (value === undefined) continue;
          if (!p.keepPlaceholders && isPlaceholder(value)) continue;
          add(p.id, f.rel, n, p.noMask ? ev : maskLine(line, value));
          specificHit = true;
        }
      }
      if (!specificHit && !isPkgJson && !isComment(line)) {
        const g = line.match(GENERIC_ASSIGN);
        if (g) {
          const value = g[2];
          // CHANGED: "forgot-password-link" or "reset_password_text" are labels, not secrets
          const label = /^[A-Za-z]+([-_.\/][A-Za-z]+)+$/.test(value);
          const looksSecret = /\d/.test(value) || (/[^A-Za-z0-9]/.test(value) && !label);
          if (looksSecret && !isPlaceholder(value) && !/^(\/|\.\/|https?:)/.test(value)) {
            add('secret-assign', f.rel, n, maskLine(line, value));
          }
        }
      }

      if (kind !== 'code' || test || isComment(line)) return;

      // ---- frontend env keys ----
      if (!back) {
        const e = line.match(/(?:import\.meta\.env|process\.env)\.((?:VITE|REACT_APP|NEXT_PUBLIC|NUXT_PUBLIC|EXPO_PUBLIC|GATSBY)_[A-Z0-9_]+)/);
        if (e) {
          if (/(SECRET|PRIVATE|PASSWORD|SERVICE_?ROLE)/.test(e[1])) add('secret-frontend-env', f.rel, n, ev, { severity: 'high', confidence: 'high' });
          else if (/(KEY|TOKEN)/.test(e[1])) add('secret-frontend-env', f.rel, n, ev);
        }
      }

      // ---- one-line rules ----
      for (const r of LINE_RULES) {
        if (r.scope === 'frontend' && back) continue;
        if (r.scope === 'backend' && front) continue;
        if (r.re.test(line)) add(r.id, f.rel, n, ev);
      }

      if (front) return;

      // ---- multi-line context rules (backend / unknown) ----
      const chunk = lines.slice(i, i + 8).join(' ');

      if (/\b(?:jwt|jsonwebtoken)\.sign\s*\(/.test(line) && !/expiresIn|\bexp\s*:/.test(chunk)) add('jwt-expiry', f.rel, n, ev);

      if (/\bres\.cookie\s*\(/.test(line)) {
        const cut = chunk.split(');')[0];
        const missing = ['httpOnly', 'secure', 'sameSite'].filter((k) => !cut.includes(k));
        if (missing.length) {
          add('cookie-flags', f.rel, n, `${ev}   (missing: ${missing.join(', ')})`,
            missing.includes('httpOnly') ? {} : { severity: 'low' });
        }
      }

      const r = line.match(ROUTE_RE);
      if (r) {
        if (globalAuth === null) globalAuth = GLOBAL_AUTH.test(text);
        const handlerStarted = /=>|function/.test(r[4]);
        const rest = r[4] + (handlerStarted ? '' : ' ' + (lines[i + 1] || ''));
        if (!globalAuth && !AUTH_RE.test(rest) && !PUBLIC_PATH.test(r[3])) {
          const mainFile = /(^|\/)(server|app|index)\.[jt]s$/.test(f.rel);
          add('route-noauth', f.rel, n, `${r[1].toUpperCase()} ${r[3]}  —  ${ev}`, { confidence: mainFile ? 'medium' : 'low' });
        }
      }
    });
  }

  // ---- package-level checks ----
  const flat = (j) => ({ ...(j.dependencies || {}), ...(j.devDependencies || {}) });
  for (const p of packages) {
    const deps = flat(p.json);
    const has = (...names) => names.some((x) => deps[x]);
    if (!deps.express) continue;
    if (!has('helmet')) add('pkg-helmet', p.rel, 1, 'express is installed, helmet is not');
    if (!has('express-rate-limit', 'rate-limiter-flexible', 'express-slow-down', '@nestjs/throttler')) add('pkg-ratelimit', p.rel, 1, 'express is installed, no rate limiting package');
    if (!has('zod', 'joi', '@hapi/joi', 'express-validator', 'yup', 'celebrate', 'ajv', 'class-validator', 'valibot')) add('pkg-validation', p.rel, 1, 'express is installed, no validation package');
  }
  if (packages.length && !gitignoreHasEnv) {
    add('gitignore-env', sawGitignore ? '.gitignore' : packages[0].rel, 1, sawGitignore ? '.gitignore has no .env line' : 'no .gitignore file found');
  }

  // ---- Supabase tables that never enable row-level security ----
  if (sqlSupabase) {
    for (const t of sqlTables) {
      if (!sqlRls.has(t.name)) add('supabase-no-rls', t.file, t.line, t.text, { title: `Table "${t.name}" has no row-level security` });
    }
  }

  // NEW: be honest when the scan was cut short
  let note = NOTE;
  if (files.length >= MAX_FILES) note += ` Only the first ${MAX_FILES} files were scanned.`;
  const capped = Object.keys(perRule).filter((k) => perRule[k] > MAX_PER_RULE);
  if (capped.length) note += ` These rules matched more than ${MAX_PER_RULE} times and only the first ${MAX_PER_RULE} are shown: ${capped.join(', ')}.`;

  return finish(findings, scanned, note);
}

const NOTE = 'No findings only means these checks did not match. It does not prove the project is secure.';

function finish(findings, scanned, note) {
  const rank = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);

  const count = (fn) => findings.filter(fn).length;
  const byCategory = {};
  findings.forEach((x) => { byCategory[x.category] = (byCategory[x.category] || 0) + 1; });

  return {
    summary: {
      total: findings.length,
      high: count((x) => x.severity === 'high'),
      medium: count((x) => x.severity === 'medium'),
      low: count((x) => x.severity === 'low'),
      byCategory,
      filesScanned: scanned,
    },
    findings,
    checks: Object.values(META).map((x) => ({ category: x.category, title: x.title })),
    note: note || NOTE,
  };
}

/* ---------- 5. Vulnerable packages (asks the public OSV database) ---------- */

const OSV = 'https://api.osv.dev/v1';
const SEV = { CRITICAL: 'high', HIGH: 'high', MODERATE: 'medium', MEDIUM: 'medium', LOW: 'low' };
const SEV_RANK = { high: 0, medium: 1, low: 2 };

async function osvFetch(url, options) {
  if (typeof fetch !== 'function') throw new Error('fetch needs Node 18+');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(url, { ...options, signal: ctl.signal });
    if (!res.ok) throw new Error('OSV answered ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function collectPackages(rootDir) {
  const files = listFiles(rootDir);
  const found = new Map();
  const lockDirs = new Set();

  const addV1 = (deps, file) => {
    for (const [name, val] of Object.entries(deps || {})) {
      if (val && val.version) found.set(`${name}@${val.version}`, { name, version: val.version, file, exact: true, dev: !!val.dev });
      if (val && val.dependencies) addV1(val.dependencies, file);
    }
  };

  for (const f of files) {
    if (f.name !== 'package-lock.json') continue;
    try {
      const lock = JSON.parse(fs.readFileSync(f.abs, 'utf8'));
      lockDirs.add(path.posix.dirname(f.rel));
      for (const [key, val] of Object.entries(lock.packages || {})) {
        if (!key || !val || !val.version || val.link) continue;
        const name = key.split('node_modules/').pop();
        if (name) found.set(`${name}@${val.version}`, { name, version: val.version, file: f.rel, exact: true, dev: !!val.dev });
      }
      if (!lock.packages) addV1(lock.dependencies, f.rel);
    } catch { /* ignore */ }
  }

  // projects with no lock file: use the version written in package.json (less exact)
  for (const f of files) {
    if (f.name !== 'package.json' || lockDirs.has(path.posix.dirname(f.rel))) continue;
    try {
      const json = JSON.parse(fs.readFileSync(f.abs, 'utf8'));
      const all = { ...(json.dependencies || {}), ...(json.devDependencies || {}) };
      for (const [name, range] of Object.entries(all)) {
        const version = String(range).replace(/^[\^~>=<\s]+/, '').split(/\s|\|\|/)[0];
        if (/^\d+\.\d+\.\d+/.test(version)) found.set(`${name}@${version}`, { name, version, file: f.rel, exact: false, dev: !!(json.devDependencies || {})[name] });
      }
    } catch { /* ignore */ }
  }
  return [...found.values()].slice(0, 2000);
}

async function scanVulnerablePackages(rootDir) {
  const list = collectPackages(rootDir);
  const hits = [];

  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    const data = await osvFetch(`${OSV}/querybatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: chunk.map((p) => ({ package: { name: p.name, ecosystem: 'npm' }, version: p.version })) }),
    });
    (data.results || []).forEach((r, idx) => {
      if (r && r.vulns && r.vulns.length) hits.push({ ...chunk[idx], ids: r.vulns.map((v) => v.id) });
    });
  }

  // look up severity for the first two advisories of each hit (capped so it stays quick)
  // CHANGED: budget 60 -> 120, because 60 hits x 2 advisories needs 120 lookups
  let budget = 120;
  const out = [];
  for (const h of hits.slice(0, 60)) {
    let severity = null;
    let summary = '';
    const ids = h.ids.slice(0, 2).filter(() => budget-- > 0);
    const details = await Promise.all(ids.map((id) => osvFetch(`${OSV}/vulns/${encodeURIComponent(id)}`).catch(() => null)));
    for (const d of details) {
      if (!d) continue;
      if (!summary && d.summary) summary = d.summary;
      const level = SEV[String((d.database_specific && d.database_specific.severity) || '').toUpperCase()];
      if (level && (severity === null || SEV_RANK[level] < SEV_RANK[severity])) severity = level;
    }
    const meta = META['pkg-vuln'];
    const n = h.ids.length;
    out.push({
      id: `pkg-vuln:${h.name}@${h.version}`,
      rule: 'pkg-vuln',
      title: `${h.name}@${h.version} has ${n} known ${n === 1 ? 'vulnerability' : 'vulnerabilities'}`,
      category: 'packages',
      severity: severity || 'medium',
      confidence: h.exact ? 'high' : 'medium',
      file: h.file,
      line: 1,
      evidence: (h.ids.slice(0, 4).join(', ') + (n > 4 ? ` (+${n - 4} more)` : '') + (summary ? ' | ' + summary : '') +
        (severity ? '' : ' | severity not looked up') + (h.dev ? ' | dev dependency' : '')).slice(0, 300),
      why: meta.why,
      fix: `Update ${h.name} to a patched version (details: https://osv.dev/vulnerability/${h.ids[0]}), then run your tests.`,
    });
  }
  if (hits.length > 60) out.truncated = hits.length - 60;
  return out;
}

/* ---------- 6. The function server.js calls ---------- */

async function buildSecurityFull(rootDir) {
  const base = buildSecurity(rootDir);
  let extra = [];
  let note = base.note; // CHANGED: keeps the "scan was cut short" notes from buildSecurity
  try {
    extra = await scanVulnerablePackages(rootDir);
    if (extra.truncated) note += ` ${extra.truncated} more vulnerable packages were found but only the first 60 are listed.`;
  } catch (err) {
    note += ' The package vulnerability lookup was unavailable (no internet or OSV down), so that check did not run.';
  }
  return finish([...base.findings, ...extra], base.summary.filesScanned, note);
}

module.exports = { buildSecurity, buildSecurityFull };