const GROQ = 'https://api.groq.com/openai/v1/chat/completions';

const PROVIDERS = [
  { name: 'groq-120b',  url: GROQ, model: 'openai/gpt-oss-120b', keyEnv: 'GROQ_API_KEY',   timeoutMs: 20000 },
  { name: 'groq-qwen',  url: GROQ, model: 'qwen/qwen3.8-27b',    keyEnv: 'GROQ_API_KEY',   timeoutMs: 20000 },
  { name: 'groq-20b',   url: GROQ, model: 'openai/gpt-oss-20b',  keyEnv: 'GROQ_API_KEY',   timeoutMs: 15000 },
 
 { name: 'gemini-flash', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  model: 'gemini-3.5-flash', keyEnv: 'GEMINI_API_KEY', timeoutMs: 25000 },
{ name: 'gemini-lite', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  model: 'gemini-3.5-flash-lite', keyEnv: 'GEMINI_API_KEY', timeoutMs: 20000 },
]
module.exports = { PROVIDERS }