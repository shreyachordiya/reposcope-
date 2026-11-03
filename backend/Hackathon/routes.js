// reposcope-ignore-file
// Hackathon routes. The browser calls these; they run the analysis and send back facts + scorecard + judge questions.
const { buildFacts, publicView, shrinkReadme, CLAIMS } = require('./facts')
const { buildScorecard } = require('./scorecard')
const { extractClaims, addAiText, addJudgeQuestions } = require('./ai')
// url -> { facts (full, README text included), scorecard, questions }. Kept after the clone is deleted,
// so reopening a project never clones or calls the AI again. It lives in memory: restarting the server clears it.
const store = new Map()

async function analyzeUrl(githubUrl) {
  const port = process.env.PORT || 5000
  const r = await fetch('http://localhost:' + port + '/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ githubUrl }),
  })
  const data = await r.json()
  if (data.status === 'error') throw new Error(data.message)

  // AI step 1: which features does the README claim? If it fails, facts.js falls back to keywords.
  let aiClaims = null
  let claimsError = null
  const readme = shrinkReadme(data.readme)
  if (readme) {
    try {
      aiClaims = await extractClaims(readme.text, CLAIMS.map((c) => ({ id: c.id, label: c.label })))
    } catch (e) {
      claimsError = e.message
      console.log('[hackathon ai claims]', e.message)
    }
  }

  const facts = buildFacts(data, githubUrl, aiClaims)
  if (claimsError) facts.goal.aiError = claimsError
  const card = buildScorecard(facts)

  // AI step 2: overview, how it works, explanations, tips, ideas.
  // The marks and the list of flags are already final here, the AI only adds text to them.
  try {
    await addAiText(facts, card, readme ? readme.text : null, data.snippets)
  } catch (e) {
    card.aiError = e.message
    console.log('[hackathon ai text]', e.message)
  }

  // AI step 3: judge questions. Same run, so the Judge questions tab only has to display them.
  // If this step fails, the scorecard above still works.
  let questions = []
  let questionsError = null
  try {
    questions = await addJudgeQuestions(facts, card, readme ? readme.text : null, data.snippets)
  } catch (e) {
    questionsError = e.message
    console.log('[hackathon ai questions]', e.message)
  }

  return { facts, scorecard: card, questions, questionsError }
}

function registerHackathonRoutes(app) {
  console.log('[hackathon] routes registered')

  // Facts only (handy for checking numbers)
  app.post('/hackathon/facts', async (req, res) => {
    const githubUrl = req.body && req.body.githubUrl
    if (!githubUrl) return res.json({ status: 'error', message: 'githubUrl is required' })
    try {
      const out = await analyzeUrl(githubUrl)
      store.set(githubUrl, out)
      res.json({ status: 'success', facts: publicView(out.facts) })
    } catch (e) {
      console.log('[hackathon facts]', e.message)
      res.json({ status: 'error', message: 'Could not analyze this repo.' })
    }
  })

  // Facts + scorecard + judge questions: this is what the Scorecards and Judge questions screens use
  app.post('/hackathon/scorecard', async (req, res) => {
    const githubUrl = req.body && req.body.githubUrl
    const refresh = req.body && req.body.refresh
    if (!githubUrl) return res.json({ status: 'error', message: 'githubUrl is required' })
    try {
      let out = refresh ? null : store.get(githubUrl)
      if (!out) {
        out = await analyzeUrl(githubUrl)
        store.set(githubUrl, out)
      }
      res.json({
        status: 'success',
        facts: publicView(out.facts),
        scorecard: out.scorecard,
        questions: out.questions || [],
        questionsError: out.questionsError || null,
      })
    } catch (e) {
      console.log('[hackathon scorecard]', e.message)
      res.json({ status: 'error', message: 'Could not analyze this repo. Is the link public?' })
    }
  })
}

module.exports = { registerHackathonRoutes, store }