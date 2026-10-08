import { theme } from '../../theme'
import { Modal } from './Modal'
import { Button } from './Button'

// Unified confirmation dialog (Stage 3 / 3.3). SCREEN_PATTERNS.md pattern 29:
// reserved for irreversible actions, states the specific consequence, Cancel is
// always default-focused (the destructive button is never auto-focused). Not a
// generic "Are you sure?" — `consequence` is required so callers state what
// will actually happen. Backdrop and Escape can't close it; only the explicit
// footer actions can.
export function ConfirmDialog({ show, onClose, onConfirm, title, consequence, confirmLabel = 'Delete', danger = true }) {
  return (
    <Modal show={show} onClose={onClose} title={title} preventBackdropClose hideCloseButton footer={
      <>
        <Button variant="ghost" size="sm" onClick={onClose} style={{ flex: 1 }}>Cancel</Button>
        {danger
          ? <Button variant="danger" size="md" onClick={onConfirm} style={{ flex: 1 }}>{confirmLabel}</Button>
          : <Button variant="primary" size="md" onClick={onConfirm} style={{ flex: 1 }}>{confirmLabel}</Button>}
      </>
    }>
      <div role="alertdialog" style={{ fontSize: 13, color: theme.gray600, lineHeight: 1.6 }}>{consequence}</div>
    </Modal>
  )
}

export default ConfirmDialog