import { useState } from 'react'
import './ScorecardsTab.css'

const AREAS = ['Security', 'Architecture', 'Reliability', 'Code health', 'Goal']
const MIN_AREAS = 3
const COLOR = { good: '#4cd394', warn: '#ffb347', bad: '#ff6b6b', none: 'rgba(255,255,255,0.35)' }

const toneOf = (v) => (typeof v !== 'number' ? 'none' : v >= 70 ? 'good' : v >= 50 ? 'warn' : 'bad')
const startWeights = () => AREAS.reduce((o, a) => ({ ...o, [a]: 1 }), {})

// Weighted average of the areas that have a mark. Fewer than 3 marks = not enough data.
function totalOf(areas, W) {
  let sum = 0
  let weight = 0
  let count = 0
  AREAS.forEach((a) => {
    if (typeof areas[a] !== 'number') return
    sum += areas[a] * W[a]
    weight += W[a]
    count += 1
  })
  if (count < MIN_AREAS) return null
  return Math.round(sum / weight)
}

const areaCount = (areas) => AREAS.filter((a) => typeof areas[a] === 'number').length

function Ring({ value, size = 76 }) {
  const c = 175.9
  const has = typeof value === 'number'
  const color = COLOR[toneOf(value)]
  return (
    <svg width={size} height={size} viewBox="0 0 76 76" role="img" aria-label={has ? 'Score ' + value + ' of 100' : 'No score'}>
      <circle cx="38" cy="38" r="28" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="7" />
      {has && (
        <circle
          cx="38" cy="38" r="28" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} transform="rotate(-90 38 38)"
        />
      )}
      <text x="38" y={has ? 44 : 43} textAnchor="middle" fontSize={has ? 20 : 15} fontWeight="600" fill="#fff">
        {has ? value : 'n/a'}
      </text>
    </svg>
  )
}

function Bar({ value }) {
  return (
    <div className="sc-bar">
      <i style={{ width: (typeof value === 'number' ? value : 0) + '%', background: COLOR[toneOf(value)] }} />
    </div>
  )
}

function Radar({ areas }) {
  const cx = 110
  const cy = 100
  const R = 64
  const n = AREAS.length
  const pt = (i, f) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f]
  }
  const poly = (f) => AREAS.map((_, i) => pt(i, f).map((x) => x.toFixed(1)).join(',')).join(' ')
  const shape = AREAS.map((a, i) =>
    pt(i, (typeof areas[a] === 'number' ? areas[a] : 0) / 100).map((x) => x.toFixed(1)).join(',')
  ).join(' ')
  return (
    <div className="sc-radar">
      <svg width="100%" viewBox="0 0 220 200" role="img" aria-label="Radar chart of the five area marks">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon key={f} points={poly(f)} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" />
        ))}
        {AREAS.map((a, i) => {
          const e = pt(i, 1)
          const l = pt(i, 1.25)
          return (
            <g key={a}>
              <line x1={cx} y1={cy} x2={e[0]} y2={e[1]} stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" />
              <text x={l[0]} y={l[1] + 4} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.7)">
                {a}{typeof areas[a] === 'number' ? '' : ' (n/a)'}
              </text>
            </g>
          )
        })}
        <polygon points={shape} fill="#7c6cf0" fillOpacity="0.25" stroke="#9d90ff" strokeWidth="1.5" />
      </svg>
    </div>
  )
}

function Section({ title, tag, children, danger }) {
  return (
    <div className={'sc-sec' + (danger ? ' sc-danger-box' : '')}>
      <div className="sc-sec-title">
        {title}
        {tag && <span className="sc-tag">{tag}</span>}
      </div>
      {children}
    </div>
  )
}

function Detail({ p, rank, count, total, weights, onClose }) {
  const f = p.facts
  const c = p.card
  const sec = f.security
  const w = f.wiring
  const builtNames = Object.keys(f.built)
  const goalTag =
    f.goal.source === 'ai' ? 'AI reads README, code decides'
      : f.goal.source === 'none' ? null
      : f.goal.aiError ? 'AI unavailable, keyword match used'
      : 'keyword match, code decides'

  return (
    <div className="sc-detail">
      <div className="sc-sec sc-head">
        <div className="sc-head-left">
          <Ring value={total} size={84} />
          <div>
            <div className="sc-name">{p.name}</div>
            <div className="sc-muted">{f.stack}</div>
            <div className="sc-chips">
              <span className="sc-chip sc-chip-accent">Rank #{rank} of {count}</span>
              {typeof f.confidence === 'number' && (
                <span className="sc-chip">Read {f.confidence}% of files</span>
              )}
              {typeof f.confidence === 'number' && f.confidence < 80 && (
                <span className="sc-chip sc-chip-warn">Less certain</span>
              )}
              {total === null && (
                <span className="sc-chip sc-chip-warn">Not enough data ({areaCount(f.areas)} of 5 areas)</span>
              )}
            </div>
          </div>
        </div>
        <button className="sc-btn" onClick={onClose}>Close</button>
      </div>

      <Section title="What this project is and how it works" tag={c.ai ? 'AI from facts, code and README' : null}>
        {c.ai ? (
          <>
            {c.ai.overview && <p className="sc-overview">{c.ai.overview}</p>}
            <ul className="sc-list">
              {c.ai.summary.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </>
        ) : (
          <div className="sc-muted">
            AI summary unavailable{c.aiError ? ': ' + c.aiError : '.'} The marks and flags below do not depend on it.
          </div>
        )}
      </Section>

      <div className="sc-two">
        <Section title="Shape of the project">
          <Radar areas={f.areas} />
        </Section>

        <Section title="Marks and security">
          {AREAS.map((a) => (
            <div key={a} className="sc-markrow">
              <span className="sc-marklabel">{a}{weights[a] > 1 ? <em> x{weights[a]}</em> : null}</span>
              <Bar value={f.areas[a]} />
              <span className={'sc-markval sc-' + toneOf(f.areas[a])}>
                {typeof f.areas[a] === 'number' ? f.areas[a] : 'n/a'}
              </span>
            </div>
          ))}
          <div className="sc-chips sc-gap">
            <span className="sc-chip sc-chip-bad">{sec.high} high</span>
            <span className="sc-chip sc-chip-warn">{sec.medium} medium</span>
            <span className="sc-chip">{sec.low} low</span>
          </div>
          <div className="sc-fact">{f.counts.routes} routes · {f.counts.components} components</div>
          {w.total > 0 && <div className="sc-fact">{w.matched} of {w.total} frontend calls reach a real route</div>}
          {!f.hasBackend && <div className="sc-fact">No backend detected, so server checks were left out</div>}
        </Section>
      </div>

      <div className="sc-two">
        <Section title="Strengths">
          {!c.strengths.length && <div className="sc-muted">No strengths could be confirmed from the code.</div>}
          {c.strengths.map((s, i) => (
            <div key={i} className="sc-item">
              <span className="sc-good">✓</span>
              <div>
                <div>{s.text}</div>
                {s.evidence && <code>{s.evidence}</code>}
              </div>
            </div>
          ))}
        </Section>

        <Section title="Weaknesses and red flags" tag={c.ai ? 'AI explains' : null} danger>
          {!c.weaknesses.length && <div className="sc-good">None found.</div>}
          {c.weaknesses.map((x, i) => (
            <div key={i} className="sc-item">
              <span className="sc-bad">▲</span>
              <div>
                <div className="sc-bad">{x.text}</div>
                {x.evidence && <code>{x.evidence}</code>}
                <div className="sc-muted">{x.aiWhy || x.why}</div>
                {(x.aiFix || x.fix) && (
                  <div className="sc-fixline"><span className="sc-fixlabel">Fix</span> {x.aiFix || x.fix}</div>
                )}
              </div>
            </div>
          ))}
        </Section>
      </div>

      <Section title="Did it deliver what the README promised?" tag={goalTag}>
        {f.goal.note && <div className="sc-muted">{f.goal.note}</div>}
        {f.goal.claims.map((g) => (
          <div key={g.id} className="sc-item sc-center">
            <span className={'sc-pill ' + (g.found ? 'sc-pill-good' : 'sc-pill-bad')}>{g.found ? 'Found' : 'Not detected'}</span>
            <span className="sc-grow">{g.label}</span>
            {g.quote && <code>"{g.quote}"</code>}
          </div>
        ))}
      </Section>

      <Section title="Where to improve" tag={c.ai ? 'from the analysis, AI makes it specific' : 'from the analysis'}>
        {!c.improvements.length && <div className="sc-muted">Nothing to fix from the checks that were run.</div>}
        {c.improvements.map((x, i) => (
          <div key={i} className="sc-item sc-center">
            <span className="sc-muted sc-num">{i + 1}</span>
            <span className={'sc-pill sc-pill-' + x.priority.toLowerCase()}>{x.priority}</span>
            <div>
              <div>{x.aiText || x.text}</div>
              <div className="sc-muted sc-small">{x.about}</div>
            </div>
          </div>
        ))}
      </Section>

      {c.ai && c.ai.ideas && c.ai.ideas.length > 0 && (
        <Section title="Ideas to make it better" tag="AI suggestion, not a finding">
          {c.ai.ideas.map((x, i) => (
            <div key={i} className="sc-item">
              <span className={'sc-pill sc-kind-' + x.kind}>{x.kind}</span>
              <div>
                <div className="sc-strong">{x.title}</div>
                <div className="sc-muted">{x.detail}</div>
              </div>
            </div>
          ))}
        </Section>
      )}

      <div className="sc-two">
        <Section title="Demo readiness" tag="Can a judge run it?">
          {f.ready.map((r) => (
            <div key={r.id} className="sc-item sc-center">
              <span className={r.ok ? 'sc-good' : 'sc-bad'}>{r.ok ? '✓' : '✗'}</span>
              <span className="sc-grow">{r.label}</span>
              <code>{r.evidence || 'not found'}</code>
            </div>
          ))}
        </Section>

        <Section title="Safeguards for what they built">
          {!builtNames.length && <div className="sc-muted">No listed features detected, so there is nothing to check.</div>}
          {builtNames.map((name) => {
            const list = f.built[name]
            const ok = list.filter((s) => s.ok).length
            const pct = list.length ? Math.round((ok / list.length) * 100) : null
            return (
              <div key={name} className="sc-built">
                <div className="sc-spread">
                  <span>{name}</span>
                  <span className={'sc-' + toneOf(pct)}>
                    {list.length ? ok + ' of ' + list.length + ' in place' : 'none could be checked'}
                  </span>
                </div>
                <Bar value={pct} />
              </div>
            )
          })}
          {builtNames.length > 0 && (
            <div className="sc-muted sc-small">A feature that was not built is never counted against a project.</div>
          )}
        </Section>
      </div>

      <div className="sc-muted sc-small">
        Marks, flags and found / not detected come from code analysis. AI only writes the summary, the explanations, the tips and the ideas.
        Missing means not detected in the code, not proven unsafe.
      </div>
    </div>
  )
}

function ScorecardsTab({ projects }) {
  const [sel, setSel] = useState(null)
  const [weights, setWeights] = useState(startWeights())

  if (!projects.length) {
    return (
      <div className="sc-scroll">
        <div className="sc-sec sc-muted">No projects yet. Add some repos first.</div>
      </div>
    )
  }

  const ranked = projects
    .filter((p) => p.status === 'done' && p.facts)
    .map((p) => ({ ...p, total: totalOf(p.facts.areas, weights) }))
    .sort((a, b) => (b.total === null ? -1 : b.total) - (a.total === null ? -1 : a.total))
  const waiting = projects.filter((p) => p.status !== 'done')
  const opened = ranked.find((p) => p.url === sel)

  function cycle(a) {
    setWeights((prev) => ({ ...prev, [a]: prev[a] >= 3 ? 1 : prev[a] + 1 }))
  }

  return (
    <div className="sc-scroll">
      <div className="sc-sec">
        <div className="sc-sec-title">Judge weights <span className="sc-tag">click to change, only the totals change</span></div>
        <div className="sc-chips sc-nomargin">
          {AREAS.map((a) => (
            <button key={a} className={'sc-btn' + (weights[a] > 1 ? ' on' : '')} onClick={() => cycle(a)}>
              {a} x{weights[a]}
            </button>
          ))}
        </div>
      </div>

      {waiting.length > 0 && (
        <div className="sc-sec">
          {waiting.map((p) => (
            <div key={p.url} className="sc-spread sc-line">
              <span>{p.name}</span>
              <span className={p.status === 'failed' ? 'sc-bad' : 'sc-muted'}>
                {p.status === 'failed' ? p.error || 'Failed' : p.status === 'analyzing' ? 'Analyzing...' : 'Waiting...'}
              </span>
            </div>
          ))}
          <div className="sc-muted sc-small">Each repo is cloned, read, checked and summarized. This can take a minute.</div>
        </div>
      )}

      {ranked.length > 0 && (
        <div className="sc-cards">
          {ranked.map((p, i) => (
            <div key={p.url} className={'sc-card' + (sel === p.url ? ' sel' : '')} onClick={() => setSel(sel === p.url ? null : p.url)}>
              <div className="sc-spread">
                <span className="sc-muted">#{i + 1}</span>
                <span className={'sc-chip ' + (p.card.weaknesses.length ? 'sc-chip-bad' : 'sc-chip-good')}>
                  {p.card.weaknesses.length} flag{p.card.weaknesses.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="sc-card-mid">
                <Ring value={p.total} />
                <div>
                  <div className="sc-name">{p.name.split('/').pop()}</div>
                  <div className="sc-muted sc-small">{p.facts.stack}</div>
                </div>
              </div>
              {AREAS.map((a) => (
                <div key={a} className="sc-minirow">
                  <span>{a}</span>
                  <Bar value={p.facts.areas[a]} />
                </div>
              ))}
              {p.total === null && <div className="sc-muted sc-small">Not enough data ({areaCount(p.facts.areas)} of 5 areas)</div>}
            </div>
          ))}
        </div>
      )}

      {!opened && ranked.length > 0 && <div className="sc-muted">Click a card to open its full scorecard.</div>}

      {opened && (
        <Detail
          p={opened}
          rank={ranked.indexOf(opened) + 1}
          count={ranked.length}
          total={opened.total}
          weights={weights}
          onClose={() => setSel(null)}
        />
      )}
    </div>
  )
}

export default ScorecardsTab