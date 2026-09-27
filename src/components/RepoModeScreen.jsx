import { useState } from 'react'
import Sidebar from './sidebar'
import TopBar from './TopBar'
import OverviewTab from './tabs/OverviewTab'
import ArchitectureTab from './tabs/ArchitectureTab'
import DependenciesTab from './tabs/DependenciesTab'
import FeatureFlowTab from './tabs/FeatureFlowTab'
import ImpactTab from './tabs/ImpactTab'
import SecurityTab from './tabs/SecurityTab'
import './RepoModeScreen.css'

function RepoModeScreen() {
  const [activeTab, setActiveTab] = useState('Overview')
  const [mode, setMode] = useState('repo')

  function renderTab() {
    if (activeTab === 'Overview') return <OverviewTab />
    if (activeTab === 'Architecture') return <ArchitectureTab />
    if (activeTab === 'Dependencies') return <DependenciesTab />
    if (activeTab === 'Feature flow') return <FeatureFlowTab />
    if (activeTab === 'Impact') return <ImpactTab />
    if (activeTab === 'Security') return <SecurityTab />
  }

  return (
    <div className="repo-screen">
      <TopBar
        mode={mode}
        onToggleMode={() => setMode(mode === 'repo' ? 'hackathon' : 'repo')}
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