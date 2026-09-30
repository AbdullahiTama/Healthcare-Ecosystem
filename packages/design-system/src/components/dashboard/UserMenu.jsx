import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { theme } from '../../theme'
import { Avatar } from '../ui/Avatar'

// UserMenu — identity + account actions, one implementation for the three
// places both apps currently hand-roll it (CareHub Sidebar footer, CareHub
// TopBar avatar/role pill, CareFind AdminSidebar user chip).
//
// Keyboard: trigger is aria-haspopup="menu"/aria-expanded; opening moves focus
// to the first item, ArrowUp/ArrowDown cycle, Escape closes and returns focus
// to the trigger, and a click outside closes. With no `items` it degrades to a
// static identity chip (no menu semantics on a control that opens nothing).
export function UserMenu({ name, role, avatar, items = [], align = 'right', collapsed = false, triggerLabel, className, style = {} }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const menuId = useId()
  const hasItems = items.length > 0

  useEffect(() => {
    if (!open || !hasItems) return undefined
    const onDocMouseDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        if (triggerRef.current) triggerRef.current.focus()
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, hasItems])

  useEffect(() => {
    if (!open || !hasItems || !rootRef.current) return
    const first = rootRef.current.querySelector('[role="menuitem"]')
    if (first) first.focus()
  }, [open, hasItems])

  const onMenuKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const nodes = [...e.currentTarget.querySelectorAll('[role="menuitem"]:not([disabled])')]
    if (!nodes.length) return
    e.preventDefault()
    const i = nodes.indexOf(document.activeElement)
    const next = e.key === 'ArrowDown'
      ? nodes[(i + 1) % nodes.length]
      : nodes[(i - 1 + nodes.length) % nodes.length]
    next.focus()
  }

  const trigger = hasItems ? (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      aria-label={triggerLabel || `Account menu for ${name || 'user'}`}
      onClick={() => setOpen((o) => !o)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.space[4],
        maxWidth: 220,
        padding: '5px 8px',
        borderRadius: theme.radius.md,
        background: open ? theme.tealMist : 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontFamily: theme.fontFamily,
        transition: `background ${theme.motion.fast} ${theme.motion.easeOut}`,
      }}
    >
      <TriggerBody name={name} role={role} avatar={avatar} collapsed={collapsed} />
      <ChevronDown
        size={14}
        aria-hidden="true"
        color={theme.gray500}
        style={{ transform: open ? 'rotate(180deg)' : 'none', transition: `transform ${theme.motion.fast} ${theme.motion.easeOut}`, flexShrink: 0 }}
      />
    </button>
  ) : (
    <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[4], maxWidth: 220, padding: '5px 8px' }}>
      <TriggerBody name={name} role={role} avatar={avatar} collapsed={collapsed} />
    </div>
  )

  return (
    <div ref={rootRef} className={className} style={{ position: 'relative', ...style }}>
      {trigger}
      {open && hasItems && (
        <div
          id={menuId}
          role="menu"
          aria-label={`${name || 'Account'} menu`}
          onKeyDown={onMenuKeyDown}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            [align]: 0,
            minWidth: 210,
            padding: theme.space[4],
            background: 'white',
            border: `1px solid ${theme.border}`,
            borderRadius: theme.radius.md,
            boxShadow: theme.elevation[3],
            zIndex: 40,
          }}
        >
          {items.map((item, i) => (
            item.separator
              ? <div key={`sep-${i}`} role="separator" style={{ height: 1, background: theme.hairline, margin: `${theme.space[4]}px 0` }} />
              : (
                <button
                  key={item.label || i}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false)
                    if (item.onClick) item.onClick()
                  }}
                  onMouseEnter={(e) => { if (!item.disabled) e.currentTarget.style.background = theme.tealMist }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: theme.space[6],
                    width: '100%',
                    minHeight: 40,
                    padding: `0 ${theme.space[5]}px`,
                    borderRadius: theme.radius.sm,
                    background: 'transparent',
                    border: 'none',
                    cursor: item.disabled ? 'not-allowed' : 'pointer',
                    color: item.danger ? theme.danger : theme.textDark,
                    fontSize: theme.type.body.size,
                    fontWeight: 600,
                    textAlign: 'left',
                    fontFamily: theme.fontFamily,
                    opacity: item.disabled ? 0.5 : 1,
                  }}
                >
                  {item.icon && <span aria-hidden="true" style={{ display: 'flex', color: item.danger ? theme.danger : theme.gray500 }}>{item.icon}</span>}
                  {item.label}
                </button>
              )
          ))}
        </div>
      )}
    </div>
  )
}

function TriggerBody({ name, role, avatar, collapsed }) {
  return (
    <>
      <Avatar name={name} src={avatar} size={32} />
      {!collapsed && (
        <span style={{ minWidth: 0, textAlign: 'left' }}>
          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: theme.textDark, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
          {role && (
            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: theme.textLight, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {role}
            </span>
          )}
        </span>
      )}
    </>
  )
}

export default UserMenu
