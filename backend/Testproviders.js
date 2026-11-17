// testproviders.js - sends one tiny chat request to every provider in providers.js,
// the same way llm.js does, and prints what happened.
// Run from the backend folder:  node testproviders.js
// Never prints a key. Needs Node 18+.

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '.env') })
const { PROVIDERS } = require('./providers')

async function main() {
  console.log('\nTesting ' + PROVIDERS.length + ' providers from providers.js\n')

  for (const p of PROVIDERS) {
    const label = p.name.padEnd(14)
    const key = process.env[p.keyEnv]

    if (!key) { console.log('  SKIP  ' + label + p.keyEnv + ' is missing in .env'); continue }
    if (p.model.startsWith('PASTE_')) { console.log('  SKIP  ' + label + 'model not filled in'); continue }

    const started = Date.now()
    try {
      const res = await fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: p.model, messages: [{ role: 'user', content: 'Reply with the single word OK' }] }),
        signal: AbortSignal.timeout(p.timeoutMs || 20000),
      })
      const ms = Date.now() - started

      if (res.ok) {
        const data = await res.json()
        const text = data.choices?.[0]?.message?.content
        console.log((text ? '  OK    ' : '  EMPTY ') + label + ms + ' ms  model: ' + p.model)
      } else {
        const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 160)
        let hint = ''
        if (res.status === 401 || res.status === 403) hint = '  -> key rejected'
        else if (res.status === 404 || res.status === 400) hint = '  -> model name probably wrong'
        else if (res.status === 429) hint = '  -> rate limited, wait a minute'
        console.log('  FAIL  ' + label + 'status ' + res.status + hint + '\n          ' + body)
      }
    } catch (e) {
      console.log('  FAIL  ' + label + (e.name === 'TimeoutError' ? 'too slow (timeout)' : e.message))
    }
  }
  console.log('\nIf at least one says OK, Ask RepoScope can work. Make the same variables exist on Render.\n')
}

main()