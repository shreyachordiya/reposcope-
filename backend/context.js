// context.js -- picks the facts + code the AI gets for ONE question.
// No AI in here: only string matching on facts the parser already collected.

const MAX_CONTEXT = 14000;   // characters sent to the AI in total
const MAX_FILE_CODE = 8000;  // a file this small is sent as full code
const MAX_FN_LINES = 200;    // longest function snippet

const STOP = new Set([
  'what', 'does', 'how', 'the', 'this', 'that', 'work', 'works', 'repo', 'repository',
  'file', 'files', 'code', 'explain', 'and', 'for', 'with', 'from', 'are', 'can', 'you',
  'why', 'where', 'which', 'who', 'about', 'tell', 'show', 'use', 'used', 'uses', 'into',
  'have', 'has', 'get', 'gets', 'our', 'its', 'there', 'when', 'then', 'happens', 'happen',
]);

const SEC_WORDS = /secur|secret|vulnerab|insecure|unsafe|\bxss\b|inject|\bcors\b|helmet|csrf|password|token|api.?key|exploit|attack|hardcod/i;

// ---------- finding things in the question ----------

// "src/App.jsx" or just "App.jsx"
function findFile(question, paths) {
  const q = question.toLowerCase();
  return paths.find((p) => q.includes(p.toLowerCase()))
      || paths.find((p) => q.includes(p.split('/').pop().toLowerCase()))
      || null;
}

// a function named in the question (short lowercase names are ignored: too many false matches)
function findFunction(question, files) {
  for (const f of files) {
    for (const fn of f.functions) {
      if (fn.name.length < 5 && !/[A-Z_]/.test(fn.name)) continue;
      const safe = fn.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp('\\b' + safe + '\\b').test(question)) return { file: f, fn };
    }
  }
  return null;
}

// important words of the question
function words(question) {
  const all = question.toLowerCase().match(/[a-z0-9_]{3,}/g) || [];
  return [...new Set(all)].filter((w) => !STOP.has(w));
}

// give every file a score for this question, return the best ones
function rankFiles(question, files, limit = 4) {
  const ws = words(question);
  if (!ws.length) return [];
  const scored = files.map((f) => {
    const p = f.path.toLowerCase();
    const base = p.split('/').pop();
    let score = 0;
    for (const w of ws) {
      if (p.includes(w)) score += 5;
      if (base.includes(w)) score += 2;
      if (w.length >= 4) {
        score += Math.min(3, f.functions.filter((x) => x.name.toLowerCase().includes(w)).length) * 3;
        score += Math.min(2, f.components.filter((x) => x.name.toLowerCase().includes(w)).length) * 3;
        score += Math.min(2, f.routes.filter((r) => (r.path || '').toLowerCase().includes(w)).length) * 3;
        score += Math.min(2, f.exports.filter((x) => x.name.toLowerCase().includes(w)).length) * 2;
        score += f.imports.some((i) => i.source.toLowerCase().includes(w)) ? 1 : 0;
      }
    }
    return { f, score };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.f);
}

// ---------- code helpers ----------

// the parser knows where a function STARTS, not where it ends.
// We count { and } in the source text to find the end. Limits: braces inside
// regex literals or multi-line comments can fool it, so it is capped at MAX_FN_LINES.
function functionEnd(code, startLine) {
  const lines = code.split('\n');
  let depth = 0;
  let opened = false;
  const limit = Math.min(lines.length, startLine - 1 + MAX_FN_LINES);
  for (let i = startLine - 1; i < limit; i++) {
    let text = lines[i].replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '').replace(/\/\/.*$/, '');
    if (i === startLine - 1) text = text.replace(/\([^()]*\)/g, ''); // ignore ({a, b}) in parameters
    for (const ch of text) {
      if (ch === '{') { depth++; opened = true; }
      else if (ch === '}') depth--;
    }
    if (opened && depth <= 0) return i + 1;
    if (!opened && i - (startLine - 1) >= 3) break;   // no body found, probably a one-liner
  }
  return Math.min(lines.length, startLine - 1 + (opened ? MAX_FN_LINES : 30));
}

// code with line numbers, so the AI can say "line 342"
function numbered(code, from, to) {
  return code.split('\n').slice(from - 1, to).map((l, i) => `${from + i}: ${l}`).join('\n');
}

// small summary of ONE file, built only from parser facts
function fileCard(f, dependencies) {
  const imp = [...new Set(f.imports.map((i) => i.source))].join(', ') || 'none';
  const exp = f.exports.map((e) => e.name).join(', ') || 'none';
  const fns = f.functions.slice(0, 60).map((x) => `${x.name} (line ${x.line})`).join(', ') || 'none';
  const lines = [`FILE: ${f.path}`, `Imports: ${imp}`, `Exports: ${exp}`, `Functions: ${fns}`];
  if (f.components.length) lines.push('Components: ' + f.components.map((c) => c.name).join(', '));
  if (f.routes.length) {
    lines.push('Routes: ' + f.routes.map((r) => `${r.method} ${r.path} -> ${r.handler} (line ${r.line})`).join('; '));
  }
  const usedBy = importedBy(f.path, dependencies);
  if (usedBy.length) lines.push('Imported by: ' + usedBy.slice(0, 10).join(', '));
  return lines.join('\n');
}

// who imports this file? (reads dependencies.nodes defensively, the shape may be an object or an array)
function importedBy(filePath, dependencies) {
  try {
    const nodes = dependencies && dependencies.nodes;
    if (!nodes) return [];
    const node = Array.isArray(nodes)
      ? nodes.find((n) => n.path === filePath || n.id === filePath || n.file === filePath)
      : nodes[filePath];
    return (node && node.usedBy) || [];
  } catch (e) { return []; }
}

// ---------- security ----------

function securityBlock(security, onlyFile) {
  const list = Array.isArray(security) ? security : (security && security.findings) || [];
  console.log('[ctx] security keys:', Object.keys(security || {}), '| findings:', list.length);
  const header = 'SECURITY FINDINGS (from the analyzer, pattern matching only. "No findings" never means "secure"):';
  if (!list.length) return header + '\nThe analyzer reported no findings.';

  const rank = { high: 0, medium: 1, low: 2 };
  let use = onlyFile ? list.filter((x) => x.file === onlyFile) : list;
  if (!use.length) use = list;
  use = [...use].sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3)).slice(0, 12);

  const cut = (s, n) => (s && s.length > n ? s.slice(0, n) + '...' : s || '');
  return header + ` (${list.length} total, showing ${use.length})\n` + use.map((x) =>
    `[${String(x.severity).toUpperCase()}] ${x.title} - ${x.file}:${x.line} (confidence: ${x.confidence})\n` +
    `   evidence: ${cut(x.evidence, 120)}\n   why: ${cut(x.why, 160)}\n   fix: ${cut(x.fix, 160)}`
  ).join('\n');
}

// ---------- main ----------

function buildContext(question, data) {
  const { facts, sources, security, dependencies } = data;
  const files = facts.files.filter((f) => !f.error && !f.generated);
  const s = facts.summary;
  const parts = [`REPO OVERVIEW: ${s.filesParsed} files read, ${s.functions} functions, ${s.routes} routes, ${s.components} components.`];

  const filePath = findFile(question, Object.keys(sources));
  const file = filePath ? files.find((f) => f.path === filePath) : null;
  const hit = findFunction(question, file ? [file] : files);

  if (hit && sources[hit.file.path]) {
    // a function was named: file card + that function's code (real end found)
    const code = sources[hit.file.path];
    const from = hit.fn.line;
    const to = functionEnd(code, from);
    parts.push(fileCard(hit.file, dependencies));
    parts.push(`CODE of ${hit.fn.name} (${hit.file.path}, lines ${from}-${to}):\n` + numbered(code, from, to));
  } else if (file) {
    // a file was named: card, plus full code when it is small
    parts.push(fileCard(file, dependencies));
    const code = sources[file.path];
    if (code && code.length <= MAX_FILE_CODE) {
      parts.push(`CODE of ${file.path}:\n` + numbered(code, 1, code.split('\n').length));
    } else {
      parts.push('(File is large, so only its summary card is shown. Ask about one function to see its code.)');
    }
  } else {
    // nothing named: find the files that match the words of the question
    const ranked = rankFiles(question, files);
    if (ranked.length) {
      ranked.forEach((f) => parts.push(fileCard(f, dependencies)));
      const top = sources[ranked[0].path];
      if (top && top.length <= MAX_FILE_CODE) {
        parts.push(`CODE of ${ranked[0].path}:\n` + numbered(top, 1, top.split('\n').length));
      }
    } else {
      parts.push('FILES:\n' + files.slice(0, 80).map((f) => f.path).join('\n'));
    }
  }

  // security questions also get the analyzer's findings
  if (SEC_WORDS.test(question)) parts.push(securityBlock(security, filePath));

  const out = parts.join('\n\n');
  return out.length > MAX_CONTEXT ? out.slice(0, MAX_CONTEXT) + '\n...(cut to fit the size limit)' : out;
}

module.exports = { buildContext };