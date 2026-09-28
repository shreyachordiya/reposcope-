import { useState } from 'react'
import './TopBar.css'

function TopBar({ mode, onToggleMode, onAnalyze }) {
  const [url, setUrl] = useState('')

  function handleClick() {
    let cleaned = url.trim()
    if (cleaned === '') return
    if (!cleaned.startsWith('http')) cleaned = 'https://' + cleaned
    onAnalyze(cleaned)
  }

  return (
    <div className="topbar">
      <div className="search-group">
        <div className="url-box">
          <svg className="gh-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.89-2.78.62-3.37-1.21-3.37-1.21-.45-1.18-1.11-1.5-1.11-1.5-.9-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.57 2.34 1.12 2.91.86.09-.66.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.31.1-2.73 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.42.2 2.47.1 2.73.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z"/>
          </svg>
          <input
            type="text"
            placeholder="github.com/user/repo"
            className="url-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleClick() }}
          />
        </div>

        <button className="analyze-btn" onClick={handleClick}>Analyze</button>
      </div>

      <div className="mode-switch">
        <span className={`mode-label ${mode === 'repo' ? 'active' : ''}`}>Repo</span>
        <button className={`toggle ${mode === 'hackathon' ? 'on' : ''}`} onClick={onToggleMode}>
          <span className="knob"></span>
        </button>
        <span className={`mode-label ${mode === 'hackathon' ? 'active' : ''}`}>Hackathon</span>
      </div>
    </div>
  )
}

export default TopBar