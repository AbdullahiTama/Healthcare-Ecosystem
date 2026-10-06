import { Modal } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../styles/theme'

// One record, slid over the list. The shared Modal's drawer variant supplies
// the focus trap, Escape-to-close and focus return; it is full-width on a
// phone because it is capped at a max width, not given a fixed one.
export function DetailDrawer({ open, onClose, title, footer, children }) {
  return (
    <Modal show={open} onClose={onClose} title={title} variant="drawer" size="lg" footer={footer}>
      {children}
    </Modal>
  )
}

export function DetailField({ label, children }) {
  const empty = children === null || children === undefined || children === ''
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '9px 0', borderBottom: `1px solid ${theme.gray100}` }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: theme.textLight, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: theme.textDark, textAlign: 'right', overflowWrap: 'anywhere' }}>{empty ? '—' : children}</span>
    </div>
  )
}

export default DetailDrawer
