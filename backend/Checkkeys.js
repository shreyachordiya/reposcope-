// reposcope-ignore-file
// Run from the backend folder:  node checkKeys.js
// Sends one tiny request per key per model and prints OK or the reason it failed.
// It never prints a key. It only says whether two names hold the same key.
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '.env') })

const GROQ = 'https://api.groq.com/openai/v1/chat/completions'
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean)
const DEFAULT_MODELS = 'openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b'

// label, env name of the key, env name of the models (change GROQ_API_KEY if Repo mode uses another name)
const KEYS = [
  { label: 'Repo mode', keyEnv: 'GROQ_API_KEY', modelsEnv: 'GROQ_MODELS' },
  { label: 'Hackathon (claims + scorecard text)', keyEnv: 'HACKATHON_GROQ_KEY', modelsEnv: 'HACKATHON_GROQ_MODELS' },
  { label: 'Judge questions', keyEnv: 'JUDGE_QUESTIONS_KEY', modelsEnv: 'JUDGE_QUESTIONS_MODELS' },
]

const REASON = {
  400: 'bad request (check the model name)',
  401: 'key is wrong or was deleted',
  403: 'key is not allowed to use this model',
  404: 'model name does not exist',
  429: 'rate limit reached right now',
}

async function tryModel(key, model) {
  const started = Date.now()
  try {
    const r = await fetch(GROQ, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        max_tokens: 30,
        messages: [{ role: 'user', content: 'Reply with the word OK.' }],
      }),
      signal: AbortSignal.timeout(30000),
    })
    const ms = Date.now() - started
    if (r.ok) {
      const left = r.headers.get('x-ratelimit-remaining-requests')
      return '  OK     ' + model + '  (' + ms + ' ms' + (left ? ', ' + left + ' requests left today' : '') + ')'
    }
    return '  FAILED ' + model + '  ' + r.status + ' ' + (REASON[r.status] || 'unknown reason')
  } catch (e) {
    return '  FAILED ' + model + '  ' + e.message
  }
}

;(async () => {
  const seen = {}
  for (const k of KEYS) {
    const key = process.env[k.keyEnv]
    console.log('\n' + k.label + '  [' + k.keyEnv + ']')
    if (!key) {
      console.log('  no key found in .env under this name')
      continue
    }
    if (seen[key]) console.log('  note: this is the SAME key as ' + seen[key] + ', so they share one limit')
    else seen[key] = k.keyEnv
    const models = list(process.env[k.modelsEnv] || DEFAULT_MODELS)
    for (const m of models) console.log(await tryModel(key, m))
  }
  console.log('\nDone. Different keys from the same Groq account still share one limit.')
})()