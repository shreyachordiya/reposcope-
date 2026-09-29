import { useState } from 'react'
import './DependenciesTab.css'
import FileTree from './FileTree'

function DependenciesTab({ result, loading, error }) {
  const [selected, setSelected] = useState(null)

  if (loading) return <p className="tab-placeholder">Analyzing repository...</p>
  if (error) return <p className="tab-placeholder">Error: {error}</p>

  const deps = result?.dependencies
  if (!deps) return <p className="tab-placeholder">Paste a GitHub URL above and click Analyze.</p>

  const node = selected ? deps.nodes[selected] : null
  const wrongCase = deps.edges.filter((e) => e.caseMismatch)
  const hasProblems = deps.broken.length > 0 || wrongCase.length > 0

  return (
    <div className="dep-wrap">
      <div className="dep-card">
        <h3>Dependency facts</h3>
        <div className="dep-grid">
          {Object.entries(deps.summary).map(([key, value]) => (
            <div key={key} className="dep-stat">
              <span>{key}</span>
              <b>{value}</b>
            </div>
          ))}
        </div>
      </div>

      {hasProblems && (
        <div className="dep-card dep-problem">
          <h3>Problems</h3>
          {deps.broken.map((b, i) => (
            <div key={'b' + i} className="dep-row">
              <code>{b.from}:{b.line}</code>
              <span>imports "{b.source}" but that file does not exist</span>
            </div>
          ))}
          {wrongCase.map((e, i) => (
            <div key={'c' + i} className="dep-row">
              <code>{e.from}:{e.line}</code>
              <span>wrong capital letters, real file is {e.to} (breaks on Linux)</span>
            </div>
          ))}
        </div>
      )}

      <div className="dep-card">
        <h3>Packages ({deps.packages.length})</h3>
        {deps.packages.length === 0 && <p className="dep-empty">No packages imported.</p>}
        {deps.packages.map((p) => (
          <div key={p.name} className="dep-row">
            <code>{p.name}</code>
            <span>used in {p.usedIn.length} file(s)</span>
            <b className={p.declared ? 'dep-ok' : 'dep-warn'}>
              {p.declared ? 'declared' : 'NOT in package.json'}
            </b>
          </div>
        ))}
      </div>

      {deps.unusedPackages.length > 0 && (
        <div className="dep-card">
          <h3>In package.json but never imported ({deps.unusedPackages.length})</h3>
          {deps.unusedPackages.map((p) => (
            <div key={p.name} className="dep-row">
              <code>{p.name}</code>
              <span>{p.dev ? 'dev dependency' : 'dependency'} ({p.from})</span>
            </div>
          ))}
        </div>
      )}

      {deps.mostImported.length > 0 && (
        <div className="dep-card">
          <h3>Most imported files (riskiest to change)</h3>
          {deps.mostImported.map((f) => (
            <div key={f.path} className="dep-row">
              <code>{f.path}</code>
              <b>imported by {f.count}</b>
            </div>
          ))}
        </div>
      )}

      <h3 className="dep-heading">Pick a file</h3>
      <div className="dep-tree-layout">
        <FileTree paths={Object.keys(deps.nodes)} selected={selected} onSelect={setSelected} />

        <div className="dep-panel">
          {!node && <p className="dep-empty">Click a file to see what it uses and who uses it.</p>}
          {node && (
            <>
              <h4>{selected}</h4>

              <div className="dep-panel-title">Uses <span>{node.uses.length}</span></div>
              {node.uses.length === 0 && <p className="dep-empty">Nothing from this repo.</p>}
              {node.uses.map((p) => <div key={p} className="dep-item">{p}</div>)}

              <div className="dep-panel-title">Used by <span>{node.usedBy.length}</span></div>
              {node.usedBy.length === 0 && <p className="dep-empty">Nobody imports this file.</p>}
              {node.usedBy.map((p) => <div key={p} className="dep-item">{p}</div>)}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default DependenciesTab