// Every row: [key in the facts object, title shown on screen, how one item is written as text]
// All formatters are null-safe: a missing field never crashes the panel.
const opts = (o) => {
  const keys = Object.keys(o || {})
  return keys.length ? '  {' + keys.map((k) => `${k}: ${o[k]}`).join(', ') + '}' : ''
}

const SECTIONS = [
  ['imports',       'Imports',        (x) => `${x.source}${x.names?.length ? '  →  ' + x.names.join(', ') : ''}${x.kind !== 'import' ? '  (' + x.kind + ')' : ''}`],
  ['exports',       'Exports',        (x) => `${x.name}${x.default ? '  (default)' : ''}`],
  ['components',    'Components',     (x) => x.name],
  ['functions',     'Functions',      (x) => x.name],
  ['classes',       'Classes',        (x) => x.name],
  ['types',         'Types',          (x) => `${x.name}  (${x.kind})`],
  // CHANGED: shows the middleware list of a route (ADDED #9)
  ['routes',        'Routes',         (x) => `${x.method} ${x.path ?? '(dynamic)'}  →  ${x.handler}${x.middleware?.length ? '   [' + x.middleware.join(', ') + ']' : ''}`],
  // CHANGED: url can be null; instance + baseURL come from ADDED #16
  ['apiCalls',      'API calls',      (x) => `${x.method} ${x.url ?? '(no url)'}${x.resolved ? '' : '  (unresolved)'}${x.instance ? '  via ' + x.instance + (x.baseURL ? ' (base ' + x.baseURL + ')' : '') : ''}`],
  ['models',        'Models',         (x) => x.name],
  ['dbCalls',       'Database calls', (x) => `${x.model}.${x.method}`],
  ['eventHandlers', 'Event handlers', (x) => `${x.event}  →  ${x.handler}`],

  // ---- NEW (parser ADDED #10 - #15) ----
  ['clientRoutes',  'Page routes',    (x) => `${x.path ?? (x.index ? '(index)' : '(no path)')}  →  ${[...(x.wrappers || []), x.element || '?'].join(' › ')}`],
  ['hooks',         'Effects',        (x) => `${x.hook}  (${x.runs})${x.calls?.length ? '  →  ' + x.calls.join(', ') : ''}`],
  ['middleware',    'Middleware',     (x) => `${x.name}${x.path ? '  on ' + x.path : ''}${opts(x.options)}`],
  ['auth',          'Auth',           (x) => `${x.kind}  —  ${x.detail}`],
  ['envVars',       'Env variables',  (x) => x.name],
  ['dbConnections', 'DB connections', (x) => `${x.client}  →  ${x.uri}`],
    ['integrations',  'Integrations',   (x) => `${x.kind}  —  ${x.detail}`],
]

function FileFacts({ path, facts }) {
  if (!path) {
    return (
      <div className="facts-panel">
        <p className="panel-empty">Click a file in the tree to see what's inside it.</p>
      </div>
    )
  }

  if (!facts) {
    return (
      <div className="facts-panel">
        <h4>{path}</h4>
        <p className="panel-empty">Not a code file, so there are no facts to show.</p>
      </div>
    )
  }

  const shown = SECTIONS.filter(([key]) => facts[key] && facts[key].length > 0)

  return (
    <div className="facts-panel">
      <h4>{path}</h4>

      {facts.error && <p className="panel-error">Couldn't read this file: {facts.error}</p>}
      {facts.generated && <p className="panel-note">Minified or bundled output, not hand-written source.</p>}
      {facts.parseErrors > 0 && (
        <p className="panel-note">Partly read: {facts.parseErrors} piece(s) of code had to be skipped.</p>
      )}
      {!facts.error && shown.length === 0 && (
        <p className="panel-empty">Nothing found in this file (no imports, routes or components).</p>
      )}

      {shown.map(([key, title, format]) => (
        <div key={key} className="panel-section">
          <div className="panel-title">
            {title} <span>{facts[key].length}</span>
          </div>
          {facts[key].map((item, i) => (
            <div key={i} className="panel-item">
              <span>{format(item)}</span>
              {item.line && <em>line {item.line}</em>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default FileFacts