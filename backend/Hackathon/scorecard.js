// reposcope-ignore-file
// Hackathon scorecard: turns the facts of one project into strengths, weaknesses and next steps.
// Rules only. The AI (ai.js) later adds text to these items, it never adds or removes items.

const SEV = { high: 0, medium: 1, low: 2 }
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

// One entry per check: what to say when it fails, how bad it is, why it matters, how to fix it.
const T = {
  auth: {
    text: { no: 'No auth on write routes', partial: 'Some write routes have no auth' },
    sev: { no: 'high', partial: 'medium' },
    why: 'Anyone could change data without logging in.',
    fix: 'Add auth middleware to the write routes (POST, PUT, PATCH, DELETE).',
  },
  secrets: {
    text: { no: 'Secret found in code' },
    sev: { no: 'high' },
    why: 'Anyone with access to the repo can use it.',
    fix: 'Rotate the key and move it to a .env file.',
  },
  tests: {
    text: { no: 'No tests found' },
    sev: { no: 'medium' },
    why: 'Changes cannot be checked automatically.',
    fix: 'Add tests for the main routes.',
  },
  validation: {
    text: { no: 'No input validation library' },
    sev: { no: 'medium' },
    why: 'Bad or malicious input may reach the database.',
    fix: 'Validate request bodies with zod, joi or express-validator.',
  },
  rate: {
    text: { no: 'No rate limiting' },
    sev: { no: 'medium' },
    why: 'Anyone can send unlimited requests, for example to guess passwords.',
    fix: 'Add express-rate-limit, at least on login.',
  },
  envExample: {
    text: { no: 'No .env.example file' },
    sev: { no: 'low' },
    why: 'A judge cannot see which settings are needed to run it.',
    fix: 'Add a .env.example with the variable names (no values).',
  },
  readme: {
    text: { no: 'No README' },
    sev: { no: 'medium' },
    why: 'A judge cannot tell what the project does.',
    fix: 'Add a README with what it does and how to run it.',
  },
}

const GOOD = {
  auth: 'Write routes are protected by auth',
  secrets: 'No secrets found in the code',
  tests: 'Tests exist',
  validation: 'Input validation library in use',
  rate: 'Rate limiting in place',
  envExample: '.env.example is provided',
  readme: 'README is present',
}

function buildScorecard(f) {
  const strengths = []
  const weaknesses = []
  const secretsFailed = (f.checks.find((c) => c.id === 'secrets') || {}).status === 'no'

  // ----- from the checks -----
  f.checks.forEach((c) => {
    if (c.status === 'yes' && GOOD[c.id]) {
      strengths.push({ text: GOOD[c.id], evidence: c.evidence })
    }
    const t = T[c.id]
    if (t && (c.status === 'no' || c.status === 'partial')) {
      weaknesses.push({
        text: t.text[c.status] || t.text.no,
        evidence: c.evidence,
        why: t.why,
        fix: t.fix,
        severity: t.sev[c.status] || t.sev.no,
      })
    }
  })

  // ----- from the safeguards of built features -----
  Object.keys(f.built).forEach((feature) => {
    f.built[feature].forEach((s) => {
      if (s.ok) {
        strengths.push({ text: feature + ': ' + s.label, evidence: s.evidence })
      } else {
        weaknesses.push({
          text: feature + ': ' + s.label + ' not detected',
          evidence: s.evidence,
          why: 'This safeguard was not found in the code.',
          fix: 'Add it: ' + s.label.toLowerCase() + '.',
          severity: 'medium',
        })
      }
    })
  })

  // ----- from the README claims -----
  if (f.goal && f.goal.stated) {
    f.goal.claims.filter((c) => !c.found).forEach((c) => {
      weaknesses.push({
        text: 'README claims ' + c.label,
        evidence: c.quote ? 'README: "' + c.quote + '"' : null,
        why: 'The README promises something the code does not show.',
        fix: 'Build it, or remove the claim from the README.',
        severity: 'medium',
      })
    })
  }

  // ----- from the wiring (frontend calls vs backend routes) -----
  const w = f.wiring
  if (w && w.total >= 3 && w.mark >= 80) {
    strengths.push({ text: w.matched + ' of ' + w.total + ' frontend calls reach real routes', evidence: null })
  }
  if (w && w.total > 0 && w.unmatched.length) {
    const u = w.unmatched[0]
    weaknesses.push({
      text: w.unmatched.length + ' frontend call' + (w.unmatched.length === 1 ? '' : 's') + ' reach no route',
      evidence: u.file + ':' + u.line + ' ' + u.method + ' ' + u.path,
      why: 'Parts of the app may not work.',
      fix: 'Fix the URL or add the missing route.',
      severity: w.mark < 50 ? 'high' : 'medium',
    })
  }

  // ----- from the security scanner (high and medium only) -----
  ;(f.security.top || []).forEach((s) => {
    if (s.severity !== 'high' && s.severity !== 'medium') return
    if (secretsFailed && /secret|key|token|password/i.test(String(s.title))) return // already listed above
    const isVuln = /known vulnerabilit/i.test(String(s.title)) // CHANGED: real text for vulnerable packages
    weaknesses.push({
      text: s.title,
      evidence: s.file ? s.file + (s.line ? ':' + s.line : '') : null,
      why: isVuln
        ? 'This version of the package has publicly known security problems.'
        : 'Reported by the security scanner.',
      fix: isVuln
        ? 'Upgrade this package to a patched version (try npm audit fix).'
        : 'Review this finding and fix it.',
      severity: s.severity,
    })
  })

  weaknesses.sort((a, b) => (SEV[a.severity] ?? 3) - (SEV[b.severity] ?? 3))

  // Next steps: the biggest problems first, each with its fix.
  const improvements = weaknesses.slice(0, 5).map((x) => ({
    priority: cap(x.severity),
    text: x.fix,
    about: x.text,
  }))

  return { strengths: strengths.slice(0, 8), weaknesses, improvements }
}

module.exports = { buildScorecard }