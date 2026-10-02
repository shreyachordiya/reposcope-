import { useState, useMemo } from 'react';
import './OverviewTab.css';
import './SecurityTab.css';

const CATS = [
  ['all', 'All'],
  ['secrets', 'Secrets'],
  ['browser', 'Browser'],
  ['server', 'Server'],
  ['packages', 'Packages'],
  ['ci', 'CI / workflows'],
];
const LEVELS = ['high', 'medium', 'low'];

export default function SecurityTab({ result, loading, error }) {
  const [cat, setCat] = useState('all');
  const [selectedId, setSelectedId] = useState(null);

  const security = result && result.security;

  const shown = useMemo(() => {
    const all = (security && security.findings) || [];
    return cat === 'all' ? all : all.filter((f) => f.category === cat);
  }, [security, cat]);

  if (loading) return <div className="tab-placeholder">Analyzing...</div>;
  if (error) return <div className="tab-placeholder">{error}</div>;
  if (!security) {
    return (
      <div className="tab-placeholder">
        No security data yet. Click Analyze (and restart the backend if you just added security.js).
      </div>
    );
  }

  const { summary, checks, note } = security;
  const selected = shown.find((f) => f.id === selectedId) || null;
  const counts = summary.byCategory || {};

  return (
    <div className="overview-result">
      <div className="sec-summary">
        <div className="sec-summary-title">Security summary</div>
        <div className="sec-stats">
          <div className="sec-stat"><span>findings</span><b>{summary.total}</b></div>
          <div className="sec-stat"><span>high</span><b className="sec-c-high">{summary.high}</b></div>
          <div className="sec-stat"><span>medium</span><b className="sec-c-medium">{summary.medium}</b></div>
          <div className="sec-stat"><span>low</span><b className="sec-c-low">{summary.low}</b></div>
          <div className="sec-stat"><span>files scanned</span><b>{summary.filesScanned}</b></div>
        </div>
      </div>

      <div className="sec-chips">
        {CATS.map(([key, label]) => (
          <button
            key={key}
            className={'sec-chip' + (cat === key ? ' active' : '')}
            onClick={() => { setCat(key); setSelectedId(null); }}
          >
            {label}{key !== 'all' ? ` (${counts[key] || 0})` : ` (${summary.total})`}
          </button>
        ))}
      </div>

      <div className="sec-layout">
        <div className="facts-panel sec-scroll">
          {shown.length === 0 && (
            <div className="panel-empty">No findings in this group.</div>
          )}
          {LEVELS.map((level) => {
            const group = shown.filter((f) => f.severity === level);
            if (!group.length) return null;
            return (
              <div key={level}>
                <div className="panel-title">{level} ({group.length})</div>
                {group.map((f) => (
                  <div
                    key={f.id}
                    className={'sec-row' + (selectedId === f.id ? ' selected' : '')}
                    onClick={() => setSelectedId(selectedId === f.id ? null : f.id)}
                  >
                    <span className={'sec-dot sec-bg-' + f.severity} />
                    <div className="sec-row-text">
                      <div className="sec-row-title">{f.title}</div>
                      <div className="sec-row-file">{f.file}:{f.line}</div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div className="facts-panel sec-scroll">
          {selected ? (
            <>
              <div className="sec-detail-title">{selected.title}</div>
              <div className="sec-pills">
                <span className={'sec-pill sec-bg-' + selected.severity}>{selected.severity} severity</span>
                <span className="sec-pill sec-pill-plain">{selected.confidence} confidence</span>
                <span className="sec-pill sec-pill-plain">{selected.category}</span>
              </div>

              <div className="panel-title">Where</div>
              <div className="panel-item sec-mono">{selected.file}:{selected.line}</div>

              <div className="panel-title">Evidence</div>
              <pre className="sec-evidence">{selected.evidence}</pre>

              <div className="panel-title">Why it matters</div>
              <div className="panel-item">{selected.why}</div>

              <div className="panel-title">How to fix</div>
              <div className="panel-item">{selected.fix}</div>
            </>
          ) : (
            <>
              <div className="panel-item">Click a finding to see the evidence, why it matters, and how to fix it.</div>
              <div className="panel-note">{note}</div>
              <details className="sec-checks">
                <summary>Checks that were run ({checks.length})</summary>
                {CATS.slice(1).map(([key, label]) => (
                  <div key={key}>
                    <div className="panel-title">{label}</div>
                    {checks.filter((c) => c.category === key).map((c) => (
                      <div className="panel-item" key={c.title}>{c.title}</div>
                    ))}
                  </div>
                ))}
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}