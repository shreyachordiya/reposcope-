// parser.js  --  RepoScope "reader"
// Job: open every JS/TS file of a repo, turn the code into a tree (AST)
// with Babel, walk the tree, and write down FACTS (imports, routes,
// db calls ...). No guessing and no LLM here.
//
// "FIXED #n" = a bug that was corrected earlier (already tested).
//   FIXED #1 fetch() url        FIXED #2 broken facts object
//   FIXED #3 count parse errors FIXED #4 honest coverage numbers
//   FIXED #5 Object.create() shown as db call
//   FIXED #6 handler "authController.login" shown as (inline)
//   FIXED #7 module.exports = { a, b } lost names
//   FIXED #8 asyncHandler / catchAsync / useCallback gave inside:null
//
// "ADDED #n" = NEW facts. Nothing old was changed, these only ADD.
//   ADDED #9   route.middleware   (middleware list on every route)
//   ADDED #10  auth facts         (JWT, bcrypt/argon2, cookies, sessions,
//                                  passport, Authorization header,
//                                  credentials, token in localStorage)
//   ADDED #11  middleware facts   (app.use(cors()), app.use('/api', router) ...)
//   ADDED #12  envVars            (process.env.X)
//   ADDED #13  dbConnections      (mongoose.connect, MongoClient, PrismaClient)
//   ADDED #14  hooks              (useEffect / useLayoutEffect + deps + calls)
//   ADDED #15  clientRoutes       (React Router <Route path element>)
//   ADDED #16  axios instances    (const api = axios.create(); api.get(...))
//   ADDED #17  integrations       (Redux/Zustand, uploads, payments, maps/charts,
//                                  email/SMS, sockets)
//
// Search for "ADDED" to find every new block. The ONLY places where a line
// was inserted into old code are marked "ADDED #9" (2 route objects),
// the facts object, and the summary counts. Everything else is new code.
// =====================================================================

// ---------- 1. Imports (tools we use) ----------
const fs = require('fs');                 // read files and folders from disk
const path = require('path');             // build and clean file paths
const parser = require('@babel/parser');  // turns code text into a tree (the AST)
// traverse = a walker. The tree is giant, so we walk through its nodes one by one.
const traverse = require('@babel/traverse').default;

// ---------- 2. Settings (constants) ----------

// Folders we never analyze: libraries, build output, caches. Not useful for understanding the project.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.svelte-kit',
  '.cache', '.turbo', 'coverage', 'out', 'vendor', 'storybook-static',
]);

// The file tree on screen shows more than we analyze, so only these two are hidden from it.
const TREE_SKIP_DIRS = new Set(['node_modules', '.git']);

// File types Babel can read directly.
const JS_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts']);

// Vue / Svelte files: we only pull the <script> part out of them (templates are ignored for now).
const SFC_EXT = new Set(['.vue', '.svelte']);

// Code in other languages. We cannot read these, we only COUNT them so coverage stays honest.
const OTHER_CODE_EXT = new Set([
  '.py', '.java', '.go', '.rb', '.php', '.rs', '.cs', '.cpp', '.c', '.h', '.kt', '.swift', '.dart', '.scala',
]);

const MAX_FILE_SIZE = 25 * 1024 * 1024; // files bigger than 25 MB are skipped

// Words that make a call look like an Express route: app.get, router.post ...
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use']);

// Mongoose methods that mean "talking to the database": User.find(), User.create() ...
const DB_METHODS = new Set([
  'find', 'findOne', 'findById', 'findOneAndUpdate', 'findByIdAndUpdate',
  'findByIdAndDelete', 'create', 'insertMany', 'updateOne', 'updateMany',
  'deleteOne', 'deleteMany', 'countDocuments', 'aggregate', 'save',
]);

// FIXED #5: JavaScript built-ins that start with a capital letter.
// Our db rule is "Capital letter + db method name", so Object.create() looked like a db call.
// Anything in this list is NOT a database model, so we ignore it.
const NOT_MODELS = new Set([
  'Object', 'Array', 'JSON', 'Promise', 'Math', 'Number', 'String', 'Boolean',
  'Date', 'Symbol', 'Reflect', 'Proxy', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Buffer', 'Intl', 'Error', 'RegExp', 'Function', 'BigInt', 'URL', 'FormData',
]);

// Functions that wrap another function: const X = memo(() => ...).
// FIXED #8: added asyncHandler, catchAsync (Express controllers) and useCallback (React),
// so code inside them gets the right "inside" name instead of null.
const WRAPPERS = new Set([
  'memo', 'forwardRef', 'observer',
  'asyncHandler', 'catchAsync', 'useCallback',
]);

// ---- ADDED: constants used only by the new facts (#10 - #16) ----

// ADDED #10: jwt.sign / jwt.verify / jwt.decode  (the library is usually imported as jwt or jsonwebtoken)
const JWT_OBJECTS = /^(jwt|jsonwebtoken)$/i;
// ADDED #10: bcrypt.hash / bcrypt.compare ... (bcrypt and bcryptjs have the same method names)
const BCRYPT_OBJECTS = /^bcrypt(js)?$/i;
const BCRYPT_METHODS = new Set(['hash', 'hashSync', 'compare', 'compareSync', 'genSalt', 'genSaltSync']);
// ADDED #10: passport.use / passport.authenticate ...
const PASSPORT_METHODS = new Set(['use', 'authenticate', 'initialize', 'session', 'serializeUser', 'deserializeUser']);
// ADDED #10: names the session middleware is usually called (we also check the real import below)
const SESSION_FUNCS = new Set(['session', 'expressSession', 'cookieSession']);
// ADDED #10: browser storage. We only record keys that look like tokens / logins (see TOKEN_KEY).
const STORAGE_AREAS = new Set(['localStorage', 'sessionStorage']);
const STORAGE_METHODS = new Set(['setItem', 'getItem', 'removeItem']);
const TOKEN_KEY = /token|jwt|auth|session|access|refresh|credential|user/i;
// ADDED #11: option names whose VALUE is safe to store (never secrets, passwords or keys).
// Any other option is ignored so a secret can never leak into the facts.
const SAFE_OPTION_KEYS = new Set([
  'origin', 'credentials', 'windowMs', 'max', 'httpOnly', 'secure', 'sameSite', 'maxAge',
  'resave', 'saveUninitialized', 'expiresIn', 'algorithm', 'algorithms', 'limit',
]);
// ADDED #14: React hooks that run code after a render (page-load logic lives here)
const EFFECT_HOOKS = new Set(['useEffect', 'useLayoutEffect']);
// ADDED #16: methods you can call on an axios instance: api.get(...), api.post(...)
const AXIOS_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

// ---------- 3. File-finding helpers ----------

// Is this file one we can read? (checks the extension only)
function isReadable(name) {
  const ext = path.extname(name).toLowerCase();
  return JS_EXT.has(ext) || SFC_EXT.has(ext);
}

// Walks through folders (and sub-folders) and collects every readable code file.
// Skips symlinks and the folders in SKIP_DIRS.
function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;            // symlinks can loop forever, skip them
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, found); // go inside the folder
    } else if (isReadable(entry.name)) {
      found.push(full);                              // readable code file, keep it
    }
  }
  return found;
}

// Lists EVERY file (any extension) as paths like "src/components/TopBar.jsx".
// This feeds the file tree on screen and the "unsupported language" count.
function listAllFiles(dir, rootDir = dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!TREE_SKIP_DIRS.has(entry.name)) listAllFiles(full, rootDir, found); // enter the new folder
    } else {
      // store the path relative to the repo root, always with "/" (also on Windows)
      found.push(path.relative(rootDir, full).split(path.sep).join('/'));
    }
  }
  return found;
}

// Minified / bundled files are machine output, not hand-written code.
// Detected by name (.min.js) or by very long lines on average.
function isGenerated(filePath, code) {
  if (/\.min\.(js|cjs|mjs)$/i.test(filePath)) return true;
  const lines = code.split('\n').length;
  return code.length > 20000 && code.length / lines > 200;
}

// .vue / .svelte files mix HTML + script. This keeps ONLY the <script> parts so Babel can read them.
// Empty lines are added so line numbers still match the original file.
function extractScripts(code) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi; // finds every <script ...> ... </script>
  let out = '';
  let usedLines = 0;
  let lang = 'js';
  let m;
  while ((m = re.exec(code))) {
    if (/lang\s*=\s*["']?(ts|typescript)/i.test(m[1])) lang = 'ts'; // <script lang="ts">
    const startLine = code.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length - 1;
    out += '\n'.repeat(Math.max(0, startLine - usedLines)) + m[2]; // pad with blank lines, add script text
    usedLines = startLine + m[2].split('\n').length - 1;
  }
  return { code: out, lang };
}

// ---------- 4. Babel parsing ----------

// Turns code text into an AST. Tries several plugin setups (JSX, TypeScript, decorators, Flow)
// and uses the first one that works. errorRecovery lets Babel skip a broken piece instead of dying;
// FIXED #3 below counts how many pieces it had to skip.
function parseCode(code, ext, forceTs) {
  const isTs = forceTs || ['.ts', '.mts', '.cts'].includes(ext);
  // if it is a TypeScript file use the first list, otherwise use the second list
  const sets = isTs
    ? [['typescript'], ['jsx', 'typescript'], ['typescript', 'decorators-legacy'], ['jsx', 'typescript', 'decorators-legacy']]
    : [['jsx', 'typescript'], ['jsx', 'typescript', 'decorators-legacy'], ['jsx', 'flow'], ['jsx']];
  let lastError;
  for (const plugins of sets) {
    try {
      return parser.parse(code, {
        sourceType: 'unambiguous',          // works for both import/export and require
        errorRecovery: true,                // do not die on small syntax problems
        allowReturnOutsideFunction: true,   // be forgiving about odd placements
        allowAwaitOutsideFunction: true,
        allowImportExportEverywhere: true,
        plugins,
      });
    } catch (e) {
      lastError = e;                        // this setup failed, try the next one
    }
  }
  throw lastError;                          // every setup failed, the file counts as failed
}

// ---------- 5. Small helper functions used while walking the tree ----------

// Reads a URL/path argument and returns { value, resolved }.
//   "/login"          -> { value: '/login', resolved: true }
//   `/u/${id}`        -> { value: '/u/${}',  resolved: false }  (has a variable inside)
//   someVar / nothing -> { value: '(dynamic)' or null, resolved: false }
function readUrl(node) {
  if (!node) return { value: null, resolved: false };
  if (node.type === 'StringLiteral') return { value: node.value, resolved: true };
  if (node.type === 'TemplateLiteral') {
    const text = node.quasis.map((q) => q.value.raw).join('${}');
    return { value: text, resolved: node.expressions.length === 0 };
  }
  return { value: '(dynamic)', resolved: false };
}

// Splits "router.get" into { object: 'router', property: 'get' }.
function memberName(node) {
  if (node.type !== 'MemberExpression' || node.computed) return null;
  const object = node.object.type === 'Identifier' ? node.object.name : null;
  const property = node.property.type === 'Identifier' ? node.property.name : null;
  return { object, property };
}

// router.route('/x').get(a).post(b): goes down the chain to find the '/x'.
function routeChainPath(node) {
  let cur = node;
  while (cur && cur.type === 'CallExpression' && cur.callee.type === 'MemberExpression') {
    if (cur.callee.property && cur.callee.property.name === 'route' && cur.arguments[0]) {
      return readUrl(cur.arguments[0]);
    }
    cur = cur.callee.object;
  }
  return null;
}

// Gets the name of the function being called: memo(...) -> 'memo', React.memo(...) -> 'memo'.
function wrapperName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
}

// FIXED #6: gives a readable name to a route handler argument.
//   login                  -> 'login'
//   authController.login   -> 'authController.login'   (before: wrongly '(inline)')
//   (req, res) => {...}    -> '(inline)'
function handlerName(node) {
  if (!node) return '(inline)';
  if (node.type === 'Identifier') return node.name;
  if (
    node.type === 'MemberExpression' && !node.computed &&
    node.object.type === 'Identifier' && node.property.type === 'Identifier'
  ) {
    return node.object.name + '.' + node.property.name;
  }
  return '(inline)';
}

// ADDED #9: names a middleware argument so it can be listed on a route.
//   auth                -> 'auth'
//   ctrl.check          -> 'ctrl.check'
//   validate(schema)    -> 'validate()'     (a call that RETURNS a middleware)
//   (req, res, next)=>  -> '(inline)'
function middlewareName(node) {
  if (node.type === 'CallExpression') {
    const n = handlerName(node.callee);
    return n === '(inline)' ? n : n + '()';
  }
  return handlerName(node);
}

// FIXED #7/#8: for  exports.login = ...  or  module.exports.login = ...  returns 'login', else null.
function exportsPropName(left) {
  if (!left || left.type !== 'MemberExpression' || left.computed || left.property.type !== 'Identifier') return null;
  const o = left.object;
  const isExports = o.type === 'Identifier' && o.name === 'exports';
  const isModExports =
    o.type === 'MemberExpression' && o.object.type === 'Identifier' && o.object.name === 'module' &&
    o.property.type === 'Identifier' && o.property.name === 'exports';
  return isExports || isModExports ? left.property.name : null;
}

// Does this function contain JSX (<div>...)? If yes and its name is Capitalized, it is a React component.
function containsJSX(fnPath) {
  let found = false;
  fnPath.traverse({
    JSXElement(p) { found = true; p.stop(); },
    JSXFragment(p) { found = true; p.stop(); },
  });
  return found;
}

// PHASE 6: "which function is this code sitting inside?"
// Walks outward from the current spot until it finds a function with a usable name.
//   function foo() {}                     -> "foo"
//   const foo = () => {}                  -> "foo"
//   app.post('/x', (req, res) => {})      -> "POST /x"
//   <button onClick={() => {}} />         -> "onClick@40"  (event + line)
//   exports.login = async () => {}        -> "login"       (FIXED #8)
// Anonymous callbacks (.then, .map, setTimeout) count as part of the function around them.
function enclosingName(p) {            // p = current position in the tree
  let fn = p.getFunctionParent();      // nearest function around us
  while (fn) {
    const n = fn.node;
    const parent = fn.parent;

    // function foo() {}
    if (n.type === 'FunctionDeclaration' && n.id) return n.id.name;
    // class method or object method: login() {}
    if ((n.type === 'ClassMethod' || n.type === 'ObjectMethod') && n.key && n.key.type === 'Identifier') {
      return n.key.name;
    }
    // const foo = () => {}
    if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;

    // FIXED #8: exports.login = async () => {}   (function assigned straight to exports)
    if (parent.type === 'AssignmentExpression' && parent.right === n) {
      const nm = exportsPropName(parent.left);
      if (nm) return nm;
    }

    // function passed into another call: memo(() => ...), app.post('/x', () => ...)
    if (parent.type === 'CallExpression') {
      const grand = fn.parentPath.parent;
      // const Foo = memo(() => ...)  /  const login = asyncHandler(async () => ...)
      if (WRAPPERS.has(wrapperName(parent.callee)) && grand.type === 'VariableDeclarator' && grand.id.type === 'Identifier') {
        return grand.id.name;
      }
      // FIXED #8: exports.login = asyncHandler(async () => ...)
      if (WRAPPERS.has(wrapperName(parent.callee)) && grand.type === 'AssignmentExpression') {
        const nm = exportsPropName(grand.left);
        if (nm) return nm;
      }
      // app.post('/x', (req, res) => {})  ->  "POST /x"
      const c = parent.callee;
      if (
        c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier' &&
        HTTP_METHODS.has(c.property.name) &&
        parent.arguments[0] && parent.arguments[0].type === 'StringLiteral' &&
        parent.arguments.includes(n)
      ) {
        return c.property.name.toUpperCase() + ' ' + parent.arguments[0].value;
      }
    }

    // <button onClick={() => {}} />  ->  "onClick@40"
    if (parent.type === 'JSXExpressionContainer') {
      const attr = fn.parentPath.parent;
      if (attr && attr.type === 'JSXAttribute' && typeof attr.name.name === 'string') {
        return attr.name.name + '@' + (n.loc ? n.loc.start.line : '?');
      }
    }

    fn = fn.getFunctionParent(); // no name here, look at the next function further out
  }
  return null; // we are at the top level of the file
}

// ---------- 5b. ADDED: helper functions for the new facts (#10 - #16) ----------

// ADDED #12: is this node exactly  process.env  ?
function isProcessEnv(node) {
  return (
    node && node.type === 'MemberExpression' && !node.computed &&
    node.object.type === 'Identifier' && node.object.name === 'process' &&
    node.property.type === 'Identifier' && node.property.name === 'env'
  );
}

// ADDED #12: process.env.JWT_SECRET -> 'JWT_SECRET'   process.env['X'] -> 'X'   process.env[key] -> '(dynamic)'
// Anything that is not process.env.something returns null.
function envName(node) {
  if (!node || node.type !== 'MemberExpression' || !isProcessEnv(node.object)) return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'StringLiteral') return node.property.value;
  return '(dynamic)';
}

// ADDED #10: removes TypeScript wrappers so  process.env.X as string  and  process.env.X!  still work.
function unwrap(node) {
  while (node && (node.type === 'TSAsExpression' || node.type === 'TSNonNullExpression' || node.type === 'TypeCastExpression')) {
    node = node.expression;
  }
  return node;
}

// ADDED #10: WHERE does a value come from? The value itself is NEVER stored (so secrets never leak).
//   'abc'                          -> 'hardcoded'
//   process.env.JWT_SECRET         -> 'env:JWT_SECRET'
//   process.env.X || 'fallback'    -> 'env:X (with hardcoded fallback)'
//   someVariable                   -> 'variable:someVariable'
function valueSource(node) {
  node = unwrap(node);
  if (!node) return 'none';
  if (node.type === 'StringLiteral') return 'hardcoded';
  if (node.type === 'TemplateLiteral') return node.expressions.length ? 'dynamic' : 'hardcoded';
  const env = envName(node);
  if (env) return 'env:' + env;
  if (node.type === 'LogicalExpression') {
    const left = envName(unwrap(node.left));
    if (left) return node.right.type === 'StringLiteral' ? 'env:' + left + ' (with hardcoded fallback)' : 'env:' + left;
  }
  if (node.type === 'ArrayExpression') return node.elements.length ? valueSource(node.elements[0]) : 'none';
  if (node.type === 'Identifier') return 'variable:' + node.name;
  return 'other';
}

// ADDED #10: turns { a: 1, b: 'x' } (an object written in code) into a lookup: { a: <node>, b: <node> }.
// Only plain keys are read (no spreads, no [computed] keys).
function objectProps(node) {
  const out = {};
  if (!node || node.type !== 'ObjectExpression') return out;
  node.properties.forEach((x) => {
    if (x.type !== 'ObjectProperty' || x.computed) return;
    const k = x.key.type === 'Identifier' ? x.key.name : x.key.type === 'StringLiteral' ? x.key.value : null;
    if (k) out[k] = x.value;
  });
  return out;
}

// ADDED #10: a setting's value as short text.  true -> 'true', 'strict' -> 'strict', missing -> 'not set',
// anything calculated -> 'dynamic'. Only used for flags and settings, never for secrets.
function flagText(node) {
  if (!node) return 'not set';
  if (node.type === 'BooleanLiteral') return String(node.value);
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'NumericLiteral') return String(node.value);
  const env = envName(node);
  if (env) return 'env:' + env;
  return 'dynamic';
}

// ADDED #11: reads ONLY the safe options (cors origin, rate limit max ...) of  cors({ ... })  or  session({ ... }).
// Every other option (secret, keys, passwords) is skipped on purpose.
function safeOptions(node) {
  const out = {};
  const props = objectProps(node);
  for (const key of Object.keys(props)) {
    if (SAFE_OPTION_KEYS.has(key)) out[key] = flagText(props[key]);
  }
  return out;
}

// ADDED #10: name used in  new LocalStrategy(...)  /  new passportLocal.Strategy(...)
function newName(node) {
  const c = node.callee;
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') return c.property.name;
  return null;
}

// ADDED #10: localStorage.setItem(...) / window.localStorage.setItem(...) -> 'localStorage'
function storageArea(callee) {
  if (callee.type !== 'MemberExpression' || callee.computed) return null;
  const o = callee.object;
  if (o.type === 'Identifier') return o.name;
  if (o.type === 'MemberExpression' && !o.computed && o.property.type === 'Identifier') return o.property.name;
  return null;
}

// ADDED #15: name of a JSX tag: <Home /> -> 'Home',  <Foo.Bar /> -> 'Bar'
function jsxName(el) {
  const n = el.openingElement.name;
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXMemberExpression') return n.property.name;
  return null;
}

// ADDED #15: follows the first child of a JSX element downwards.
// <ProtectedRoute><Dashboard /></ProtectedRoute>  ->  ['ProtectedRoute', 'Dashboard']
function jsxChain(node) {
  const out = [];
  let cur = node;
  while (cur && cur.type === 'JSXElement') {
    const nm = jsxName(cur);
    if (nm) out.push(nm);
    cur = cur.children.find((c) => c.type === 'JSXElement') || null;
  }
  return out;
}

// ---------- 5c. ADDED #17: helpers for integrations ----------
// Redux/Zustand, uploads, payments, maps/charts, email/SMS, sockets.

// A file is only scanned if it imports one of these packages (avoids false positives).
const INTEGRATION_PKGS = new Set([
  'redux', '@reduxjs/toolkit', 'react-redux', 'zustand',
  'multer', 'cloudinary', 'multer-storage-cloudinary',
  'stripe', '@stripe/stripe-js', '@stripe/react-stripe-js', 'razorpay',
  'leaflet', 'react-leaflet', 'recharts', 'chart.js', 'react-chartjs-2', 'mapbox-gl', 'react-map-gl',
  'nodemailer', 'twilio',
  'socket.io', 'socket.io-client',
]);

// JSX tags worth recording per package (only the "main" chart/map tags, not every XAxis/Tooltip).
const VISUAL_COMPONENTS = {
  recharts: new Set(['LineChart', 'BarChart', 'PieChart', 'AreaChart', 'RadarChart', 'ScatterChart', 'ComposedChart', 'RadialBarChart', 'Treemap', 'FunnelChart', 'Sankey']),
  'react-chartjs-2': new Set(['Line', 'Bar', 'Pie', 'Doughnut', 'Radar', 'PolarArea', 'Scatter', 'Bubble']),
  'react-leaflet': new Set(['MapContainer']),
  'react-map-gl': new Set(['Map']),
};

// 'react-map-gl/mapbox' -> 'react-map-gl',  '@reduxjs/toolkit/query' -> '@reduxjs/toolkit'
function basePkg(source) {
  if (!source || source.startsWith('.') || source.startsWith('/')) return source;
  const parts = source.split('/');
  return source.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

// Writes a call target as text:  stripe.checkout.sessions.create -> 'stripe.checkout.sessions.create'
// A call in the middle becomes '()':  socket.to(room).emit -> 'socket.to().emit'
function calleePath(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'CallExpression') { const b = calleePath(node.callee); return b ? b + '()' : null; }
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    const b = calleePath(node.object);
    return b ? b + '.' + node.property.name : null;
  }
  return null;
}

// require('stripe')  -> 'stripe'  (used for require('stripe')(key) and require('socket.io')(server))
function requiredPkg(node) {
  if (
    node && node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require' &&
    node.arguments[0] && node.arguments[0].type === 'StringLiteral'
  ) return basePkg(node.arguments[0].value);
  return null;
}

// Key names of { a, b: 1, c() {} }  (also finds method-style keys, which objectProps skips)
function keyNames(node) {
  if (!node || node.type !== 'ObjectExpression') return [];
  return node.properties.map((x) => x.key && (x.key.name || x.key.value)).filter(Boolean).map(String);
}

// A URL (not a secret) as text: 'env:API_URL' or '/api' or null
function urlText(node) {
  const e = envName(node);
  return e ? 'env:' + e : readUrl(node).value;
}

// socket.io server option  { cors: { origin } }  -> short text
function corsText(node) {
  const cn = objectProps(node).cors;
  if (!cn) return 'cors: not set';
  const c = safeOptions(cn);
  return c.origin ? `cors origin: ${c.origin}` : 'cors: set';
}

// ---------- 6. Analyze ONE file ----------
function analyzeFile(filePath, rootDir) {
  // path relative to the repo root, e.g. "src/components/TopBar.jsx" (not the full computer path)
  const rel = path.relative(rootDir, filePath).split(path.sep).join('/');

  // The empty "notebook" where everything we discover about this file is written.
  const facts = {
    path: rel, size: 0, generated: false,
    imports: [], exports: [], functions: [], classes: [], components: [], types: [],
    routes: [], apiCalls: [], models: [], dbCalls: [], eventHandlers: [], calls: [],
    // FIXED #2: your file had an extra "};" here (syntax error). Now there is one clean ending.
    // FIXED #3: parseErrors = how many broken pieces Babel had to skip (0 = clean read).
    error: null, parseErrors: 0,
    // ADDED #10-#15: new empty lists. Every file gets all of them (empty if nothing was found).
    //   auth          = { kind, detail, line, inside, meta }  JWT, bcrypt, cookies, sessions, passport, headers, storage
    //   middleware    = { name, path, object, options, line, order }  app.use(...) / router.use(...)
    //   envVars       = { name, line, inside }  process.env.X
    //   dbConnections = { client, uri, line, inside }  where the app connects to the database
    //   hooks         = { hook, runs, deps, calls, async, line, inside }  useEffect and similar
    //   clientRoutes  = { path, index, element, wrappers, line }  React Router <Route>
    auth: [], middleware: [], envVars: [], dbConnections: [], hooks: [], clientRoutes: [],
    integrations: [],   // ADDED #17: { category, kind, detail, line, inside, meta }
  };

  try {
    // --- size check: very big files are skipped ---
    const stat = fs.statSync(filePath);
    facts.size = stat.size;
    if (stat.size > MAX_FILE_SIZE) {
      facts.error = `skipped: file is ${(stat.size / 1048576).toFixed(1)} MB (limit ${MAX_FILE_SIZE / 1048576} MB)`;
      return facts;
    }

    // --- read the file text ---
    let code = fs.readFileSync(filePath, 'utf8');
    if (code.charCodeAt(0) === 0xfeff) code = code.slice(1); // remove the invisible BOM character at the start
    const ext = path.extname(filePath).toLowerCase();

    // --- .vue / .svelte: keep only the <script> part ---
    let forceTs = false;
    if (SFC_EXT.has(ext)) {
      const s = extractScripts(code);
      code = s.code;
      forceTs = s.lang === 'ts';
      facts.components.push({ name: path.basename(filePath, ext), line: 1 }); // the file itself is a component
    }

    facts.generated = isGenerated(filePath, code);
    if (!code.trim()) return facts; // empty file, nothing to read

    // --- turn code into the tree ---
    const ast = parseCode(code, ext, forceTs);
    // FIXED #3: Babel puts the problems it skipped in ast.errors. We count them instead of ignoring them.
    facts.parseErrors = (ast.errors || []).length;

    const line = (n) => (n.loc ? n.loc.start.line : null);  // line number of a node
    const routerNames = new Set(); // variables created by express() / Router()

    // Saves a function. If its name is Capitalized and it returns JSX, it is also a React component.
    const recordFunction = (name, fnPath, node) => {
      facts.functions.push({ name, line: line(node) });
      if (/^[A-Z]/.test(name) && containsJSX(fnPath)) {
        facts.components.push({ name, line: line(node) });
      }
    };

    // --- walk the tree; each block below handles one kind of node ---
    traverse(ast, {

      // import x from 'y'   -> saves where it comes from, the names, and the line
      ImportDeclaration(p) {
        facts.imports.push({
          source: p.node.source.value,
          kind: 'import',
          names: p.node.specifiers.map((s) => s.local.name),
          typeOnly: p.node.importKind === 'type', // TypeScript "import type"
          line: line(p.node),
        });
      },

      // TypeScript style: import x = require('y')
      TSImportEqualsDeclaration(p) {
        const ref = p.node.moduleReference;
        if (ref.type === 'TSExternalModuleReference') {
          facts.imports.push({ source: ref.expression.value, kind: 'require', names: [p.node.id.name], typeOnly: false, line: line(p.node) });
        }
      },

      // export const a = 1  /  export { a, b }  /  export { a } from './x'
      ExportNamedDeclaration(p) {
        const n = p.node;
        if (n.source) { // "export ... from './x'" also counts as an import of './x'
          facts.imports.push({
            source: n.source.value,
            kind: 'reexport',
            names: n.specifiers.map((s) => s.exported.name || s.exported.value),
            typeOnly: n.exportKind === 'type',
            line: line(n),
          });
        }
        const d = n.declaration;
        if (d && d.id) facts.exports.push({ name: d.id.name || d.id.value, default: false });
        else if (d && d.declarations) {
          d.declarations.forEach((x) => x.id.name && facts.exports.push({ name: x.id.name, default: false }));
        }
        n.specifiers.forEach((s) => facts.exports.push({ name: s.exported.name || s.exported.value, default: false }));
      },

      // export * from './x'
      ExportAllDeclaration(p) {
        facts.imports.push({ source: p.node.source.value, kind: 'reexport', names: ['*'], typeOnly: p.node.exportKind === 'type', line: line(p.node) });
      },

      // export default something
      ExportDefaultDeclaration(p) {
        const d = p.node.declaration;
        facts.exports.push({ name: (d && d.id && d.id.name) || (d && d.name) || '(anonymous)', default: true });
      },

      // CommonJS exports:  module.exports = x   /   exports.login = ...
      AssignmentExpression(p) {
        const l = p.node.left;
        if (l.type !== 'MemberExpression') return;
        const r = p.node.right;
        const isModExports = (n) =>
          n.type === 'MemberExpression' && n.object.name === 'module' && n.property.name === 'exports';

        if (isModExports(l)) {
          // module.exports = ...   (kept exactly as before)
          facts.exports.push({ name: r.name || '(module.exports)', default: true });
          // FIXED #7: module.exports = { login, register }
          // before, the names login / register were lost. Now each one is saved as a named export.
          if (r.type === 'ObjectExpression') {
            r.properties.forEach((prop) => {
              const key = prop.key && (prop.key.name || prop.key.value); // spread items have no key, skipped
              if (key) facts.exports.push({ name: String(key), default: false });
            });
          }
        } else if (
          (isModExports(l.object) || (l.object.type === 'Identifier' && l.object.name === 'exports')) &&
          l.property.name
        ) {
          // exports.login = ...   (kept exactly as before)
          facts.exports.push({ name: l.property.name, default: false });
          // FIXED #7: exports.login = async (req, res) => {}  was never saved as a function.
          if (/Function/.test(r.type)) {
            recordFunction(l.property.name, p.get('right'), p.node);
          } else if (
            r.type === 'CallExpression' && WRAPPERS.has(wrapperName(r.callee)) &&
            r.arguments[0] && /Function/.test(r.arguments[0].type)
          ) {
            // exports.login = asyncHandler(async (req, res) => {})
            recordFunction(l.property.name, p.get('right.arguments.0'), p.node);
          }
        }
      },

      // function foo() {}
      FunctionDeclaration(p) {
        if (p.node.id) recordFunction(p.node.id.name, p, p.node);
      },

      // class Foo {}  (also React class components: extends Component / PureComponent)
      ClassDeclaration(p) {
        const name = p.node.id && p.node.id.name;
        if (!name) return;
        facts.classes.push({ name, line: line(p.node) });
        const sc = p.node.superClass;
        const scName = sc && (sc.name || (sc.property && sc.property.name));
        if (scName === 'Component' || scName === 'PureComponent') {
          facts.components.push({ name, line: line(p.node) });
        }
      },

      // TypeScript types
      TSInterfaceDeclaration(p) { facts.types.push({ name: p.node.id.name, kind: 'interface', line: line(p.node) }); },
      TSTypeAliasDeclaration(p) { facts.types.push({ name: p.node.id.name, kind: 'type', line: line(p.node) }); },
      TSEnumDeclaration(p) { facts.types.push({ name: p.node.id.name, kind: 'enum', line: line(p.node) }); },

      // const x = ...   -> arrow functions, routers (express()/Router()), wrapped functions (memo(...))
      VariableDeclarator(p) {
        const { id, init } = p.node;
        if (id.type !== 'Identifier' || !init) return;
        if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
          recordFunction(id.name, p.get('init'), p.node);
          return;
        }
        if (init.type === 'CallExpression') {
          const c = init.callee;
          // const app = express()  /  const router = Router()  -> remember these names as "routers"
          if (
            (c.type === 'Identifier' && (c.name === 'express' || c.name === 'Router')) ||
            (c.type === 'MemberExpression' && c.property.name === 'Router')
          ) {
            routerNames.add(id.name);
          }
          // const Foo = memo(() => ...) / const login = asyncHandler(async () => ...)
          const w = wrapperName(c);
          if (WRAPPERS.has(w) && init.arguments[0] && /Function/.test(init.arguments[0].type)) {
            recordFunction(id.name, p.get('init.arguments.0'), p.node);
          }
        }
      },

      // Every function CALL: require, fetch, axios, routes, database calls ...
      CallExpression(p) {
        const { callee, arguments: args } = p.node;
        const inside = enclosingName(p); // which function this call is inside

        // PHASE 6: remember every plain call so flows can follow them
        if (callee.type === 'Identifier' && callee.name !== 'require') {
          facts.calls.push({ name: callee.name, object: null, line: line(p.node), inside });
        } else if (
          callee.type === 'MemberExpression' && !callee.computed &&
          callee.property.type === 'Identifier' && callee.object.type === 'Identifier'
        ) {
          facts.calls.push({ name: callee.property.name, object: callee.object.name, line: line(p.node), inside });
        }

        // require('x')  (also saves the names: const { a, b } = require('x'))
        if (callee.type === 'Identifier' && callee.name === 'require' && args[0] && args[0].type === 'StringLiteral') {
          let names = [];
          const par = p.parent;
          if (par.type === 'VariableDeclarator') {
            if (par.id.type === 'Identifier') names = [par.id.name];
            else if (par.id.type === 'ObjectPattern') {
              names = par.id.properties
                .map((x) => (x.value && x.value.type === 'Identifier' ? x.value.name : x.argument && x.argument.name))
                .filter(Boolean);
            }
          }
          facts.imports.push({ source: args[0].value, kind: 'require', names, typeOnly: false, line: line(p.node) });
          return;
        }

        // import('x')  (lazy / dynamic import)
        if (callee.type === 'Import' && args[0] && args[0].type === 'StringLiteral') {
          facts.imports.push({ source: args[0].value, kind: 'dynamic', names: [], typeOnly: false, line: line(p.node) });
          return;
        }

        // fetch(url, { method })   -> a frontend call to the backend
        if (callee.type === 'Identifier' && callee.name === 'fetch') {
          // FIXED #1: args[0] is a tree node, not text. readUrl() turns it into { value, resolved }
          // and is safe when fetch() has no argument at all.
          const url = readUrl(args[0]);
          let method = 'GET';                       // fetch uses GET unless told otherwise
          const opts = args[1];
          if (opts && opts.type === 'ObjectExpression') {
            const m = opts.properties.find((x) => x.key && x.key.name === 'method');
            if (m && m.value.type === 'StringLiteral') method = m.value.value.toUpperCase();
          }
          facts.apiCalls.push({ client: 'fetch', method, url: url.value, resolved: url.resolved, line: line(p.node), inside });
          return;
        }

        // model('Name', schema)  after: const { model } = require('mongoose')
        if (callee.type === 'Identifier' && callee.name === 'model' && args.length >= 2 && args[0].type === 'StringLiteral') {
          facts.models.push({ name: args[0].value, line: line(p.node) });
          return;
        }

        // prisma.user.findMany()
        if (
          callee.type === 'MemberExpression' && !callee.computed &&
          callee.object.type === 'MemberExpression' &&
          callee.object.object.type === 'Identifier' && /^prisma$/i.test(callee.object.object.name) &&
          callee.property.type === 'Identifier'
        ) {
          facts.dbCalls.push({ model: callee.object.property.name, method: callee.property.name, client: 'prisma', line: line(p.node), inside });
          return;
        }

        // chained routes: router.route('/x').get(handler).post(handler)
        if (
          callee.type === 'MemberExpression' && !callee.computed &&
          callee.property.type === 'Identifier' && HTTP_METHODS.has(callee.property.name) &&
          callee.object.type === 'CallExpression'
        ) {
          const url = routeChainPath(callee.object);
          if (url) {
            const last = args[args.length - 1];
            facts.routes.push({
              method: callee.property.name.toUpperCase(),
              path: url.value,
              handler: handlerName(last), // FIXED #6: was only plain names, now also controller.method
              // ADDED #9: every argument before the handler is a middleware (auth, validate ...)
              middleware: args.slice(0, -1).map(middlewareName),
              line: line(p.node),
            });
            return;
          }
        }

        // from here on we need the "object.property" shape, e.g. axios.get, router.post
        const m = memberName(callee);
        if (!m || !m.property) return;

        // axios.get(url)  -> a frontend call to the backend
        if (m.object === 'axios' && HTTP_METHODS.has(m.property)) {
          const url = readUrl(args[0]);
          facts.apiCalls.push({ client: 'axios', method: m.property.toUpperCase(), url: url.value, resolved: url.resolved, line: line(p.node), inside });
          return;
        }

        // mongoose.model('Name', schema)  -> a database model is defined here
        if (m.object === 'mongoose' && m.property === 'model' && args[0] && args[0].type === 'StringLiteral') {
          facts.models.push({ name: args[0].value, line: line(p.node) });
          return;
        }

        // app.get('/x', handler) / router.post(...)  -> an Express route
        if (
          HTTP_METHODS.has(m.property) && m.object &&
          (routerNames.has(m.object) || /(app|router|routes?|server)$/i.test(m.object)) &&
          args[0] && (args[0].type === 'StringLiteral' || args[0].type === 'TemplateLiteral')
        ) {
          const url = readUrl(args[0]);
          const last = args[args.length - 1];
          facts.routes.push({
            method: m.property.toUpperCase(),
            path: url.value,
            handler: handlerName(last), // FIXED #6: authController.login is no longer shown as (inline)
            // ADDED #9: skip the path (first argument) and the handler (last), the rest is middleware
            middleware: args.slice(1, -1).map(middlewareName),
            line: line(p.node),
          });
          return;
        }

        // User.find(), User.create() ...  -> Capitalized object = likely a Mongoose model.
        // (This is a guess based on the capital letter. Lowercase names like user.save() are NOT caught yet.)
        // FIXED #5: built-ins such as Object.create() are ignored via NOT_MODELS.
        if (DB_METHODS.has(m.property) && m.object && /^[A-Z]/.test(m.object) && !NOT_MODELS.has(m.object)) {
          facts.dbCalls.push({ model: m.object, method: m.property, client: 'mongoose', line: line(p.node), inside });
        }
      },

      // onClick={...}, onChange={...} in JSX -> user interaction points
      JSXAttribute(p) {
        const name = p.node.name.name;
        if (typeof name !== 'string' || !/^on[A-Z]/.test(name)) return; // only on... attributes
        const v = p.node.value;
        if (v && v.type === 'JSXExpressionContainer') {
          const e = v.expression;
          const named = e.type === 'Identifier';
          facts.eventHandlers.push({
            event: name,
            handler: named ? e.name : '(inline)',
            // fn = the function name flows start from (inline ones use event@line)
            fn: named ? e.name : name + '@' + line(e),
            line: line(p.node),
          });
        }
      },
    });

    // =================================================================
    // ADDED #10 - #16: SECOND WALK over the same tree.
    // Why a second walk? The first walk above returns early in many places
    // (a 'return' after require, fetch, routes ...), so the new checks could
    // be skipped. A separate walk means the old code does not change at all
    // and the new checks always run. The cost is small (the tree is already built).
    // =================================================================

    // Stops the same fact from being saved twice (same kind + same line + same detail).
    const seen = new Set();

    // ADDED #10: saves one auth fact.  kind = what it is, detail = short readable text,
    // meta = the same information as separate fields (easy for security.js / Ask RepoScope to use).
    const addAuth = (kind, detail, node, inside, meta) => {
      const key = kind + '@' + line(node) + '@' + detail;
      if (seen.has(key)) return;
      seen.add(key);
      facts.auth.push({ kind, detail, line: line(node), inside, meta: meta || {} });
    };

    // ADDED #12: saves one environment variable use (once per name + line).
    const addEnv = (name, node, inside) => {
      const key = 'env@' + name + '@' + line(node);
      if (seen.has(key)) return;
      seen.add(key);
      facts.envVars.push({ name, line: line(node), inside });
    };

    // ADDED #16: axios instances created in THIS file:  const api = axios.create({ baseURL })
    // name -> baseURL (text, or 'env:X', or null)
    const axiosInstances = new Map();

    traverse(ast, {

      // ADDED #16: remember  const api = axios.create({ baseURL: ... })  so api.get(...) can be found later.
      // Limit: only works when the instance is created in the SAME file as it is used.
      VariableDeclarator(p) {
        const { id, init } = p.node;
        if (id.type !== 'Identifier' || !init || init.type !== 'CallExpression') return;
        const mn = memberName(init.callee);
        if (mn && mn.object === 'axios' && mn.property === 'create') {
          const o = objectProps(init.arguments[0]);
          const base = o.baseURL ? (envName(o.baseURL) ? 'env:' + envName(o.baseURL) : readUrl(o.baseURL).value) : null;
          axiosInstances.set(id.name, base);
        }
      },

      CallExpression(p) {
        const { callee, arguments: args } = p.node;
        const inside = enclosingName(p);   // which function this call is inside
        const mm = memberName(callee);     // { object, property } for  something.method(...), else null

        // ---------- ADDED #10: JWT ----------
        // jwt.sign(payload, secret, { expiresIn })   jwt.verify(token, secret)   jwt.decode(token)
        if (mm && mm.object && JWT_OBJECTS.test(mm.object)) {
          if (mm.property === 'sign') {
            const opts = objectProps(args[2]);
            const payload = objectProps(args[0]);
            // how long the token lives: the expiresIn option, or an "exp" field inside the payload
            const expiry = opts.expiresIn ? flagText(opts.expiresIn) : ('exp' in payload ? 'exp in payload' : 'none');
            const algorithm = opts.algorithm ? flagText(opts.algorithm) : 'default';
            const secret = valueSource(args[1]);
            addAuth('jwt.sign', `secret: ${secret}, expiresIn: ${expiry}, algorithm: ${algorithm}`, p.node, inside,
              { secret, expiresIn: expiry, algorithm });
          } else if (mm.property === 'verify') {
            const opts = objectProps(args[2]);
            const secret = valueSource(args[1]);
            const algorithms = opts.algorithms ? 'set' : 'not set';
            const ignoreExpiration = opts.ignoreExpiration ? flagText(opts.ignoreExpiration) : 'false (default)';
            addAuth('jwt.verify', `secret: ${secret}, algorithms: ${algorithms}, ignoreExpiration: ${ignoreExpiration}`, p.node, inside,
              { secret, algorithms, ignoreExpiration });
          } else if (mm.property === 'decode') {
            addAuth('jwt.decode', 'reads the token WITHOUT checking its signature', p.node, inside, {});
          }
        }

        // ---------- ADDED #10: password hashing (bcrypt / bcryptjs / argon2) ----------
        if (mm && mm.object && BCRYPT_OBJECTS.test(mm.object) && BCRYPT_METHODS.has(mm.property)) {
          // salt rounds: bcrypt.hash(pw, 10) -> second argument,  bcrypt.genSalt(10) -> first argument
          const roundsArg = /^genSalt/.test(mm.property) ? args[0] : args[1];
          const rounds = /^(hash|genSalt)/.test(mm.property) && roundsArg && roundsArg.type === 'NumericLiteral' ? roundsArg.value : null;
          const what = /^compare/.test(mm.property) ? 'checks a password against a stored hash'
            : /^hash/.test(mm.property) ? 'hashes a password' : 'creates a salt';
          addAuth('bcrypt.' + mm.property, rounds !== null ? `${what} (rounds: ${rounds})` : what, p.node, inside,
            { rounds });
        }
        if (mm && mm.object === 'argon2' && (mm.property === 'hash' || mm.property === 'verify')) {
          addAuth('argon2.' + mm.property, mm.property === 'hash' ? 'hashes a password' : 'checks a password against a stored hash', p.node, inside, {});
        }

        // ---------- ADDED #10: cookies set by the server ----------
        // res.cookie('token', value, { httpOnly, secure, sameSite })
        if (mm && mm.object && /^(res|response|reply)$/i.test(mm.object) && mm.property === 'cookie' && args.length >= 2) {
          const name = args[0].type === 'StringLiteral' ? args[0].value : '(dynamic)';
          const o = objectProps(args[2]);
          const meta = {
            name,
            httpOnly: flagText(o.httpOnly),
            secure: flagText(o.secure),
            sameSite: flagText(o.sameSite),
            maxAge: 'maxAge' in o || 'expires' in o ? 'set' : 'not set',
          };
          addAuth('cookie.set', `'${name}': httpOnly=${meta.httpOnly}, secure=${meta.secure}, sameSite=${meta.sameSite}, expiry=${meta.maxAge}`, p.node, inside, meta);
        }
        // res.clearCookie('token')  (usually logout)
        if (mm && mm.object && /^(res|response|reply)$/i.test(mm.object) && mm.property === 'clearCookie') {
          const name = args[0] && args[0].type === 'StringLiteral' ? args[0].value : '(dynamic)';
          addAuth('cookie.clear', `'${name}' removed`, p.node, inside, { name });
        }

        // ---------- ADDED #10: sessions (express-session / cookie-session) ----------
        // session({ secret, resave, saveUninitialized, store, cookie: { ... } })
        // We check the name AND the real import, so a renamed import is still found.
        const isSessionFn =
          callee.type === 'Identifier' && args[0] && args[0].type === 'ObjectExpression' &&
          (SESSION_FUNCS.has(callee.name) ||
            facts.imports.some((i) => (i.source === 'express-session' || i.source === 'cookie-session') && i.names.includes(callee.name)));
        if (isSessionFn) {
          const o = objectProps(args[0]);
          const co = objectProps(o.cookie);
          const meta = {
            secret: valueSource(o.secret || o.keys),   // only WHERE the secret comes from, never the secret itself
            store: 'store' in o ? 'set' : 'not set',
            resave: flagText(o.resave),
            saveUninitialized: flagText(o.saveUninitialized),
            cookie: {
              httpOnly: flagText(co.httpOnly),
              secure: flagText(co.secure),
              sameSite: flagText(co.sameSite),
              maxAge: 'maxAge' in co ? 'set' : 'not set',
            },
          };
          addAuth('session.config',
            `secret: ${meta.secret}, store: ${meta.store}, cookie httpOnly=${meta.cookie.httpOnly}, secure=${meta.cookie.secure}, sameSite=${meta.cookie.sameSite}`,
            p.node, inside, meta);
        }

        // ---------- ADDED #10: passport ----------
        // passport.use(new LocalStrategy(...))   passport.authenticate('jwt', ...)   passport.initialize() ...
        if (mm && mm.object === 'passport' && PASSPORT_METHODS.has(mm.property)) {
          let d = 'setup';
          if (mm.property === 'use' && args[0] && args[0].type === 'NewExpression') d = newName(args[0]) || 'strategy';
          else if (mm.property === 'authenticate') d = args[0] && args[0].type === 'StringLiteral' ? args[0].value : '(dynamic)';
          addAuth('passport.' + mm.property, d, p.node, inside, {});
        }

        // ---------- ADDED #10: Authorization header read with req.get('Authorization') ----------
        if (
          mm && mm.object && /^req(uest)?$/i.test(mm.object) && (mm.property === 'get' || mm.property === 'header') &&
          args[0] && args[0].type === 'StringLiteral' && args[0].value.toLowerCase() === 'authorization'
        ) {
          addAuth('header.authorization.read', 'reads the Authorization header', p.node, inside, {});
        }

        // ---------- ADDED #10: token kept in the browser ----------
        // localStorage.setItem('token', ...)   sessionStorage.getItem('user')   (only keys that look like logins)
        const area = storageArea(callee);
        if (
          area && STORAGE_AREAS.has(area) && callee.property.type === 'Identifier' &&
          STORAGE_METHODS.has(callee.property.name) &&
          args[0] && args[0].type === 'StringLiteral' && TOKEN_KEY.test(args[0].value)
        ) {
          addAuth('storage.' + callee.property.name.replace('Item', ''), `${area} key '${args[0].value}'`, p.node, inside,
            { area, key: args[0].value });
        }

        // ---------- ADDED #11: global middleware ----------
        // app.use(cors())   app.use(express.json())   app.use('/api/users', userRoutes)   router.use(auth)
        // One entry per middleware, in the order they are written (order matters in Express).
        if (
          mm && mm.property === 'use' && mm.object && args.length &&
          (routerNames.has(mm.object) || /(app|router|routes?|server)$/i.test(mm.object))
        ) {
          const hasPath = args[0].type === 'StringLiteral' || args[0].type === 'TemplateLiteral';
          const mountPath = hasPath ? readUrl(args[0]).value : null;
          const rest = hasPath ? args.slice(1) : args;
          rest.forEach((a) => {
            facts.middleware.push({
              name: middlewareName(a),
              path: mountPath,
              object: mm.object,
              // only safe options like cors origin / rate-limit max. Secrets are never copied.
              options: a.type === 'CallExpression' ? safeOptions(a.arguments[0]) : {},
              line: line(p.node),
              order: facts.middleware.length,
            });
          });
        }

        // ---------- ADDED #13: where the app connects to the database ----------
        if (mm && mm.object === 'mongoose' && (mm.property === 'connect' || mm.property === 'createConnection')) {
          facts.dbConnections.push({ client: 'mongoose', uri: valueSource(args[0]), line: line(p.node), inside });
        }
        if (mm && mm.object === 'MongoClient' && mm.property === 'connect') {
          facts.dbConnections.push({ client: 'mongodb', uri: valueSource(args[0]), line: line(p.node), inside });
        }

        // ---------- ADDED #14: React effects (code that runs after render = page-load logic) ----------
        // useEffect(() => { ... }, [deps])
        const hookName = wrapperName(callee);
        if (EFFECT_HOOKS.has(hookName)) {
          const deps = args[1];
          let runs = 'after every render';          // no second argument at all
          let depNames = [];
          if (deps && deps.type === 'ArrayExpression') {
            depNames = deps.elements.filter(Boolean).map((e) => {
              const n = handlerName(e);
              return n === '(inline)' ? '(expr)' : n;
            });
            runs = depNames.length ? 'when deps change' : 'once on mount';   // [] = once on mount
          } else if (deps) {
            runs = '(dynamic deps)';
          }
          // which functions are called inside the effect (fetch, axios.get, setUsers ...)
          const names = new Set();
          const fp = p.get('arguments.0');
          if (fp && fp.node && /Function/.test(fp.node.type)) {
            fp.traverse({
              CallExpression(cp) {
                const c = cp.node.callee;
                const mn = memberName(c);
                if (c.type === 'Identifier') names.add(c.name);
                else if (mn && mn.object && mn.property) names.add(mn.object + '.' + mn.property);
              },
            });
          }
          facts.hooks.push({
            hook: hookName,
            runs,
            deps: depNames,
            calls: Array.from(names).slice(0, 12),
            async: !!(fp && fp.node && fp.node.async),
            line: line(p.node),
            inside,
          });
        }

        // ---------- ADDED #16: axios in other shapes ----------
        // axios({ url: '/x', method: 'post' })
        if (callee.type === 'Identifier' && callee.name === 'axios' && args[0] && args[0].type === 'ObjectExpression') {
          const o = objectProps(args[0]);
          const url = readUrl(o.url);
          const method = o.method && o.method.type === 'StringLiteral' ? o.method.value.toUpperCase() : 'GET';
          facts.apiCalls.push({ client: 'axios', method, url: url.value, resolved: url.resolved, line: line(p.node), inside });
        }
        // api.get('/users')   where  const api = axios.create(...)  is in this file
        if (mm && mm.object && axiosInstances.has(mm.object) && AXIOS_METHODS.has(mm.property)) {
          const url = readUrl(args[0]);
          facts.apiCalls.push({
            client: 'axios', method: mm.property.toUpperCase(), url: url.value, resolved: url.resolved,
            line: line(p.node), inside, instance: mm.object, baseURL: axiosInstances.get(mm.object),
          });
        }
      },

      // ADDED #13: new MongoClient(uri) / new PrismaClient()
      NewExpression(p) {
        const nm = newName(p.node);
        if (nm === 'MongoClient') {
          facts.dbConnections.push({ client: 'mongodb', uri: valueSource(p.node.arguments[0]), line: line(p.node), inside: enclosingName(p) });
        } else if (nm === 'PrismaClient') {
          // Prisma reads its database url from schema.prisma, not from this code
          facts.dbConnections.push({ client: 'prisma', uri: '(set in schema.prisma)', line: line(p.node), inside: enclosingName(p) });
        }
      },

      // Every  a.b  in the code. Used for: process.env.X, req.cookies, req.session,
      // the Authorization header, and document.cookie.
      MemberExpression(p) {
        const n = p.node;

        // ---------- ADDED #12: environment variables ----------
        const env = envName(n);
        if (env) addEnv(env, n, enclosingName(p));
        // const { PORT, JWT_SECRET } = process.env;   (each name is one env var)
        if (isProcessEnv(n) && p.parent.type === 'VariableDeclarator' && p.parent.init === n && p.parent.id.type === 'ObjectPattern') {
          const ins = enclosingName(p);
          p.parent.id.properties.forEach((pr) => {
            const k = pr.key && (pr.key.name || pr.key.value);
            if (k) addEnv(String(k), n, ins);
          });
        }

        // ---------- ADDED #10: req.cookies / req.session ----------
        if (!n.computed && n.object.type === 'Identifier' && /^req(uest)?$/i.test(n.object.name) && n.property.type === 'Identifier') {
          if (n.property.name === 'cookies' || n.property.name === 'signedCookies') {
            addAuth('cookie.read', `reads req.${n.property.name}`, n, enclosingName(p), {});
          } else if (n.property.name === 'session') {
            addAuth('session.use', 'uses req.session', n, enclosingName(p), {});
          }
        }

        // ---------- ADDED #10: Authorization header ----------
        // req.headers.authorization (read)   axios.defaults.headers.common['Authorization'] = ... (set)
        const pn = !n.computed && n.property.type === 'Identifier' ? n.property.name
          : (n.computed && n.property.type === 'StringLiteral' ? n.property.value : null);
        if (pn && pn.toLowerCase() === 'authorization') {
          const isSet = p.parent.type === 'AssignmentExpression' && p.parent.left === n;
          addAuth(isSet ? 'header.authorization.set' : 'header.authorization.read',
            isSet ? 'sets the Authorization header' : 'reads the Authorization header', n, enclosingName(p), {});
        }

        // ---------- ADDED #10: document.cookie (cookies written by JavaScript can never be httpOnly) ----------
        if (!n.computed && n.object.type === 'Identifier' && n.object.name === 'document' && n.property.type === 'Identifier' && n.property.name === 'cookie') {
          const isSet = p.parent.type === 'AssignmentExpression' && p.parent.left === n;
          addAuth(isSet ? 'cookie.js-set' : 'cookie.js-read',
            isSet ? 'document.cookie is assigned (JavaScript cookies cannot be httpOnly)' : 'reads document.cookie', n, enclosingName(p), {});
        }
      },

      // ADDED #10: object keys that matter for logins on the frontend
      //   { headers: { Authorization: ... } }   { credentials: 'include' }   { withCredentials: true }
      ObjectProperty(p) {
        if (p.node.computed) return;
        const k = p.node.key;
        const name = k.type === 'Identifier' ? k.name : k.type === 'StringLiteral' ? k.value : null;
        if (!name) return;
        const v = p.node.value;
        if (name.toLowerCase() === 'authorization') {
          addAuth('header.authorization.set', 'Authorization header is set in an object', p.node, enclosingName(p), {});
        } else if (name === 'credentials' && v.type === 'StringLiteral' && v.value === 'include') {
          addAuth('credentials.include', "fetch credentials: 'include' (sends cookies to the backend)", p.node, enclosingName(p), {});
        } else if (name === 'withCredentials' && v.type === 'BooleanLiteral' && v.value) {
          addAuth('credentials.withCredentials', 'axios withCredentials: true (sends cookies to the backend)', p.node, enclosingName(p), {});
        }
      },

      // ADDED #15: React Router  <Route path="/dash" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      // Saves the page path, the page component, and any wrapper components (like ProtectedRoute).
      // Limit: paths of nested routes are stored as written (not joined with their parent path).
      JSXElement(p) {
        const el = p.node;
        if (jsxName(el) !== 'Route') return;
        const attr = (nm) => el.openingElement.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === nm);

        // path="/x"  or  path={'/x'}
        const pathAttr = attr('path');
        const pv = pathAttr && pathAttr.value
          ? (pathAttr.value.type === 'JSXExpressionContainer' ? pathAttr.value.expression : pathAttr.value)
          : null;
        const url = pv ? readUrl(pv) : { value: null, resolved: false };

        // element={<Page />}  /  component={Page}  /  <Route path="/x"><Page /></Route>
        let chain = [];
        const elAttr = attr('element') || attr('component');
        if (elAttr && elAttr.value && elAttr.value.type === 'JSXExpressionContainer') {
          const ex = elAttr.value.expression;
          if (ex.type === 'JSXElement') chain = jsxChain(ex);
          else if (ex.type === 'Identifier') chain = [ex.name];
        } else {
          const child = el.children.find((c) => c.type === 'JSXElement' && jsxName(c) !== 'Route');
          if (child) chain = jsxChain(child);
        }

        facts.clientRoutes.push({
          path: url.value,
          index: !!attr('index'),                                  // <Route index ... />
          element: chain.length ? chain[chain.length - 1] : null,  // the page component
          wrappers: chain.slice(0, -1),                            // components wrapped around it
          line: line(el),
        });
      },
    });

    // =================================================================
    // ADDED #17: THIRD WALK - integrations.
    // A file is scanned only if it imports one of INTEGRATION_PKGS.
    // We map every imported local name to its package ("Stripe" -> 'stripe'),
    // so a call is only counted when the name really comes from that package.
    // Values are never stored, only where they come from (env / hardcoded / variable).
    // =================================================================
    const localPkg = new Map();   // local name -> package name
    const pkgs = new Set();       // every package this file imports
    facts.imports.forEach((i) => {
      const b = basePkg(i.source);
      pkgs.add(b);
      i.names.forEach((nm) => localPkg.set(nm, b));
    });

    // Razorpay checkout is often loaded by a <script> tag (no import), so we also look for the word.
    if ([...pkgs].some((x) => INTEGRATION_PKGS.has(x)) || /Razorpay/.test(code)) {
      const addInt = (category, kind, detail, node, inside, meta) => {
        const key = 'int@' + kind + '@' + line(node) + '@' + detail;
        if (seen.has(key)) return;
        seen.add(key);
        facts.integrations.push({ category, kind, detail, line: line(node), inside, meta: meta || {} });
      };
      const src = valueSource; // WHERE a value comes from, never the value

      traverse(ast, {

        CallExpression(p) {
          const n = p.node;
          const { callee, arguments: args } = n;
          const inside = enclosingName(p);
          const full = calleePath(callee);
          const root = full ? full.split(/[.(]/)[0] : null;
          const last = full ? full.split('.').pop() : null;
          const rootPkg = root ? localPkg.get(root) : null;
          const o = objectProps(args[0]);

          // ----- init calls:  require('stripe')(key)   Stripe(key)   twilio(sid, token)   io(url)   multer({...}) -----
          const req = callee.type === 'CallExpression' ? requiredPkg(callee) : null;
          const initPkg = req || (callee.type === 'Identifier' ? rootPkg : null);
          if (initPkg === 'stripe') {
            addInt('Money', 'money.stripe.init', `secret key: ${src(args[0])}`, n, inside, { key: src(args[0]) });
          } else if (initPkg === 'twilio') {
            addInt('Messaging', 'sms.twilio.init', `sid: ${src(args[0])}, token: ${src(args[1])}`, n, inside, { sid: src(args[0]), token: src(args[1]) });
          } else if (initPkg === 'socket.io') {
            addInt('Live', 'live.server.init', corsText(args[1]), n, inside, {});
          } else if (initPkg === 'socket.io-client') {
            addInt('Live', 'live.client.connect', `connects to ${urlText(args[0]) || '(default: same host)'}`, n, inside, {});
          } else if (initPkg === '@stripe/stripe-js') {
            addInt('Money', 'money.stripe.client', `publishable key: ${src(args[0])}`, n, inside, { key: src(args[0]) });
          } else if (initPkg === 'multer') {
            const storage = 'storage' in o ? 'custom' : 'dest' in o ? 'disk (dest)' : 'memory (default)';
            const limits = 'limits' in o ? 'set' : 'NOT set';
            const filter = 'fileFilter' in o ? 'set' : 'NOT set';
            addInt('Files', 'files.multer.config', `storage: ${storage}, limits: ${limits}, fileFilter: ${filter}`, n, inside, { storage, limits, fileFilter: filter });
          }

          // ----- multer: storage type and upload routes -----
          if (rootPkg === 'multer' && (last === 'diskStorage' || last === 'memoryStorage')) {
            addInt('Files', 'files.multer.storage', last === 'diskStorage' ? 'saves files to disk' : 'keeps files in memory', n, inside, {});
          }
          if (pkgs.has('multer') && root && /upload|multer|parser/i.test(root) && ['single', 'array', 'fields', 'any', 'none'].includes(last)) {
            const field = args[0] && args[0].type === 'StringLiteral' ? `'${args[0].value}'` : '(multiple)';
            addInt('Files', 'files.upload', last === 'any' ? 'accepts ANY file field' : last === 'none' ? 'text fields only' : `${last}, field ${field}`, n, inside, { mode: last });
          }

          // ----- cloudinary -----
          if (pkgs.has('cloudinary') || pkgs.has('multer-storage-cloudinary')) {
            if (full && /\.uploader\.(upload|upload_stream|upload_large|destroy)$/.test(full)) {
              addInt('Files', 'files.cloudinary.' + last, `cloudinary uploader.${last}`, n, inside, {});
            }
            if (last === 'config' && root && /cloudinary/i.test(root) && args[0] && args[0].type === 'ObjectExpression') {
              addInt('Files', 'files.cloudinary.config',
                `cloud_name: ${src(o.cloud_name)}, api_key: ${src(o.api_key)}, api_secret: ${src(o.api_secret)}`, n, inside,
                { api_secret: src(o.api_secret) });
            }
          }

          // ----- stripe -----
          if (pkgs.has('stripe') && full) {
            if (/\.webhooks\.constructEvent$/.test(full)) {
              addInt('Money', 'money.stripe.webhook', 'verifies the webhook signature (constructEvent)', n, inside, {});
            } else if (/\.(checkout\.sessions|paymentIntents|setupIntents|customers|subscriptions|charges|refunds|prices|products|paymentLinks|invoices|billingPortal\.sessions)\.\w+$/.test(full)) {
              addInt('Money', 'money.stripe.call', full.replace(/^[^.]+\./, ''), n, inside, {});
            }
          }

          // ----- razorpay -----
          if (pkgs.has('razorpay') && full) {
            if (/\.(orders|payments|subscriptions|customers|refunds|invoices|paymentLink)\.\w+$/.test(full)) {
              addInt('Money', 'money.razorpay.call', full.replace(/^[^.]+\./, ''), n, inside, {});
            } else if (last === 'validatePaymentVerification' || last === 'validateWebhookSignature') {
              addInt('Money', 'money.razorpay.verify', 'checks the payment / webhook signature', n, inside, {});
            } else if (last === 'createHmac') {
              addInt('Money', 'money.razorpay.verify', 'checks a signature with HMAC (manual)', n, inside, {});
            }
          }

          // ----- nodemailer -----
          if (rootPkg === 'nodemailer' && last === 'createTransport') {
            const auth = objectProps(o.auth);
            addInt('Messaging', 'email.transport',
              `service: ${flagText(o.service)}, host: ${flagText(o.host)}, port: ${flagText(o.port)}, password: ${src(auth.pass)}`, n, inside,
              { password: src(auth.pass) });
          }
          if (pkgs.has('nodemailer') && last === 'sendMail') {
            addInt('Messaging', 'email.send', 'sends an email (sendMail)', n, inside, {});
          }

          // ----- twilio -----
          if (pkgs.has('twilio') && full) {
            if (/\.messages\.create$/.test(full)) addInt('Messaging', 'sms.twilio.send', 'sends an SMS / WhatsApp message', n, inside, {});
            else if (/\.calls\.create$/.test(full)) addInt('Messaging', 'sms.twilio.call', 'starts a phone call', n, inside, {});
            else if (/\.verify/.test(full) && (last === 'create' || last === 'check')) {
              addInt('Messaging', 'sms.twilio.verify', last === 'create' ? 'sends a verification code' : 'checks a verification code', n, inside, {});
            }
          }

          // ----- socket.io events:  socket.on('chat')   io.emit('news')   socket.to(room).emit('x') -----
          if ((pkgs.has('socket.io') || pkgs.has('socket.io-client')) && root && /^(io|socket|sock|nsp|client)/i.test(root) &&
              (last === 'on' || last === 'once' || last === 'emit')) {
            const ev = args[0] && args[0].type === 'StringLiteral' ? args[0].value : '(dynamic)';
            addInt('Live', last === 'emit' ? 'live.emit' : 'live.on', last === 'emit' ? `sends event '${ev}'` : `listens for event '${ev}'`, n, inside, { event: ev });
          }

          // ----- leaflet:  L.map('id') -----
          if (rootPkg === 'leaflet' && full === root + '.map') {
            addInt('Visual', 'visual.leaflet.map', 'creates a Leaflet map', n, inside, {});
          }

          // ----- redux toolkit / redux -----
          if (callee.type === 'Identifier' && (rootPkg === '@reduxjs/toolkit' || rootPkg === 'redux')) {
            if (last === 'configureStore') {
              const names = keyNames(o.reducer);
              addInt('State', 'state.redux.store', names.length ? `reducers: ${names.slice(0, 10).join(', ')}` : 'store created', n, inside, { reducers: names });
            } else if (last === 'createSlice') {
              const nm = o.name && o.name.type === 'StringLiteral' ? o.name.value : '(dynamic)';
              const reds = keyNames(o.reducers);
              addInt('State', 'state.redux.slice', `slice '${nm}' (${reds.length} reducers${reds.length ? ': ' + reds.slice(0, 8).join(', ') : ''})`, n, inside, { name: nm, reducers: reds });
            } else if (last === 'createAsyncThunk') {
              const t = args[0] && args[0].type === 'StringLiteral' ? args[0].value : '(dynamic)';
              addInt('State', 'state.redux.thunk', `async thunk '${t}'`, n, inside, { type: t });
            } else if (last === 'createStore') {
              addInt('State', 'state.redux.store', 'legacy createStore', n, inside, {});
            } else if (last === 'combineReducers') {
              addInt('State', 'state.redux.combine', `reducers: ${keyNames(args[0]).join(', ') || '(dynamic)'}`, n, inside, {});
            } else if (last === 'createApi') {
              const rp = o.reducerPath && o.reducerPath.type === 'StringLiteral' ? o.reducerPath.value : '(dynamic)';
              addInt('State', 'state.redux.api', `RTK Query api '${rp}'`, n, inside, { reducerPath: rp });
            } else if (last === 'fetchBaseQuery') {
              addInt('State', 'state.redux.baseQuery', `baseUrl: ${urlText(o.baseUrl) || 'not set'}`, n, inside, {});
            }
          }

          // ----- zustand:  create((set) => ...)   create()((set) => ...) -----
          const zBase = callee.type === 'CallExpression' ? callee.callee : callee;
          if (zBase.type === 'Identifier' && localPkg.get(zBase.name) === 'zustand' && (zBase.name === 'create' || zBase.name === 'createStore')) {
            addInt('State', 'state.zustand.store', 'zustand store created', n, inside, {});
          }
        },

        NewExpression(p) {
          const n = p.node;
          const inside = enclosingName(p);
          const full = calleePath(n.callee);
          if (!full) return;
          const root = full.split('.')[0];
          const last = full.split('.').pop();
          const rootPkg = localPkg.get(root);
          const args = n.arguments;
          const o = objectProps(args[0]);

          if (rootPkg === 'stripe') {
            addInt('Money', 'money.stripe.init', `secret key: ${src(args[0])}`, n, inside, { key: src(args[0]) });
          } else if (rootPkg === 'razorpay' && root !== 'window') {
            addInt('Money', 'money.razorpay.init', `key_id: ${src(o.key_id)}, key_secret: ${src(o.key_secret)}`, n, inside, { key_secret: src(o.key_secret) });
          } else if (last === 'Razorpay' && root === 'window') {
            addInt('Money', 'money.razorpay.checkout', 'opens the Razorpay checkout popup', n, inside, {});
          } else if (rootPkg === 'twilio') {
            addInt('Messaging', 'sms.twilio.init', `sid: ${src(args[0])}, token: ${src(args[1])}`, n, inside, { sid: src(args[0]), token: src(args[1]) });
          } else if (rootPkg === 'socket.io' && last === 'Server') {
            addInt('Live', 'live.server.init', corsText(args[1]), n, inside, {});
          } else if (rootPkg === 'chart.js' && last === 'Chart') {
            addInt('Visual', 'visual.chartjs.chart', `chart type: ${flagText(objectProps(args[1]).type)}`, n, inside, {});
          } else if (rootPkg === 'mapbox-gl' && last === 'Map') {
            addInt('Visual', 'visual.mapbox.map', 'creates a Mapbox map', n, inside, {});
          } else if (last === 'CloudinaryStorage' && pkgs.has('multer-storage-cloudinary')) {
            addInt('Files', 'files.cloudinary.storage', 'multer saves uploads to Cloudinary', n, inside, {});
          }
        },

        // <LineChart>, <MapContainer>, <Provider store>, <Elements> ...
        JSXElement(p) {
          const el = p.node;
          if (el.openingElement.name.type !== 'JSXIdentifier') return;
          const nm = el.openingElement.name.name;
          const pk = localPkg.get(nm);
          if (!pk) return;
          const inside = enclosingName(p);
          if (VISUAL_COMPONENTS[pk] && VISUAL_COMPONENTS[pk].has(nm)) {
            addInt('Visual', 'visual.' + pk + '.component', `<${nm}>`, el, inside, { package: pk });
          } else if (pk === 'react-redux' && nm === 'Provider') {
            addInt('State', 'state.redux.provider', 'Redux store provided to the app', el, inside, {});
          } else if (pk === '@stripe/react-stripe-js' && nm === 'Elements') {
            addInt('Money', 'money.stripe.elements', 'Stripe payment form', el, inside, {});
          }
        },
      });
    }
  } catch (err) {
    facts.error = err.message; // a bad file must never crash the whole analysis
  }
  return facts;
}

// ---------- 7. Analyze the WHOLE repo ----------
function analyzeRepo(rootDir) {
  const files = walk(rootDir).map((f) => analyzeFile(f, rootDir)); // read every readable file
  const parsed = files.filter((f) => !f.error);                    // files that were read without a hard failure
  const source = parsed.filter((f) => !f.generated);               // hand-written code only
  // adds up one kind of fact over all hand-written files, e.g. sum('routes')
  const sum = (key) => source.reduce((n, f) => n + f[key].length, 0);

  // Code in languages we cannot read yet, counted by extension (e.g. { '.py': 10 })
  const unsupported = {};
  for (const rel of listAllFiles(rootDir)) {
    const ext = path.extname(rel).toLowerCase();
    if (OTHER_CODE_EXT.has(ext)) unsupported[ext] = (unsupported[ext] || 0) + 1;
  }

  // FIXED #4: honest coverage numbers
  const unsupportedCount = Object.values(unsupported).reduce((a, b) => a + b, 0); // all unreadable-language files
  const partialFiles = parsed.filter((f) => f.parseErrors > 0);                     // read, but Babel skipped parts

  return {
    summary: {
      filesParsed: parsed.length,
      filesFailed: files.length - parsed.length,
      generatedFiles: parsed.length - source.length,
      // old number, kept so nothing else breaks. It ignores other languages and partial reads.
      coveragePercent: files.length ? Math.round((parsed.length / files.length) * 100) : 100,
      // FIXED #4: new numbers
      filesPartiallyParsed: partialFiles.length, // files where Babel had to skip some code
      unsupportedFiles: unsupportedCount,        // files in languages we cannot read (.py, .java ...)
      // honest number: only fully read files count, and unsupported-language files count against us
      sourceCoveragePercent: (files.length + unsupportedCount)
        ? Math.round(((parsed.length - partialFiles.length) / (files.length + unsupportedCount)) * 100)
        : 100,
      imports: sum('imports'),
      exports: sum('exports'),
      functions: sum('functions'),
      classes: sum('classes'),
      components: sum('components'),
      types: sum('types'),
      routes: sum('routes'),
      apiCalls: sum('apiCalls'),
      models: sum('models'),
      dbCalls: sum('dbCalls'),
      eventHandlers: sum('eventHandlers'),
      // ADDED #10-#15: counts of the new facts
      auth: sum('auth'),
      middleware: sum('middleware'),
      envVars: sum('envVars'),
      dbConnections: sum('dbConnections'),
      hooks: sum('hooks'),
      clientRoutes: sum('clientRoutes'),
      integrations: sum('integrations'),   // ADDED #17
    },
    failedFiles: files.filter((f) => f.error).map((f) => ({ path: f.path, reason: f.error })),
    // FIXED #4: which files were only partly read, and how many problems each had
    partialFiles: partialFiles.map((f) => ({ path: f.path, errors: f.parseErrors })),
    generatedPaths: parsed.filter((f) => f.generated).map((f) => f.path),
    unsupported,
    files,
  };
}

module.exports = { analyzeRepo, listAllFiles };