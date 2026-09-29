import { useState } from 'react'
import './OverviewTab.css'
import FileTree from './FileTree'
import FileFacts from './FileFacts'

function OverviewTab({ result, loading, error }) {
  const [selected, setSelected] = useState(null)

  if (loading) return <p className="tab-placeholder">Analyzing repository...</p>

  if (error) return <p className="tab-placeholder">Error: {error}</p>

  if (result) {
    const failed = result.facts?.failedFiles ?? []
    const selectedFacts = result.facts?.files?.find((f) => f.path === selected)

    return (
      <div className="overview-result">
        {result.facts && (
          <div className="facts-card">
            <h3>Code facts</h3>
            {Object.entries(result.facts.summary).map(([key, value]) => (
              <div key={key} className="fact-row">
                <span>{key}</span>
                <b>{value}</b>
              </div>
            ))}
          </div>
        )}

        {failed.length > 0 && (
          <div className="failed-card">
            <h3>Files that couldn't be read ({failed.length})</h3>
            {failed.map((f) => (
              <div key={f.path} className="failed-row">
                <code>{f.path}</code>
                <span>{f.reason}</span>
              </div>
            ))}
          </div>
        )}

        {result.facts?.unsupported && Object.keys(result.facts.unsupported).length > 0 && (
          <div className="failed-card">
            <h3>Code in languages we can't read yet</h3>
            {Object.entries(result.facts.unsupported).map(([ext, count]) => (
              <div key={ext} className="failed-row">
                <code>{ext}</code>
                <span>{count} files</span>
              </div>
            ))}
          </div>
        )}

        {result.allFiles && (
          <>
            <h3 style={{ marginTop: 28 }}>Files ({result.allFiles.length})</h3>
            <div className="tree-layout">
              <FileTree
                paths={result.allFiles}
                failedPaths={failed.map((f) => f.path)}
                selected={selected}
                onSelect={setSelected}
              />
              <FileFacts path={selected} facts={selectedFacts} />
            </div>
          </>
        )}
      </div>
    )
  }

  return <p className="tab-placeholder">Paste a GitHub URL above and click Analyze.</p>
}

export default OverviewTab