import { useState } from 'react'
import './JudgeQuestionsTab.css'

const CATS = ['All', 'How it works', 'Tech', 'Security', 'Claims', 'Scale', 'Idea']
const PRI = {
  high: { label: 'High', cls: 'jq-pri-high' },
  medium: { label: 'Medium', cls: 'jq-pri-medium' },
  low: { label: 'Low', cls: 'jq-pri-low' },
}

function Pri({ level }) {
  const p = PRI[level] || PRI.medium
  return <span className={'jq-pill ' + p.cls}>{p.label}</span>
}

function JudgeQuestionsTab({ projects }) {
  const [url, setUrl] = useState(null)
  const [cat, setCat] = useState('All')
  const [selId, setSelId] = useState(null)

  const done = (projects || []).filter((p) => p.status === 'done' && p.facts)
  const waiting = (projects || []).filter((p) => p.status !== 'done')

  if (!done.length) {
    return (
      <div className="jq-wrap">
        <div className="jq-box jq-muted">
          {waiting.length
            ? 'Repos are still being analyzed. Questions appear here when each one is done.'
            : 'No projects yet. Add some repos first.'}
        </div>
      </div>
    )
  }

  const current = done.find((p) => p.url === url) || done[0]
  const all = current.questions || []
  const shown = all.filter((q) => cat === 'All' || q.category === cat)
  const selected = shown.find((q) => q.id === selId) || shown[0]
  const highCount = all.filter((q) => q.priority === 'high').length

  function pickProject(u) {
    setUrl(u)
    setCat('All')
    setSelId(null)
  }

  return (
    <div className="jq-wrap">
      <div className="jq-box jq-top">
        <div>
          <div className="jq-title">Judge questions</div>
          <div className="jq-muted">
            {current.name} · {current.facts.stack}
          </div>
        </div>
        <div className="jq-muted">
          {all.length} questions · {highCount} high priority
        </div>
      </div>

      {done.length > 1 && (
        <div className="jq-chips">
          {done.map((p) => (
            <button
              key={p.url}
              className={'jq-chip' + (p.url === current.url ? ' on' : '')}
              onClick={() => pickProject(p.url)}
            >
              {p.name.split('/').pop()}
            </button>
          ))}
        </div>
      )}

      {all.length === 0 ? (
        <div className="jq-box jq-muted">
          No questions for this project
          {current.questionsError ? ': ' + current.questionsError : '.'} The scorecard does not depend on them.
        </div>
      ) : (
        <>
          <div className="jq-chips">
            {CATS.map((c) => (
              <button key={c} className={'jq-chip' + (c === cat ? ' on' : '')} onClick={() => { setCat(c); setSelId(null) }}>
                {c}
              </button>
            ))}
          </div>

          <div className="jq-grid">
            <div className="jq-list">
              {!shown.length && <div className="jq-muted">No questions in this category.</div>}
              {shown.map((q, i) => (
                <button
                  key={q.id}
                  className={'jq-row' + (selected && q.id === selected.id ? ' on' : '')}
                  onClick={() => setSelId(q.id)}
                >
                  <div className="jq-row-top">
                    <span className="jq-muted">Q{i + 1} · {q.category}</span>
                    <Pri level={q.priority} />
                  </div>
                  <div className="jq-row-q">{q.question}</div>
                </button>
              ))}
            </div>

            <div className="jq-detail">
              {selected && (
                <>
                  <div className="jq-detail-top">
                    <Pri level={selected.priority} />
                    <span className="jq-muted">{selected.category}</span>
                  </div>
                  <div className="jq-detail-q">{selected.question}</div>

                  <div className="jq-label">Why judges ask</div>
                  <div className="jq-text">{selected.why}</div>

                  <div className="jq-label">Evidence</div>
                  <code className="jq-code">{selected.evidence}</code>
                  <div className="jq-muted jq-small">
                    {selected.fromAnalyzer
                      ? 'Priority comes from an analyzer finding.'
                      : 'Priority is how likely a judge is to ask this. The AI sets it.'}
                  </div>

                  <div className="jq-label">Suggested answer</div>
                  <div className="jq-answer">{selected.answer}</div>

                  {selected.followUp && (
                    <>
                      <div className="jq-label">Likely follow-up</div>
                      <div className="jq-text jq-muted">{selected.followUp}</div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      <div className="jq-muted jq-small">
        The analyzer finds the facts. AI reads the project and writes the questions and draft answers. Check every answer
        against your own project before you use it.
      </div>
    </div>
  )
}

export default JudgeQuestionsTab