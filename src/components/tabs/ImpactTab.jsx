import { useState, useMemo } from 'react'
import FileTree from './FileTree'
import './OverviewTab.css'
import './ImpactTab.css'

const short = (p) => p.split('/').pop()
const where = (s) => (s.line ? ' at line ' + s.line : '')
const names = (s) => (s.names && s.names.length ? ' { ' + s.names.join(', ') + ' }' : '')

export default function ImpactTab({ result, loading, error }) {
  const impact = result && result.impact
  const [selected, setSelected] = useState(null)

  const paths = useMemo(() => (impact ? Object.keys(impact.files).sort() : []), [impact])
  const badges = useMemo(() => {
    const b = {}
    if (impact) {
      for (const p of paths) {
        const f = impact.files[p]
        b[p] = { level: f.risk, text: f.risk === 'none' ? 'none' : f.total + ' · ' + f.risk }
      }
    }
    return b
  }, [impact, paths])

  if (loading) return <div className="overview-result"><p className="tab-placeholder">Analyzing repository...</p></div>
  if (error) return <div className="overview-result"><p className="tab-placeholder">Error: {error}</p></div>
  if (!impact) return <div className="overview-result"><p className="tab-placeholder">Paste a GitHub URL above and click Analyze.</p></div>

  const s = impact.summary
  const info = selected ? impact.files[selected] : null

  return (
    <div className="overview-result">
      <div className="facts-card">
        <h3>Impact summary</h3>
        <div className="fact-row"><span>high risk</span><b className="risk-text-high">{s.high}</b></div>
        <div className="fact-row"><span>medium risk</span><b className="risk-text-medium">{s.medium}</b></div>
        <div className="fact-row"><span>low risk</span><b className="risk-text-low">{s.low}</b></div>
        <div className="fact-row"><span>no impact</span><b>{s.none}</b></div>
      </div>

      <h3 style={{ marginTop: 28 }}>Files ({s.totalFiles})</h3>
      <div className="tree-layout">
        <FileTree paths={paths} selected={selected} onSelect={setSelected} badges={badges} />

        <div className="facts-panel">
          {!info && <p className="panel-empty">Click a file to see what can be affected if you change it.</p>}
          {info && (
            <>
              <h4>{selected}</h4>
              <p className="impact-sentence">
                <span className={'risk-pill risk-' + info.risk}>{info.risk}</span>
                {info.total === 0
                  ? ' Nobody imports this file, so changing it affects no other file.'
                  : ' If you change this file, ' + info.total + ' other file(s) can be affected.'}
              </p>

              <div className="panel-section">
                <div className="panel-title"></div>
                <div className="panel-item">{info.total} file(s) affected. Rule: {info.rule}.</div>
              </div>

              <div className="panel-section">
                <div className="panel-title">What this file exports <span>{info.exports.length}</span></div>
                {info.exports.length === 0 && <p className="panel-note">No exports found.</p>}
                {info.exports.map((e, i) => (
                  <div key={e.name + i} className="panel-item">
                    {e.name}
                    {e.line && <em>line {e.line}</em>}
                  </div>
                ))}
              </div>

              <div className="panel-section">
                <div className="panel-title">Directly affected <span>{info.direct.length}</span></div>
                {info.direct.length === 0 && <p className="panel-note">None</p>}
                {info.direct.map((d) => (
                  <div key={d.file} className="panel-item impact-col">
                    <div>{d.file}</div>
                    <em>imports {short(selected)}{names(d)}{where(d)}</em>
                  </div>
                ))}
              </div>

              <div className="panel-section">
                <div className="panel-title">Indirectly affected <span>{info.indirect.length}</span></div>
                {info.indirect.length === 0 && <p className="panel-note">None</p>}
                {info.indirect.map((i) => (
                  <div key={i.file} className="panel-item impact-col">
                    <div>{i.file} <em>({i.distance} steps away)</em></div>
                    <div className="impact-steps">
                      {i.steps.map((st) => (
                        <div key={st.file} className="impact-step">
                          {short(st.file)} imports {short(st.imports)}{where(st)}
                        </div>
                      ))}
                      <div className="impact-step impact-origin">{short(selected)} (the file you change)</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}