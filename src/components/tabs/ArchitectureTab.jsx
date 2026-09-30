import { useState, useMemo } from 'react'
import './ArchitectureTab.css'

const COLORS = { ui: '#a78bfa', server: '#34d399', data: '#fb923c', helper: '#2dd4bf', config: '#94a3b8' }
const ROLE_LABEL = { ui: 'UI', server: 'Server / routes', data: 'Data', helper: 'Helper', config: 'Config' }

const DETAILS = [
  ['components', 'Components', (x) => x.name],
  ['functions', 'Functions', (x) => x.name],
  ['eventHandlers', 'Event handlers', (x) => `${x.event} → ${x.handler}`],
  ['routes', 'Routes', (x) => `${x.method} ${x.path} → ${x.handler}`],
  ['apiCalls', 'API calls', (x) => `${x.method} ${x.url}`],
  ['models', 'Models', (x) => x.name],
  ['dbCalls', 'Database calls', (x) => `${x.model}.${x.method}`],
]

// CHANGED: bigger boxes and spacing
const NODE_W = 180
const NODE_H = 40
const GAP_X = 24
const ROW_H = 100
const TOP = 100
const PAD = 24
const SEC_GAP = 40

const baseName = (p) => p.split('/').pop()
// CHANGED: wider boxes fit more characters
const short = (n) => (n.length > 22 ? n.slice(0, 21) + '…' : n)

// arrow from the bottom of "a" to the top of "b" (a uses b)
function edgePath(a, b) {
  const x1 = a.x + NODE_W / 2
  const x2 = b.x + NODE_W / 2
  if (b.y > a.y) {
    const y1 = a.y + NODE_H
    const m = (y1 + b.y) / 2
    return `M${x1},${y1} C${x1},${m} ${x2},${m} ${x2},${b.y}`
  }
  const y2 = b.y + NODE_H
  return `M${x1},${a.y} C${x1},${a.y - 45} ${x2},${y2 + 45} ${x2},${y2}`
}

// line between the frontend and the backend (side to side)
function connPath(a, b) {
  const right = a.x < b.x
  const x1 = right ? a.x + NODE_W : a.x
  const x2 = right ? b.x : b.x + NODE_W
  const y1 = a.y + NODE_H / 2
  const y2 = b.y + NODE_H / 2
  const mx = (x1 + x2) / 2
  return { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, lx: mx, ly: (y1 + y2) / 2 }
}

// decide where every box goes (rows = layers, sections side by side)
function buildLayout(arch, deps) {
  if (!arch || !deps) return null
  const sections = arch.sections.filter((s) => s.side !== 'config')
  if (sections.length === 0) return null

  const pos = {}
  const boxes = []
  const rowLabels = []
  let x0 = PAD
  let maxRows = 0

  for (const sec of sections) {
    const maxCols = Math.max(...sec.rows.map((r) => r.files.length))
    const innerW = maxCols * NODE_W + (maxCols - 1) * GAP_X
    const secW = innerW + PAD * 2

    sec.rows.forEach((row, i) => {
      let files = row.files
      if (i > 0) {
        // put each box under the boxes that use it, so lines cross less
        const avg = (p) => {
          const xs = ((deps.nodes[p] && deps.nodes[p].usedBy) || []).filter((q) => pos[q]).map((q) => pos[q].x)
          return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1e9
        }
        files = [...files].sort((a, b) => avg(a) - avg(b))
      }
      const rowW = files.length * NODE_W + (files.length - 1) * GAP_X
      const startX = x0 + PAD + (innerW - rowW) / 2
      const y = TOP + i * ROW_H
      files.forEach((p, j) => {
        pos[p] = { x: startX + j * (NODE_W + GAP_X), y }
      })
      rowLabels.push({ x: x0 + 12, y: y - 12, text: row.label })
    })

    boxes.push({ title: sec.title, x: x0, w: secW })
    x0 += secW + SEC_GAP
    maxRows = Math.max(maxRows, sec.rows.length)
  }

  const width = x0 - SEC_GAP + PAD
  const height = TOP + (maxRows - 1) * ROW_H + NODE_H + PAD

  const seen = new Set()
  const edges = []
  for (const e of deps.edges) {
    const k = e.from + '>' + e.to
    if (seen.has(k) || e.from === e.to || !pos[e.from] || !pos[e.to]) continue
    seen.add(k)
    edges.push({ from: e.from, to: e.to })
  }

  const conns = arch.connections
    .filter((c) => pos[c.from] && pos[c.to])
    .map((c) => ({ ...c, ...connPath(pos[c.from], pos[c.to]) }))

  return { pos, boxes, rowLabels, edges, conns, width, height }
}

function ArchitectureTab({ result, loading, error }) {
  const [selected, setSelected] = useState(null)
  const arch = result?.architecture
  const deps = result?.dependencies
  const layout = useMemo(() => buildLayout(arch, deps), [arch, deps])

  if (loading) return <p className="tab-placeholder">Analyzing repository...</p>
  if (error) return <p className="tab-placeholder">Error: {error}</p>
  if (!arch || !deps || !layout) return <p className="tab-placeholder">Paste a GitHub URL above and click Analyze.</p>

  const { pos, boxes, rowLabels, edges, conns, width, height } = layout
  const node = selected ? deps.nodes[selected] : null
  const info = selected ? arch.files[selected] : null
  const facts = selected ? result.facts.files.find((f) => f.path === selected) : null
  const configFiles = Object.keys(arch.files).filter((p) => arch.files[p].side === 'config')
  const myLinks = arch.connections.filter((c) => c.from === selected || c.to === selected)

  const linked = new Set()
  if (selected) {
    linked.add(selected)
    if (node) {
      node.uses.forEach((p) => linked.add(p))
      node.usedBy.forEach((p) => linked.add(p))
    }
    conns.forEach((c) => {
      if (c.from === selected) linked.add(c.to)
      if (c.to === selected) linked.add(c.from)
    })
  }

  const pick = (p) => setSelected(selected === p ? null : p)

  return (
    <div className="arch-wrap">
      <div className="arch-box">
        <h3>Architecture</h3>
        <div className="arch-legend">
          {Object.entries(ROLE_LABEL).map(([role, label]) => (
            <span key={role} className="arch-legend-item">
              <i style={{ background: COLORS[role] }} />{label}
            </span>
          ))}
          <span className="arch-legend-item"><i className="lg-line" style={{ background: '#6b6390' }} />A uses B</span>
          <span className="arch-legend-item"><i className="lg-line" style={{ background: '#34d399' }} />Frontend → backend call</span>
        </div>
        <p className="arch-hint">
          Click a box: blue arrows = what it uses, pink arrows = who uses it. Click empty space to reset.
        </p>
      </div>

      <div className="arch-main">
        <div className="arch-diagram">
          {/* CHANGED: real pixel size, so it never shrinks; the box scrolls instead */}
          <svg
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: '100%', minWidth: width * 0.85, maxWidth: width }}
            onClick={() => setSelected(null)}
>
            <defs>
              {[['grey', '#6b6390'], ['blue', '#38bdf8'], ['pink', '#f472b6'], ['green', '#34d399']].map(([id, c]) => (
                <marker key={id} id={`arr-${id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill={c} />
                </marker>
              ))}
            </defs>

            {boxes.map((b) => (
              <g key={b.title}>
                <rect x={b.x} y={10} width={b.w} height={height - 20} rx={14}
                  fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />
                {/* CHANGED: bigger section title */}
                <text x={b.x + 18} y={44} style={{ fill: 'var(--text-main)', fontSize: 26, fontWeight: 700 }}>{b.title}</text>
              </g>
            ))}

            {rowLabels.map((r, i) => (
              /* CHANGED: fontSize 12 */
              <text key={i} x={r.x} y={r.y} style={{ fill: 'var(--text-faint)', fontSize: 16, fontWeight: 700, letterSpacing: '0.06em' }}>
                {r.text.toUpperCase()}
              </text>
            ))}

            {edges.map((e) => {
              let color = '#6b6390', w = 1.5, op = 0.75, mk = 'grey'
              if (selected) {
                if (e.from === selected) { color = '#38bdf8'; w = 2.5; op = 1; mk = 'blue' }
                else if (e.to === selected) { color = '#f472b6'; w = 2.5; op = 1; mk = 'pink' }
                else op = 0.07
              }
              return (
                <path key={e.from + '>' + e.to} d={edgePath(pos[e.from], pos[e.to])} fill="none"
                  stroke={color} strokeWidth={w} opacity={op} markerEnd={`url(#arr-${mk})`} />
              )
            })}

            {conns.map((c, i) => {
              const text = `${c.method} ${c.path}`
              const w = text.length * 9 + 22 // CHANGED
              const hot = !selected || c.from === selected || c.to === selected
              return (
                <g key={i} opacity={hot ? 1 : 0.1}>
                  <path d={c.d} fill="none" stroke="#34d399" strokeWidth="2.5" strokeDasharray="7 5" markerEnd="url(#arr-green)" />
                  {/* CHANGED: bigger label */}
                  <rect x={c.lx - w / 2} y={c.ly - 14} width={w} height={28} rx={14} fill="#0f2a22" stroke="#34d399" />
                  <text x={c.lx} y={c.ly} textAnchor="middle" dominantBaseline="central"
                    style={{ fill: '#6fcf97', fontSize: 16, fontFamily: 'monospace' }}>{text}</text>
                </g>
              )
            })}

            {Object.keys(pos).map((p) => {
              const { x, y } = pos[p]
              const c = COLORS[arch.files[p].role]
              const isSel = p === selected
              const dim = selected && !linked.has(p)
              return (
                <g key={p} opacity={dim ? 0.2 : 1} style={{ cursor: 'pointer' }}
                  onClick={(ev) => { ev.stopPropagation(); pick(p) }}>
                  <title>{p}</title>
                  <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={9}
                    fill={c} fillOpacity={0.2} stroke={isSel ? '#ffffff' : c} strokeWidth={isSel ? 3 : 2} />
                  {/* CHANGED: fontSize 14 */}
                  <text x={x + NODE_W / 2} y={y + NODE_H / 2} textAnchor="middle" dominantBaseline="central"
                    style={{ fill: 'var(--text-main)', fontSize: 16, fontFamily: 'monospace' }}>
                    {short(baseName(p))}
                  </text>
                  {arch.files[p].isEntry && (
                    <g>
                      {/* CHANGED: bigger ENTRY badge */}
                      <rect x={x + NODE_W - 56} y={y - 11} width={56} height={20} rx={10} fill="#60a5fa" />
                      <text x={x + NODE_W - 28} y={y - 1} textAnchor="middle" dominantBaseline="central"
                        style={{ fill: '#0b1020', fontSize: 14, fontWeight: 700 }}>ENTRY</text>
                    </g>
                  )}
                </g>
              )
            })}
          </svg>

          {configFiles.length > 0 && (
            <div className="arch-config">
              <span>Config files (not part of the tree):</span>
              {configFiles.map((p) => (
                <b key={p} onClick={() => pick(p)}>{baseName(p)}</b>
              ))}
            </div>
          )}
        </div>

        <div className="arch-panel">
          {!info && <p className="arch-empty">Click a box in the diagram to see its role, what it uses, who uses it, and what is inside it.</p>}
          {info && (
            <>
              <h4>{selected}</h4>
              <div className="arch-role" style={{ color: COLORS[info.role] }}>
                <b>{ROLE_LABEL[info.role]}</b>
                {info.isEntry && <span className="arch-badge">ENTRY</span>}
              </div>
              <p className="arch-why">Why: {info.reason}</p>
              {info.layer !== null && <p className="arch-why">Layer {info.layer} on the {info.side} side</p>}

              <div className="arch-title">Uses <span>{node ? node.uses.length : 0}</span></div>
              {(!node || node.uses.length === 0) && <p className="arch-empty">Nothing from this repo.</p>}
              {node && node.uses.map((p) => <div key={p} className="arch-link l-uses" onClick={() => pick(p)}>{p}</div>)}

              <div className="arch-title">Used by <span>{node ? node.usedBy.length : 0}</span></div>
              {(!node || node.usedBy.length === 0) && <p className="arch-empty">Nobody imports this file.</p>}
              {node && node.usedBy.map((p) => <div key={p} className="arch-link l-usedby" onClick={() => pick(p)}>{p}</div>)}

              {myLinks.length > 0 && (
                <>
                  <div className="arch-title">Frontend ↔ Backend <span>{myLinks.length}</span></div>
                  {myLinks.map((c, i) => (
                    <div key={i} className="arch-item">{c.method} {c.path} ({baseName(c.from)} → {baseName(c.to)})</div>
                  ))}
                </>
              )}

              {facts && DETAILS.filter(([k]) => facts[k] && facts[k].length > 0).map(([k, title, fmt]) => (
                <div key={k}>
                  <div className="arch-title">{title} <span>{facts[k].length}</span></div>
                  {facts[k].map((x, i) => (
                    <div key={i} className="arch-item">
                      {fmt(x)}{x.line && <em>line {x.line}</em>}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default ArchitectureTab