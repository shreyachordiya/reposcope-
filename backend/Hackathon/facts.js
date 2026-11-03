// reposcope-ignore-file
// Hackathon facts: turns one /analyze result into plain facts about a project.
// Every line here is a lookup ("does this package / file / fact exist?"). No guessing, no AI.
//
//   checks    = engineering checks (yes / partial / no / na) with evidence
//   areas     = 0-100 mark per area, made from the checks (an area with no data is left out)
//   built     = features the project built (Login, Payments ...) and the safeguards for each
//   ready     = demo readiness: can a judge run it?
//   security  = counts and the top findings from the security scanner
//   wiring    = do the frontend calls reach real backend routes?
//   goal      = README claims, each checked against the code (claims come from AI or keywords)
//   outline   = short list of what the project contains (routes, components, models, pages)

const FEATURES = [
  { id: 'db', label: 'Database', packages: ['mongoose', 'mongodb', 'pg', 'mysql2', 'sequelize', 'prisma', '@prisma/client', 'firebase', '@supabase/supabase-js'] },
  { id: 'login', label: 'Login', packages: ['jsonwebtoken', 'passport', 'bcrypt', 'bcryptjs', 'next-auth', '@clerk/clerk-react', 'express-session'] },
  { id: 'ai', label: 'AI', packages: ['openai', '@anthropic-ai/sdk', '@google/generative-ai', 'groq-sdk', '@huggingface/inference', 'langchain', '@langchain/'] },
  { id: 'realtime', label: 'Real-time', packages: ['socket.io', 'socket.io-client', 'ws'] },
  { id: 'payments', label: 'Payments', packages: ['stripe', '@stripe/stripe-js', 'razorpay', '@paypal/react-paypal-js'] },
  { id: 'maps', label: 'Maps/Charts', packages: ['leaflet', 'react-leaflet', 'mapbox-gl', '@react-google-maps/api', 'recharts', 'chart.js', 'react-chartjs-2', 'd3'] },
  { id: 'email', label: 'Email', packages: ['nodemailer', '@sendgrid/mail', 'resend'] },
]

// ---------- small helpers ----------

const toArr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : [])

const pathOf = (f) => (typeof f === 'string' ? f : (f && (f.path || f.file || f.name)) || '')

function packageNames(deps) {
  const p = deps && deps.packages
  if (Array.isArray(p)) return p.map((x) => (typeof x === 'string' ? x : x && x.name)).filter(Boolean)
  if (p && typeof p === 'object') return Object.keys(p)
  return []
}

function findPackage(names, list) {
  return names.find((n) => list.some((item) => (item.endsWith('/') ? n.startsWith(item) : n === item))) || null
}

// ---------- README ----------

// Removes things that carry no promises (comments, code blocks, badges, images).
function shrinkReadme(readme) {
  if (!readme || !readme.text) return null
  let t = readme.text
  t = t.replace(/<!--[\s\S]*?-->/g, '')
  t = t.replace(/```[\s\S]*?```/g, '[code block]')
  t = t.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  t = t.replace(/<img[^>]*>/gi, '')
  t = t.replace(/\n{3,}/g, '\n\n').trim()
  return {
    path: readme.path,
    text: t.slice(0, 30000),
    originalLength: readme.text.length,
    shortened: t.length > 30000,
  }
}

// ---------- checks ----------

const AUTH_NAME = /auth|protect|verify|jwt|token|session|login|guard|passport|admin|require/i
const PUBLIC_PATH = /login|register|signup|sign-up|signin|auth|forgot|reset|health|webhook/i
const WRITE = ['POST', 'PUT', 'PATCH', 'DELETE']

// Looks at every write route and its middleware list. This is name matching:
// it cannot see which app.use('/api/x', auth, router) guards which file.
function writeRouteAuth(facts) {
  const writes = []
  let globalAuth = false
  facts.forEach((f) => {
    toArr(f.routes).forEach((r) => {
      if (WRITE.includes(r.method)) writes.push({ ...r, file: f.path })
    })
    toArr(f.middleware).forEach((m) => {
      if (AUTH_NAME.test(String(m.name))) globalAuth = true
    })
  })
  const open = writes.filter(
    (r) => !PUBLIC_PATH.test(String(r.path || '')) && !toArr(r.middleware).some((m) => AUTH_NAME.test(String(m)))
  )
  let status = 'yes'
  if (!writes.length) status = 'na'
  else if (open.length === writes.length) status = globalAuth ? 'partial' : 'no'
  else if (open.length) status = 'partial'
  const first = open[0]
  return {
    status,
    evidence: first ? first.file + ':' + first.line + ' ' + first.method + ' ' + first.path : null,
    counts: { writes: writes.length, open: open.length },
  }
}

// Every check: { id, label, status, evidence }.  'na' = does not apply, left out of the marks.
function buildChecks(result, ctx, names) {
  const facts = toArr(result.facts && result.facts.files)
  const findings = (result.security && result.security.findings) || []
  const has = (list) => findPackage(names, list)
  const where = (f) => f.file + (f.line ? ':' + f.line : '')

  const secretFinding = findings.find(
    (f) => /secret/i.test(String(f.category || '')) && String(f.severity).toLowerCase() === 'high'
  )
  const validator = has(['joi', 'zod', 'yup', 'express-validator', 'celebrate'])
  const hasAuthSystem =
    facts.some((f) => toArr(f.auth).length > 0) ||
    !!has(['jsonwebtoken', 'passport', 'express-session', 'bcrypt', 'bcryptjs', 'next-auth', '@clerk/clerk-react'])
  const wa = hasAuthSystem
    ? writeRouteAuth(facts)
    : { status: 'na', evidence: null, counts: { writes: 0, open: 0 } }

  return [
    { id: 'auth', label: 'Auth on write routes', status: wa.status, evidence: wa.evidence, counts: wa.counts },
    {
      // A secret found always counts. "No secret" only means something when there is a server to attack.
      id: 'secrets', label: 'No secrets in code',
      status: secretFinding ? 'no' : ctx.hasBackend ? 'yes' : 'na',
      evidence: secretFinding ? where(secretFinding) : null,
    },
    {
      id: 'tests', label: 'Tests',
      status: !ctx.isApp ? 'na' : ctx.testsPath ? 'yes' : 'no',
      evidence: ctx.testsPath,
    },
    {
      id: 'envExample', label: '.env.example',
      status: !ctx.hasBackend ? 'na' : ctx.envPath ? 'yes' : 'no',
      evidence: ctx.envPath,
    },
    { id: 'readme', label: 'README', status: ctx.readmePath ? 'yes' : 'no', evidence: ctx.readmePath },
    {
      id: 'validation', label: 'Input validation',
      status: ctx.routes === 0 ? 'na' : validator ? 'yes' : 'no',
      evidence: validator,
    },
    {
      id: 'rate', label: 'Rate limiting',
      status: !names.includes('express') ? 'na' : ctx.ratePkg ? 'yes' : 'no',
      evidence: ctx.ratePkg,
    },
  ]
}

const AREA_OF = {
  auth: 'Security',
  secrets: 'Security',
  tests: 'Reliability',
  validation: 'Reliability',
  rate: 'Reliability',
  envExample: 'Code health',
  readme: 'Code health',
}

const POINTS = { yes: 100, partial: 50, no: 0 }

// Average of the checks inside each area. 'na' checks are skipped.
// An area with no applicable check is simply missing from the result.
function areaScores(checks) {
  const lists = {}
  checks.forEach((c) => {
    const area = AREA_OF[c.id]
    if (!area || !(c.status in POINTS)) return
    ;(lists[area] = lists[area] || []).push(POINTS[c.status])
  })
  const out = {}
  Object.keys(lists).forEach((a) => {
    out[a] = Math.round(lists[a].reduce((x, y) => x + y, 0) / lists[a].length)
  })
  return out
}

// ---------- built features and their safeguards ----------

const isEnv = (v) => /^env:/.test(String(v)) && !/hardcoded/.test(String(v))

// A project "built" a feature if the parser found facts for it.
// A feature that was not built is never counted against the project.
function buildBuilt(result, names) {
  const facts = toArr(result.facts && result.facts.files)
  const all = (key) => facts.flatMap((f) => toArr(f[key]).map((x) => ({ ...x, file: f.path })))
  const auth = all('auth')
  const ints = all('integrations')
  const conns = all('dbConnections')
  const findings = (result.security && result.security.findings) || []
  const at = (x) => (x ? x.file + (x.line ? ':' + x.line : '') : null)
  const ofKind = (list, re) => list.filter((x) => re.test(x.kind))
  const chk = (label, ok, ev) => ({ label, ok: !!ok, evidence: ev || null })
  const built = {}

  // Login
  const jwts = ofKind(auth, /^jwt\.sign$/)
  const hashes = ofKind(auth, /^(bcrypt\.hash|argon2\.hash)/)
  const cookies = ofKind(auth, /^cookie\.set$/)
  const sessions = ofKind(auth, /^session\.config$/)
  const passports = ofKind(auth, /^passport\./)
  if (jwts.length || hashes.length || cookies.length || sessions.length || passports.length ||
      findPackage(names, ['jsonwebtoken', 'passport', 'bcrypt', 'bcryptjs', 'express-session'])) {
    const list = [chk('Passwords hashed', hashes.length, at(hashes[0]))]
    if (jwts.length) {
      const bad = jwts.find((x) => x.meta.expiresIn === 'none')
      list.push(chk('Token has expiry', !bad, at(bad || jwts[0])))
    }
    if (cookies.length || sessions.length) {
      const bad = cookies.find((c) => c.meta.httpOnly !== 'true') ||
        sessions.find((s) => s.meta.cookie && s.meta.cookie.httpOnly === 'false')
      list.push(chk('Cookie is httpOnly', !bad, at(bad || cookies[0] || sessions[0])))
    }
    built.Login = list
  }

  // Payments
  const pay = ints.filter((x) => /^money\./.test(x.kind))
  if (pay.length) {
    const list = []
    const inits = ofKind(pay, /^money\.(stripe|razorpay)\.init$/)
    if (inits.length) {
      const bad = inits.find((x) => !isEnv(x.meta.key || x.meta.key_secret))
      list.push(chk('Secret key from env', !bad, at(bad || inits[0])))
      const verifies = ofKind(pay, /^money\.stripe\.webhook$|^money\.razorpay\.verify$/)
      list.push(chk('Payment signature checked', verifies.length, at(verifies[0])))
    }
    built.Payments = list
  }

  // Uploads
  const files = ints.filter((x) => /^files\./.test(x.kind))
  if (files.length || findPackage(names, ['multer'])) {
    const cfg = ofKind(files, /^files\.multer\.config$/)
    built.Uploads = [
      chk('Size limit set', cfg.some((c) => c.meta.limits === 'set'), at(cfg[0])),
      chk('File type filter', cfg.some((c) => c.meta.fileFilter === 'set'), at(cfg[0])),
    ]
  }

  // Database
  if (conns.length || findPackage(names, ['mongoose', 'mongodb', 'pg', 'mysql2', 'sequelize', 'prisma', '@prisma/client'])) {
    const list = []
    if (conns.length) {
      const bad = conns.find((c) => !isEnv(c.uri) && c.uri !== '(set in schema.prisma)')
      list.push(chk('URL comes from env', !bad, at(bad || conns[0])))
    }
    built.Database = list
  }

  // Real-time
  const live = ints.filter((x) => /^live\./.test(x.kind))
  if (live.length) {
    const list = []
    const srv = ofKind(live, /^live\.server\.init$/)
    if (srv.length) {
      const bad = srv.find((s) => !/^cors origin:/.test(s.detail) || /\*/.test(s.detail))
      list.push(chk('CORS origin set', !bad, at(bad || srv[0])))
    }
    built['Real-time'] = list
  }

  // AI
  if (findPackage(names, FEATURES.find((f) => f.id === 'ai').packages)) {
    const bad = findings.find((f) =>
      /browser/i.test(String(f.category)) && /ai|openai|anthropic|provider/i.test(String(f.title) + ' ' + String(f.rule)))
    built.AI = [chk('Key kept on backend', !bad, bad ? bad.file + (bad.line ? ':' + bad.line : '') : null)]
  }

  // Email
  const mail = ints.filter((x) => /^email\./.test(x.kind))
  if (mail.length) {
    const list = []
    const tr = ofKind(mail, /^email\.transport$/).filter((t) => t.meta.password !== 'none')
    if (tr.length) {
      const bad = tr.find((t) => !isEnv(t.meta.password))
      list.push(chk('Password from env', !bad, at(bad || tr[0])))
    }
    built.Email = list
  }

  return built
}

function guardedPercent(built) {
  const all = Object.values(built).flat()
  if (!all.length) return null
  return Math.round((all.filter((s) => s.ok).length / all.length) * 100)
}

// ---------- wiring: does the frontend talk to real backend routes? ----------

function segMatch(a, b) {
  const x = a.split('/').filter(Boolean)
  const y = b.split('/').filter(Boolean)
  if (x.length !== y.length) return false
  return x.every((s, i) => s === y[i] || s.startsWith(':') || y[i].startsWith(':'))
}

function cleanCallPath(url) {
  if (!url || url === '(dynamic)') return null
  const u = String(url)
  if (/^https?:\/\//.test(u) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u)) return null // third-party API
  let p = u.replace(/^https?:\/\/[^/]+/, '').replace(/^\$\{\}/, '').replace(/^env:[A-Za-z0-9_]+/, '')
  p = p.split('?')[0].replace(/\$\{\}/g, ':p')
  return p.startsWith('/') ? p : null
}

// Heuristic: route prefixes mounted with app.use('/api/x', router) are tried as well.
function buildWiring(facts) {
  const routes = []
  const mounts = []
  const calls = []
  facts.forEach((f) => {
    toArr(f.routes).forEach((r) => {
      if (typeof r.path === 'string' && r.path.startsWith('/')) routes.push(r.path)
    })
    toArr(f.middleware).forEach((m) => {
      if (typeof m.path === 'string' && m.path.startsWith('/')) mounts.push(m.path)
    })
    toArr(f.apiCalls).forEach((c) => {
      const p = cleanCallPath(c.url)
      if (p) calls.push({ path: p, file: f.path, line: c.line, method: c.method })
    })
  })
  if (!routes.length || !calls.length) return { mark: null, matched: 0, total: calls.length, unmatched: [] }
  const full = routes.slice()
  mounts.forEach((m) =>
    routes.forEach((r) => full.push((m.replace(/\/$/, '') + (r === '/' ? '' : r)) || '/'))
  )
  const unmatched = calls.filter((c) => !full.some((r) => segMatch(c.path, r)))
  const matched = calls.length - unmatched.length
  return {
    mark: Math.round((matched / calls.length) * 100),
    matched,
    total: calls.length,
    unmatched: unmatched.slice(0, 5),
  }
}

// ---------- goal: did they build what the README promises? ----------
// Claims come from the AI or from the keyword fallback below.
// Found / not detected ALWAYS comes from the code, never from the AI.

const CLAIMS = [
  { id: 'login', label: 'Login / accounts', words: /\b(log ?in|sign ?(in|up)|auth(entication|orization)?|register|accounts?|jwt)\b/i, feature: 'Login' },
  { id: 'payments', label: 'Payments', words: /\b(payments?|checkout|stripe|razorpay|subscriptions?|billing)\b/i, feature: 'Payments' },
  { id: 'realtime', label: 'Real-time', words: /\b(real[- ]?time|live (chat|updates?)|chat|websockets?|socket\.?io)\b/i, feature: 'Real-time' },
  { id: 'uploads', label: 'File uploads', words: /\b(uploads?|file upload|image upload|photos?)\b/i, feature: 'Uploads' },
  { id: 'email', label: 'Email / notifications', words: /\b(e-?mail|notifications?|newsletter|otp)\b/i, feature: 'Email' },
  { id: 'ai', label: 'AI features', words: /\b(ai|gpt|llm|chatbot|machine learning|recommendations?)\b/i, feature: 'AI' },
  { id: 'maps', label: 'Charts / maps', words: /\b(charts?|maps?|graphs?|analytics)\b/i, pkgId: 'maps' },
  { id: 'db', label: 'Saved data', words: /\b(database|persist|saved? (data|history)|stores? data)\b/i, feature: 'Database' },
]

// Fallback when the AI is unavailable: plain keyword search. Returns [{ id, quote }].
function keywordClaims(readmeText) {
  const out = []
  CLAIMS.forEach((c) => {
    const m = String(readmeText || '').match(c.words)
    if (m) out.push({ id: c.id, quote: m[0] })
  })
  return out
}

// claims = [{ id, quote }] from the AI or from keywordClaims. source = 'ai' | 'keywords'
function buildGoal(readme, built, features, claims, source) {
  if (!readme || !readme.text) {
    return { stated: false, mark: null, claims: [], note: 'No README, so there is no stated goal to check.', source: 'none' }
  }
  const list = []
  CLAIMS.forEach((c) => {
    const hit = (claims || []).find((x) => x.id === c.id)
    if (!hit) return
    let evidence = null
    if (c.feature && built[c.feature]) evidence = 'built: ' + c.feature
    if (c.pkgId) {
      const f = features.find((x) => x.id === c.pkgId)
      if (f) evidence = f.evidence
    }
    list.push({ id: c.id, label: c.label, found: !!evidence, evidence, quote: hit.quote })
  })
  if (!list.length) {
    return { stated: true, mark: null, claims: [], note: 'The README has no claims this check can test.', source }
  }
  const found = list.filter((c) => c.found).length
  return { stated: true, mark: Math.round((found / list.length) * 100), claims: list, note: null, source }
}

// ---------- the facts ----------

const SEV_RANK = { high: 0, medium: 1, low: 2 }

function buildFacts(result, githubUrl, aiClaims) {
  const paths = toArr(result.allFiles).map(pathOf).filter(Boolean)
  const facts = toArr(result.facts && result.facts.files)
  const names = packageNames(result.dependencies)
  const findings = (result.security && result.security.findings) || []

  const countOf = (key) =>
    facts.reduce((n, f) => n + (f && Array.isArray(f[key]) ? f[key].length : 0), 0)
  const sev = (s) => findings.filter((f) => String(f.severity).toLowerCase() === s).length
  const pathMatch = (re) => paths.find((p) => re.test(p)) || null

  const routes = countOf('routes')
  const components = countOf('components')
  const models = countOf('models')
  // Does this project have a server / real app logic? Decides which checks apply.
  const hasBackend = routes > 0 || models > 0
  const isApp = hasBackend || components >= 3

  const stackParts = []
  if (names.includes('react')) stackParts.push('React')
  if (names.includes('next')) stackParts.push('Next.js')
  if (names.includes('vue')) stackParts.push('Vue')
  if (names.includes('express')) stackParts.push('Express')
  if (names.includes('mongoose') || names.includes('mongodb')) stackParts.push('MongoDB')

  const features = []
  FEATURES.forEach((f) => {
    const hit = findPackage(names, f.packages)
    if (hit) features.push({ id: f.id, label: f.label, evidence: 'package: ' + hit })
  })

  // The README path also comes from /analyze (it read the file before the clone was deleted).
  const readmePath = pathMatch(/^readme(\.(md|txt))?$/i) || (result.readme && result.readme.path) || null
  const envPath = pathMatch(/(^|\/)\.env\.(example|sample)$/i)
  const deployPath = pathMatch(/(^|\/)(vercel\.json|netlify\.toml|render\.yaml|railway\.json|fly\.toml|Procfile|Dockerfile|docker-compose\.ya?ml)$/i)
  const testsPath = pathMatch(/(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[jt]sx?$/i)
  const ratePkg = findPackage(names, ['express-rate-limit', 'rate-limiter-flexible', 'express-slow-down'])

  const startEntry = toArr(result.pkgScripts).find((p) => p.scripts && (p.scripts.start || p.scripts.dev))
  const ready = [
    { id: 'readme', label: 'README', ok: !!readmePath, evidence: readmePath },
    { id: 'env', label: '.env.example', ok: !!envPath, evidence: envPath },
    {
      id: 'start', label: 'Start script', ok: !!startEntry,
      evidence: startEntry ? startEntry.path + ' (' + (startEntry.scripts.start ? 'start' : 'dev') + ')' : null,
    },
    { id: 'deploy', label: 'Deploy file', ok: !!deployPath, evidence: deployPath },
    { id: 'tests', label: 'Tests', ok: !!testsPath, evidence: testsPath },
  ]

  const checks = buildChecks(result, { routes, hasBackend, isApp, readmePath, envPath, testsPath, ratePkg }, names)
  const built = buildBuilt(result, names)
  const wiring = buildWiring(facts)

  const readme = shrinkReadme(result.readme)
  const claims = Array.isArray(aiClaims) ? aiClaims : keywordClaims(readme && readme.text)
  const goal = buildGoal(readme, built, features, claims, Array.isArray(aiClaims) ? 'ai' : 'keywords')

  const areas = areaScores(checks)
  if (wiring.mark !== null) areas.Architecture = wiring.mark
  if (goal.mark !== null) areas.Goal = goal.mark

  const coverage = result.facts && result.facts.summary ? result.facts.summary.sourceCoveragePercent : null

  const topFindings = findings
    .slice()
    .sort((a, b) => (SEV_RANK[String(a.severity).toLowerCase()] ?? 3) - (SEV_RANK[String(b.severity).toLowerCase()] ?? 3))
    .slice(0, 3)
    .map((f) => ({
      title: f.title,
      severity: String(f.severity).toLowerCase(),
      file: f.file,
      line: f.line || null,
    }))

  // NEW: what the project contains, in short. Only used to tell the AI what the project does.
  const outline = {
    routes: facts.flatMap((f) => toArr(f.routes).map((r) => r.method + ' ' + r.path)).slice(0, 20),
    components: facts.flatMap((f) => toArr(f.components).map((c) => c.name)).slice(0, 20),
    models: facts.flatMap((f) => toArr(f.models).map((m) => m.name)).slice(0, 10),
    pages: facts.flatMap((f) => toArr(f.clientRoutes).map((r) => r.path)).filter(Boolean).slice(0, 15),
  }

  return {
    url: githubUrl,
    name: githubUrl.replace('https://github.com/', ''),
    stack: stackParts.join(' + ') || 'Unknown',
    confidence: typeof coverage === 'number' ? coverage : null,
    counts: { files: paths.length, routes, components, models },
    hasBackend,
    isApp,
    security: { high: sev('high'), medium: sev('medium'), low: sev('low'), top: topFindings },
    wiring,
    features,
    checks,
    areas,
    built,
    ambition: Object.keys(built).length,
    guarded: guardedPercent(built),
    outline, // NEW
    ready,
    goal,
    readme, // full text stays on the server; publicView() removes it before sending
    packages: names,
  }
}

// What the browser receives: everything except the README text and the package list.
function publicView(f) {
  const { readme, packages, ...rest } = f
  return { ...rest, readme: readme ? { path: readme.path, length: readme.originalLength } : null }
}

module.exports = { buildFacts, publicView, shrinkReadme, CLAIMS, keywordClaims }