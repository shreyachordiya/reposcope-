import './OverviewTab.css'

function OverviewTab({ result, loading, error }) {
  if (loading) return <p>Analyzing repository...</p>

  if (error) return <p>Error: {error}</p>

  if (result) {
    return (
      <div className="overview-result">
        <h3>Files in repository</h3>
        <ul className="file-list">
          {result.files.map((file) => (
            <li key={file} className="file-item">{file}</li>
          ))}
        </ul>
      </div>
    )
  }

  return <p className="tab-placeholder">Paste a GitHub URL above and click Analyze.</p>
}

export default OverviewTab