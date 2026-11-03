import './Sidebar.css'

const ICONS = {
  'Add repos': 'M12 8v8M8 12h8M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  'Scorecards': 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5h6M9 13l2 2 4-4',
  'Judge questions': 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.4M12 16h.01',
}

function HackathonSidebar({ tabs, activeTab, onSelectTab }) {
  return (
    <div className="sidebar">
      {tabs.map((name) => (
        <div
          key={name}
          className={`sidebar-item ${activeTab === name ? 'active' : ''}`}
          onClick={() => onSelectTab(name)}
        >
          <svg className="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d={ICONS[name]} />
          </svg>
          <span>{name}</span>
        </div>
      ))}
    </div>
  )
}

export default HackathonSidebar