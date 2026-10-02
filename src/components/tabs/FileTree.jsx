import { useState, useMemo } from 'react'
import './FileTree.css'

function buildTree(paths) {
  const root = { children: {} }
  for (const p of paths) {
    const parts = p.split('/')
    let node = root
    parts.forEach((part, i) => {
      if (!node.children[part]) {
        node.children[part] = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          isFile: i === parts.length - 1,
          children: {},
        }
      }
      node = node.children[part]
    })
  }
  return root
}

function sortedChildren(node) {
  return Object.values(node.children).sort((a, b) =>
    a.isFile === b.isFile ? a.name.localeCompare(b.name) : a.isFile ? 1 : -1
  )
}

function TreeNode({ node, depth, failed, selected, onSelect, badges }) {
  const [open, setOpen] = useState(false)
  const indent = { paddingLeft: 12 + depth * 18 }

  if (node.isFile) {
    const bad = failed.has(node.path)
    const risk = badges && badges[node.path]
    const cls =
      'tree-row tree-file' +
      (bad ? ' tree-failed' : '') +
      (selected === node.path ? ' tree-selected' : '')
    return (
      <div
        className={cls}
        style={indent}
        onClick={() => onSelect(selected === node.path ? null : node.path)}
      >
        {node.name}
        {bad && <span className="tree-badge">unreadable</span>}
        {!bad && risk && (
          <span className={'tree-badge risk-' + risk.level}>{risk.text}</span>
        )}
      </div>
    )
  }

  return (
    <>
      <div
        className="tree-row tree-folder"
        style={indent}
        onClick={() => {
          if (open && selected && selected.startsWith(node.path + '/')) onSelect(null)
          setOpen(!open)
        }}
      >
        <span className="tree-arrow">{open ? '▼' : '▶'}</span>
        {node.name}
      </div>
      {open &&
        sortedChildren(node).map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            failed={failed}
            selected={selected}
            onSelect={onSelect}
            badges={badges}
          />
        ))}
    </>
  )
}

function FileTree({ paths, failedPaths = [], selected, onSelect, badges }) {
  const root = useMemo(() => buildTree(paths), [paths])
  const failed = useMemo(() => new Set(failedPaths), [failedPaths])

  return (
    <div className="file-tree">
      {sortedChildren(root).map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          failed={failed}
          selected={selected}
          onSelect={onSelect}
          badges={badges}
        />
      ))}
    </div>
  )
}

export default FileTree