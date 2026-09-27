import { useState } from 'react'
import LandingScreen from './components/LandingScreen'
import RepoModeScreen from './components/RepoModeScreen'

function App() {
  const [screen, setScreen] = useState('landing')

  return (
    <>
      {screen === 'landing' && <LandingScreen onAnalyze={() => setScreen('repo')} />}
      {screen === 'repo' && <RepoModeScreen />}
    </>
  )
}

export default App