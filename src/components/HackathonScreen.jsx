import { useRef, useState } from 'react'
import TopBar from './TopBar'
import HackathonSidebar from './HackathonSidebar'
import AddReposTab from './hackathon/AddReposTab'
import ScorecardsTab from './hackathon/ScorecardsTab'
import JudgeQuestionsTab from './hackathon/JudgeQuestionsTab'
import './RepoModeScreen.css'

const TABS = ['Add repos', 'Scorecards', 'Judge questions']

function nameFromUrl(url) {
  return url.replace('https://github.com/', '')
}

function HackathonScreen({ mode, onToggleMode, onBack }) {
  const [activeTab, setActiveTab] = useState('Add repos')
  const [history, setHistory] = useState([])
  const [projects, setProjects] = useState([])
  const [running, setRunning] = useState(false)
  const [clearKey, setClearKey] = useState(0)
  const runRef = useRef(0)

  function update(url, changes) {
    setProjects((prev) => prev.map((p) => (p.url === url ? { ...p, ...changes } : p)))
  }

  function selectTab(name) {
    if (name === activeTab) return
    setHistory((h) => [...h, activeTab].slice(-20))
    setActiveTab(name)
  }

  function goBack() {
    if (history.length) {
      setActiveTab(history[history.length - 1])
      setHistory((h) => h.slice(0, -1))
    } else if (onBack) {
      onBack()
    }
  }

  function clearAll() {
    runRef.current += 1
    setProjects([])
    setRunning(false)
    setHistory([])
    setActiveTab('Add repos')
    setClearKey((k) => k + 1)
  }

  async function handleStart(urls) {
    selectTab('Scorecards')
    if (running) return

    const myRun = runRef.current

    const list = urls.map((url) => {
      const old = projects.find((p) => p.url === url && p.status === 'done')
      return old || { url, name: nameFromUrl(url), status: 'queued' }
    })
    setProjects(list)
    setRunning(true)

    for (const p of list) {
      if (runRef.current !== myRun) break
      if (p.status === 'done') continue
      update(p.url, { status: 'analyzing' })
      try {
        const response = await fetch('https://reposcope-cmdt.onrender.com/hackathon/scorecard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ githubUrl: p.url }),
        })
        const data = await response.json()
        if (runRef.current !== myRun) break
        if (data.status === 'error') {
          update(p.url, { status: 'failed', error: data.message })
        } else {
          update(p.url, {
            status: 'done',
            facts: data.facts,
            card: data.scorecard,
            questions: data.questions || [],
            questionsError: data.questionsError || null,
          })
        }
      } catch (err) {
        if (runRef.current !== myRun) break
        update(p.url, { status: 'failed', error: 'Could not reach the backend. Is it running?' })
      }
    }
    if (runRef.current === myRun) setRunning(false)
  }

  function renderTab() {
    const tabs = {
      'Add repos': <AddReposTab key={clearKey} onStart={handleStart} />,
      'Scorecards': <ScorecardsTab projects={projects} />,
      'Judge questions': <JudgeQuestionsTab projects={projects} />,
    }

    return Object.entries(tabs).map(([name, el]) => (
      <div key={name} style={{ display: activeTab === name ? 'contents' : 'none' }}>
        {el}
      </div>
    ))
  }

  return (
    <div className="repo-screen">
      <TopBar
        mode={mode}
        onToggleMode={onToggleMode}
        onBack={goBack}
        onClear={clearAll}
        canClear={projects.length > 0}
      />

      <div className="repo-body">
        <HackathonSidebar tabs={TABS} activeTab={activeTab} onSelectTab={selectTab} />

        <div className="content-pane">
          {renderTab()}
        </div>
      </div>
    </div>
  )
}

export default HackathonScreen