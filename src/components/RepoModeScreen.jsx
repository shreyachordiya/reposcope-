import { useState } from 'react'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import OverviewTab from './tabs/OverviewTab'
import ArchitectureTab from './tabs/ArchitectureTab'
import DependenciesTab from './tabs/DependenciesTab'
import ImpactTab from './tabs/ImpactTab'
import SecurityTab from './tabs/SecurityTab'
import './RepoModeScreen.css'

function RepoModeScreen() {
  const [activeTab, setActiveTab] = useState('Overview')
  const [mode, setMode] = useState('repo')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function renderTab() {
  const tabs = {
    'Overview': <OverviewTab result={result} loading={loading} error={error} />,
    'Architecture': <ArchitectureTab result={result} loading={loading} error={error} />,
    'Dependencies': <DependenciesTab result={result} loading={loading} error={error} />,
    'Impact': <ImpactTab result={result} loading={loading} error={error} />,
    'Security': <SecurityTab />,
  }
  return Object.entries(tabs).map(([name, el]) => (
    <div key={name} style={{ display: activeTab === name ? 'contents' : 'none' }}>
      {el}
    </div>
  ))
}
  async function handleAnalyze(githubUrl) {
    setLoading(true)
    setError('')
    setResult(null)

    try {
      const response = await fetch('http://localhost:5000/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ githubUrl: githubUrl })
      })
      const data = await response.json()

      if (data.status === 'error') {
        setError(data.message)
      } else {
        setResult(data)
      }
    } catch (err) {
      setError('Could not reach the backend. Is it running?')
    }

    setLoading(false)
  }

  return (
    <div className="repo-screen">
      <TopBar
        mode={mode}
        onToggleMode={() => setMode(mode === 'repo' ? 'hackathon' : 'repo')}
        onAnalyze={handleAnalyze}
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