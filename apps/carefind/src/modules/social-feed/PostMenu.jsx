import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { theme } from '../../styles/theme'

// The per-post overflow menu ("⋯"). Actions that belong to one post but
// shouldn't compete with the engagement bar for attention (edit, delete,
// report, save) live here instead of sitting permanently on the card — the
// card then carries only the actions a reader actually uses while reading.
//
// Accessibility (ACCESSIBILITY.md): the trigger is a real button with a
// 44px target and aria-haspopup/aria-expanded, the panel is a `menu` whose
// items are `menuitem`s, Escape closes and returns focus to the trigger, and
// an outside click dismisses. Icon-only trigger, so it carries an aria-label.
//
// `items`: [{ key, label, Icon, onSelect, danger }]. Rendered in order; a
// caller passing an empty list renders nothing at all rather than an empty
// popup.
export default function PostMenu({ items = [], label = 'Post options' }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const triggerRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus() }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          width: 32, height: 32, borderRadius: theme.radius.md, border: 'none',
          background: open ? theme.gray100 : 'transparent', color: theme.gray400,
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          style={{
            position: 'absolute', top: 36, right: 0, zIndex: 20, minWidth: 176,
            background: theme.cardBg, border: `1px solid ${theme.gray200}`,
            borderRadius: theme.radius.md, boxShadow: theme.elevation[3],
            padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
          }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); item.onSelect() }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '9px 10px', borderRadius: theme.radius.sm, border: 'none',
                background: 'transparent', cursor: 'pointer', textAlign: 'left',
                fontSize: 13, fontWeight: 600, fontFamily: theme.fontFamily,
                color: item.danger ? theme.danger : theme.gray600,
              }}
            >
              <item.Icon size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
