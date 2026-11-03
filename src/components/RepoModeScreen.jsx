import { useRef, useState } from 'react'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import OverviewTab from './tabs/OverviewTab'
import ArchitectureTab from './tabs/ArchitectureTab'
import DependenciesTab from './tabs/DependenciesTab'
import ImpactTab from './tabs/ImpactTab'
import SecurityTab from './tabs/SecurityTab'
import AskTab from './tabs/AskTab'
import './RepoModeScreen.css'

function RepoModeScreen({ mode, onToggleMode }) {
  const [activeTab, setActiveTab] = useState('Overview')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [clearKey, setClearKey] = useState(0) // changing it empties the URL box and every tab's own state
  const runRef = useRef(0) // each Analyze and each Clear changes this, so an old request is ignored

  function renderTab() {
    const tabs = {
      'Overview': <OverviewTab result={result} loading={loading} error={error} />,
      'Architecture': <ArchitectureTab result={result} loading={loading} error={error} />,
      'Dependencies': <DependenciesTab result={result} loading={loading} error={error} />,
      'Impact': <ImpactTab result={result} loading={loading} error={error} />,
      'Security': <SecurityTab result={result} loading={loading} error={error} />,
      'Ask RepoScope': <AskTab result={result} loading={loading} error={error} />,
    }
    return Object.entries(tabs).map(([name, el]) => (
      <div key={name + clearKey} style={{ display: activeTab === name ? 'contents' : 'none' }}>
        {el}
      </div>
    ))
  }

  async function handleAnalyze(githubUrl) {
    runRef.current += 1
    const myRun = runRef.current

    setLoading(true)
    setError('')
    setResult(null)

    try {
      const response = await fetch('https://reposcope-cmdt.onrender.com/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ githubUrl: githubUrl })
      })
      const data = await response.json()
      if (runRef.current !== myRun) return // Clear or a newer Analyze came first

      if (data.status === 'error') {
        setError(data.message)
      } else {
        setResult(data)
      }
    } catch (err) {
      if (runRef.current !== myRun) return
      setError('Could not reach the backend. Is it running?')
    }

    setLoading(false)
  }

  function clearAll() {
    runRef.current += 1
    setResult(null)
    setError('')
    setLoading(false)
    setActiveTab('Overview')
    setClearKey((k) => k + 1)
  }

  return (
    <div className="repo-screen">
      <TopBar
        key={clearKey}
        mode={mode}
        onToggleMode={onToggleMode}
        onAnalyze={handleAnalyze}
        onClear={clearAll}
        canClear={Boolean(result) || loading || Boolean(error)}
      />

      <div className="repo-body">
        <Sidebar activeTab={activeTab} onSelectTab={setActiveTab} />

        <div className="content-pane">
          {renderTab()}
        </div>
      </div>
    </div>
  )
}

export default RepoModeScreen