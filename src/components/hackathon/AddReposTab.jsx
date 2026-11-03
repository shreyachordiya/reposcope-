import { useState } from 'react'
import './AddReposTab.css'

function parseUrls(text) {
  const valid = []
  const invalid = []
  const seen = new Set()

  text.split('\n').forEach((line) => {
    const raw = line.trim()
    if (raw === '') return

    let url = raw
    if (!url.startsWith('http')) url = 'https://' + url
    url = url.replace(/\/+$/, '').replace(/\.git$/, '')

    const looksRight = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(url)
    if (!looksRight) {
      invalid.push(raw)
      return
    }

    const key = url.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    valid.push(url)
  })

  return { valid, invalid }
}

function AddReposTab({ onStart }) {
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')

  const { valid, invalid } = parseUrls(text)

  function handleStart() {
    if (valid.length === 0) {
      setMessage('Add at least one GitHub repo link first.')
      return
    }
    setMessage('')
    onStart(valid)
  }

  return (
    <div className="hk-add">
      <h2 className="hk-add-title">Add repos</h2>
      <p className="hk-add-help">
        Paste GitHub repo links, one per line. Add as many as you want.
      </p>

      <textarea
        className="hk-add-box"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'github.com/team-a/smartfarm\ngithub.com/team-b/medbuddy'}
      />

      <div className="hk-add-footer">
        <span className="hk-add-count">
          {valid.length} valid
          {invalid.length > 0 && <span className="hk-add-bad"> · {invalid.length} not a GitHub repo link</span>}
        </span>
        <button className="hk-add-btn" onClick={handleStart}>Analyze all</button>
      </div>

      {message && <p className="hk-add-bad">{message}</p>}

      {invalid.length > 0 && (
        <div className="hk-add-invalid">
          {invalid.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
    </div>
  )
}

export default AddReposTab