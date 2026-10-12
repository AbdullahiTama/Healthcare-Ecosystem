import { Modal, StatusBadge } from '@care-ecosystem/design-system/components/ui'

// The review drawer. Focus trap, Escape, and focus return are the shared
// Modal's contract; this adds the status badge and an inline error so a failed
// action is read where the admin is looking, with the drawer still open.
// `preventClose` stops Escape and the backdrop closing it: callers pass it while
// a confirmation is open on top, since every open Modal hears the same Escape.
export default function ReviewDrawer({ show, title, status, onClose, error, footer, preventClose, children }) {
  return (
    <Modal
      show={show}
      onClose={onClose}
      preventClose={preventClose}
      variant="drawer"
      size="lg"
      title={<span className="adm-drawer-title">{title}{status ? <StatusBadge status={status} /> : null}</span>}
      footer={footer}
    >
      {error ? <div role="alert" className="adm-drawer-error">{error}</div> : null}
      {children}
    </Modal>
  )
}
