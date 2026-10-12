import { useEffect, useRef } from 'react'
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import Logo from '../../social-feed/Logo'
import './shell.css'

// The section navigation. Desktop: a persistent rail that the admin can
// collapse to icons. Phones: an off-canvas panel opened from the topbar.
// `groups` arrive already filtered by the role's permissions.
export default function AdminNav({ groups, activeTab, onSelect, collapsed, onToggleCollapse, mobile, open, onClose }) {
  const closeRef = useRef(null)

  useEffect(() => {
    if (!mobile || !open) return undefined
    closeRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobile, open, onClose])

  if (mobile && !open) return null

  const rail = !mobile && collapsed
  const nav = (
    <nav className={`adm-nav${rail ? ' adm-nav--rail' : ''}`} aria-label="Admin sections">
      <div className="adm-nav-brand">
        <Logo size={rail ? 28 : 26} markOnly={rail} tone="dark" />
        {!rail && <small>Admin</small>}
        {mobile && (
          <button ref={closeRef} type="button" className="adm-icon-btn" style={{ marginLeft: 'auto' }} aria-label="Close navigation" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {groups.map(group => (
        <div className="adm-nav-group" key={group.id}>
          <h2>{group.label}</h2>
          {group.items.map(item => {
            const Icon = item.icon
            const active = activeTab === item.key
            return (
              <button
                key={item.key}
                type="button"
                className="adm-nav-item"
                aria-current={active ? 'page' : undefined}
                title={rail ? item.label : undefined}
                onClick={() => onSelect(item.key)}
              >
                <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
                {rail ? <span className="adm-sr">{item.label}</span> : <span className="adm-nav-label">{item.label}</span>}
              </button>
            )
          })}
        </div>
      ))}

      {!mobile && (
        <div className="adm-nav-foot">
          <button type="button" className="adm-nav-item" onClick={onToggleCollapse} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} title={collapsed ? 'Expand navigation' : undefined}>
            {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
            {!collapsed && <span className="adm-nav-label">Collapse</span>}
          </button>
        </div>
      )}
    </nav>
  )

  if (!mobile) return nav
  return (
    <>
      <div className="adm-overlay" onClick={onClose} aria-hidden="true" />
      <div className="adm-drawer-nav">{nav}</div>
    </>
  )
}
