const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// Folders never analysed (edit this list if a real source folder is being skipped)
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.svelte-kit',
  '.cache', '.turbo', 'coverage', 'out', 'vendor', 'storybook-static',
]);
const TREE_SKIP_DIRS = new Set(['node_modules', '.git']); // the file tree shows more than we analyse
const JS_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts']);
const SFC_EXT = new Set(['.vue', '.svelte']);
const OTHER_CODE_EXT = new Set([
  '.py', '.java', '.go', '.rb', '.php', '.rs', '.cs', '.cpp', '.c', '.h', '.kt', '.swift', '.dart', '.scala',
]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use']);
const DB_METHODS = new Set([
  'find', 'findOne', 'findById', 'findOneAndUpdate', 'findByIdAndUpdate',
  'findByIdAndDelete', 'create', 'insertMany', 'updateOne', 'updateMany',
  'deleteOne', 'deleteMany', 'countDocuments', 'aggregate', 'save',
]);
const WRAPPERS = new Set(['memo', 'forwardRef', 'observer']);

function isReadable(name) {
  const ext = path.extname(name).toLowerCase();
  return JS_EXT.has(ext) || SFC_EXT.has(ext);
}//get the extension of those files in lowercase and see are they in js set or anyother 

// 1. Recursively collect every readable code file
function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;//any shortcut is there then skip that one 
    const full = path.join(dir, entry.name);//go isnide folders folder 
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, found);
    } else if (isReadable(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

// Lists EVERY file (any extension) as paths like "src/components/TopBar.jsx"
function listAllFiles(dir, rootDir = dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!TREE_SKIP_DIRS.has(entry.name)) listAllFiles(full, rootDir, found);
    } else {
      found.push(path.relative(rootDir, full).split(path.sep).join('/'));
    }
  }
  return found;
}

// Minified / bundled output: named .min.js, or very long lines on average
function isGenerated(filePath, code) {
  if (/\.min\.(js|cjs|mjs)$/i.test(filePath)) return true;
  const lines = code.split('\n').length;
  return code.length > 20000 && code.length / lines > 200;
}

// .vue / .svelte: keep only the <script> parts, padded so line numbers stay correct
function extractScripts(code) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let out = '';
  let usedLines = 0;
  let lang = 'js';
  let m;
  while ((m = re.exec(code))) {
    if (/lang\s*=\s*["']?(ts|typescript)/i.test(m[1])) lang = 'ts';
    const startLine = code.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length - 1;
    out += '\n'.repeat(Math.max(0, startLine - usedLines)) + m[2];
    usedLines = startLine + m[2].split('\n').length - 1;
  }
  return { code: out, lang };
}

// Tries several parser setups (decorators, Flow) before giving up on a file
function parseCode(code, ext, forceTs) {
  const isTs = forceTs || ['.ts', '.mts', '.cts'].includes(ext);
  const sets = isTs
    ? [['typescript'], ['jsx', 'typescript'], ['typescript', 'decorators-legacy'], ['jsx', 'typescript', 'decorators-legacy']]
    : [['jsx', 'typescript'], ['jsx', 'typescript', 'decorators-legacy'], ['jsx', 'flow'], ['jsx']];
  let lastError;
  for (const plugins of sets) {
    try {
      return parser.parse(code, {
        sourceType: 'unambiguous',
        errorRecovery: true,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowImportExportEverywhere: true,
        plugins,
      });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// Read a URL/path argument: string, template string, or unresolved
function readUrl(node) {
  if (!node) return { value: null, resolved: false };
  if (node.type === 'StringLiteral') return { value: node.value, resolved: true };
  if (node.type === 'TemplateLiteral') {
    const text = node.quasis.map((q) => q.value.raw).join('${}');
    return { value: text, resolved: node.expressions.length === 0 };
  }
  return { value: '(dynamic)', resolved: false };
}

function memberName(node) {
  if (node.type !== 'MemberExpression' || node.computed) return null;
  const object = node.object.type === 'Identifier' ? node.object.name : null;
  const property = node.property.type === 'Identifier' ? node.property.name : null;
  return { object, property };
}

// router.route('/x').get(a).post(b): walks down the chain to find '/x'
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

function wrapperName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
}

function containsJSX(fnPath) {
  let found = false;
  fnPath.traverse({
    JSXElement(p) { found = true; p.stop(); },
    JSXFragment(p) { found = true; p.stop(); },
  });
  return found;
}

// 2. Parse one file and collect its facts
function analyzeFile(filePath, rootDir) {
  const rel = path.relative(rootDir, filePath).split(path.sep).join('/');
  const facts = {
    path: rel, size: 0, generated: false,
    imports: [], exports: [], functions: [], classes: [], components: [], types: [],
    routes: [], apiCalls: [], models: [], dbCalls: [], eventHandlers: [],
    error: null,
  };

  try {
    const stat = fs.statSync(filePath);
    facts.size = stat.size;
    if (stat.size > MAX_FILE_SIZE) {
      facts.error = `skipped: file is ${(stat.size / 1048576).toFixed(1)} MB (limit ${MAX_FILE_SIZE / 1048576} MB)`;
      return facts;
    }

    let code = fs.readFileSync(filePath, 'utf8');
    if (code.charCodeAt(0) === 0xfeff) code = code.slice(1); // strip BOM
    const ext = path.extname(filePath).toLowerCase();

    let forceTs = false;
    if (SFC_EXT.has(ext)) {
      const s = extractScripts(code);
      code = s.code;
      forceTs = s.lang === 'ts';
      facts.components.push({ name: path.basename(filePath, ext), line: 1 });
    }

    facts.generated = isGenerated(filePath, code);
    if (!code.trim()) return facts;

    const ast = parseCode(code, ext, forceTs);
    const line = (n) => (n.loc ? n.loc.start.line : null);
    const routerNames = new Set(); // variables created by express() / Router()

    const recordFunction = (name, fnPath, node) => {
      facts.functions.push({ name, line: line(node) });
      if (/^[A-Z]/.test(name) && containsJSX(fnPath)) {
        facts.components.push({ name, line: line(node) });
      }
    };

    traverse(ast, {
      ImportDeclaration(p) {
        facts.imports.push({
          source: p.node.source.value,
          kind: 'import',
          names: p.node.specifiers.map((s) => s.local.name),
          typeOnly: p.node.importKind === 'type',
          line: line(p.node),
        });
      },

      TSImportEqualsDeclaration(p) {
        const ref = p.node.moduleReference;
        if (ref.type === 'TSExternalModuleReference') {
          facts.imports.push({ source: ref.expression.value, kind: 'require', names: [p.node.id.name], typeOnly: false, line: line(p.node) });
        }
      },

      ExportNamedDeclaration(p) {
        const n = p.node;
        if (n.source) {
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

      ExportAllDeclaration(p) {
        facts.imports.push({ source: p.node.source.value, kind: 'reexport', names: ['*'], typeOnly: p.node.exportKind === 'type', line: line(p.node) });
      },

      ExportDefaultDeclaration(p) {
        const d = p.node.declaration;
        facts.exports.push({ name: (d && d.id && d.id.name) || (d && d.name) || '(anonymous)', default: true });
      },

      AssignmentExpression(p) {
        const l = p.node.left;
        if (l.type !== 'MemberExpression') return;
        const isModExports = (n) =>
          n.type === 'MemberExpression' && n.object.name === 'module' && n.property.name === 'exports';
        if (isModExports(l)) {
          facts.exports.push({ name: p.node.right.name || '(module.exports)', default: true });
        } else if (
          (isModExports(l.object) || (l.object.type === 'Identifier' && l.object.name === 'exports')) &&
          l.property.name
        ) {
          facts.exports.push({ name: l.property.name, default: false });
        }
      },

      FunctionDeclaration(p) {
        if (p.node.id) recordFunction(p.node.id.name, p, p.node);
      },

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

      TSInterfaceDeclaration(p) { facts.types.push({ name: p.node.id.name, kind: 'interface', line: line(p.node) }); },
      TSTypeAliasDeclaration(p) { facts.types.push({ name: p.node.id.name, kind: 'type', line: line(p.node) }); },
      TSEnumDeclaration(p) { facts.types.push({ name: p.node.id.name, kind: 'enum', line: line(p.node) }); },

      VariableDeclarator(p) {
        const { id, init } = p.node;
        if (id.type !== 'Identifier' || !init) return;
        if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
          recordFunction(id.name, p.get('init'), p.node);
          return;
        }
        if (init.type === 'CallExpression') {
          const c = init.callee;
          if (
            (c.type === 'Identifier' && (c.name === 'express' || c.name === 'Router')) ||
            (c.type === 'MemberExpression' && c.property.name === 'Router')
          ) {
            routerNames.add(id.name);
          }
          const w = wrapperName(c);
          if (WRAPPERS.has(w) && init.arguments[0] && /Function/.test(init.arguments[0].type)) {
            recordFunction(id.name, p.get('init.arguments.0'), p.node);
          }
        }
      },

      CallExpression(p) {
        const { callee, arguments: args } = p.node;

        // require('x')
        if (callee.type === 'Identifier' && callee.name === 'require' && args[0] && args[0].type === 'StringLiteral') {
          facts.imports.push({ source: args[0].value, kind: 'require', names: [], typeOnly: false, line: line(p.node) });
          return;
        }
        // import('x')
        if (callee.type === 'Import' && args[0] && args[0].type === 'StringLiteral') {
          facts.imports.push({ source: args[0].value, kind: 'dynamic', names: [], typeOnly: false, line: line(p.node) });
          return;
        }
        // fetch(url, { method })
        if (callee.type === 'Identifier' && callee.name === 'fetch') {
          const url = readUrl(args[0]);
          let method = 'GET';
          const opts = args[1];
          if (opts && opts.type === 'ObjectExpression') {
            const m = opts.properties.find((x) => x.key && x.key.name === 'method');
            if (m && m.value.type === 'StringLiteral') method = m.value.value.toUpperCase();
          }
          facts.apiCalls.push({ client: 'fetch', method, url: url.value, resolved: url.resolved, line: line(p.node) });
          return;
        }
        // model('Name', schema) after destructuring: const { model } = require('mongoose')
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
          facts.dbCalls.push({ model: callee.object.property.name, method: callee.property.name, client: 'prisma', line: line(p.node) });
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
              handler: last && last.type === 'Identifier' ? last.name : '(inline)',
              line: line(p.node),
            });
            return;
          }
        }
        const m = memberName(callee);
        if (!m || !m.property) return;

        // axios.get(url)
        if (m.object === 'axios' && HTTP_METHODS.has(m.property)) {
          const url = readUrl(args[0]);
          facts.apiCalls.push({ client: 'axios', method: m.property.toUpperCase(), url: url.value, resolved: url.resolved, line: line(p.node) });
          return;
        }
        // mongoose.model('Name', schema)
        if (m.object === 'mongoose' && m.property === 'model' && args[0] && args[0].type === 'StringLiteral') {
          facts.models.push({ name: args[0].value, line: line(p.node) });
          return;
        }
        // app.get('/x', handler) / router.post(...)
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
            handler: last && last.type === 'Identifier' ? last.name : '(inline)',
            line: line(p.node),
          });
          return;
        }
        // User.find(), user.save() -> Capitalized object = likely a Mongoose model
        if (DB_METHODS.has(m.property) && m.object && /^[A-Z]/.test(m.object)) {
          facts.dbCalls.push({ model: m.object, method: m.property, client: 'mongoose', line: line(p.node) });
        }
      },

      JSXAttribute(p) {
        const name = p.node.name.name;
        if (typeof name !== 'string' || !/^on[A-Z]/.test(name)) return;
        const v = p.node.value;
        if (v && v.type === 'JSXExpressionContainer') {
          const e = v.expression;
          facts.eventHandlers.push({ event: name, handler: e.type === 'Identifier' ? e.name : '(inline)', line: line(p.node) });
        }
      },
    });
  } catch (err) {
    facts.error = err.message; // a bad file must never crash the whole analysis
  }
  return facts;
}

// 3. Run over the whole repo
function analyzeRepo(rootDir) {
  const files = walk(rootDir).map((f) => analyzeFile(f, rootDir));
  const parsed = files.filter((f) => !f.error);
  const source = parsed.filter((f) => !f.generated); // hand-written code only
  const sum = (key) => source.reduce((n, f) => n + f[key].length, 0);

  // code in languages we can't read yet, counted by extension
  const unsupported = {};
  for (const rel of listAllFiles(rootDir)) {
    const ext = path.extname(rel).toLowerCase();
    if (OTHER_CODE_EXT.has(ext)) unsupported[ext] = (unsupported[ext] || 0) + 1;
  }

  return {
    summary: {
      filesParsed: parsed.length,
      filesFailed: files.length - parsed.length,
      generatedFiles: parsed.length - source.length,
      coveragePercent: files.length ? Math.round((parsed.length / files.length) * 100) : 100,
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
    },
    failedFiles: files.filter((f) => f.error).map((f) => ({ path: f.path, reason: f.error })),
    generatedPaths: parsed.filter((f) => f.generated).map((f) => f.path),
    unsupported,
    files,
  };
}

module.exports = { analyzeRepo, listAllFiles };