import { useState } from 'react'
import LandingScreen from './components/LandingScreen'
import RepoModeScreen from './components/RepoModeScreen'
import HackathonScreen from './components/Hackathonscreen'

function App() {
  const [screen, setScreen] = useState('landing')
  const [mode, setMode] = useState('repo')

  function toggleMode() {
    setMode(mode === 'repo' ? 'hackathon' : 'repo')
  }

  return (
    <>
      {screen === 'landing' && <LandingScreen onAnalyze={() => setScreen('repo')} />}
      {screen === 'repo' && (
        <>
          <div style={{ display: mode === 'repo' ? 'contents' : 'none' }}>
            <RepoModeScreen mode={mode} onToggleMode={toggleMode} />
          </div>
          <div style={{ display: mode === 'hackathon' ? 'contents' : 'none' }}>
            <HackathonScreen mode={mode} onToggleMode={toggleMode} />
          </div>
        </>
      )}
    </>
  )
}

export default App