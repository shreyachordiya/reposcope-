import './Sidebar.css'

const tabs = [
  { name: 'Overview', icon: 'M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z' },
  { name: 'Architecture', icon: 'M12 3v4M6 21v-4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4M12 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
  { name: 'Dependencies', icon: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' },
  { name: 'Impact', icon: 'M12 2v20M2 12h20M12 2l4 4-4 4-4-4 4-4z' },
  { name: 'Security', icon: 'M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z' }
]

function Sidebar({ activeTab, onSelectTab }) {
  return (
    <div className="sidebar">
      {tabs.map((tab) => (
        <div
          key={tab.name}
          className={`sidebar-item ${activeTab === tab.name ? 'active' : ''}`}
          onClick={() => onSelectTab(tab.name)}
        >
          <svg className="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d={tab.icon} />
          </svg>
          <span>{tab.name}</span>
        </div>
      ))}
    </div>
  )
}

export default Sidebar