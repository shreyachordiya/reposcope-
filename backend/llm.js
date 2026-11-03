require('dotenv').config();
const { PROVIDERS } = require('./Providers');

const cooldown = {}; // provider name -> time we may try it again

async function askLLM(messages) {
  for (const p of PROVIDERS) {
    const key = process.env[p.keyEnv];
    if (!key) continue;                                   // no key, skip
    if (p.model.startsWith('PASTE_')) continue;           // model not filled in yet, skip
    if (cooldown[p.name] && cooldown[p.name] > Date.now()) continue; // resting, skip

    const started = Date.now();
    try {
      const res = await fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: p.model, messages }),
        signal: AbortSignal.timeout(p.timeoutMs || 20000),
      });

      if (!res.ok) {
        // rate limit or overloaded: rest this model for a minute
        if (res.status === 429 || res.status >= 500) cooldown[p.name] = Date.now() + 60000;
        console.log(`[llm] ${p.name} failed with ${res.status}, trying next`);
        continue;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) {
        console.log(`[llm] ${p.name} gave an empty answer, trying next`);
        continue;
      }

      console.log(`[llm] ${p.name} answered in ${Date.now() - started} ms`);
      return { text, provider: p.name };
    } catch (err) {
      const slow = err.name === 'TimeoutError';
      if (slow) cooldown[p.name] = Date.now() + 30000;    // too slow: rest it for 30 seconds
      console.log(`[llm] ${p.name} ${slow ? 'was too slow' : 'error: ' + err.message}, trying next`);
    }
  }
  throw new Error('All free providers failed or hit their limit. Try again in a minute.');
}

module.exports = { askLLM };