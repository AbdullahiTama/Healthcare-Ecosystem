import { Flag } from 'lucide-react'
import { Modal } from '../../components/ui'
import { theme } from '../../styles/theme'
import { REPORT_REASONS } from './postSelectors.js'

// The reason picker, shared by every surface that can report a post: the feed,
// the /post/:id page and the in-feed overlay. All three rendered this same
// Modal with the same copy and the same reason buttons.
//
// `postId` doubles as the open/closed state — there is no picker without a post
// to report — and is handed back to `onSubmit` so the caller never has to keep
// its own copy of which post the open dialog belongs to.
export default function ReportDialog({ postId, onClose, onSubmit, busy = false, sheet = false }) {
  return (
    <Modal show={!!postId} onClose={onClose} title="Report this post" sheet={sheet}>
      <p style={{ margin: '0 0 14px 0', fontSize: 13, color: theme.gray600, lineHeight: 1.6 }}>
        Tell us what&apos;s wrong with it. Our moderation team reviews every report: the author isn&apos;t told who reported them.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {REPORT_REASONS.map((reason) => (
          <button
            key={reason}
            type="button"
            onClick={() => onSubmit(postId, reason)}
            disabled={busy}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44,
              padding: '11px 14px', borderRadius: theme.radius.md,
              border: `1px solid ${theme.gray200}`, background: '#fff',
              fontSize: 13, fontWeight: 700, color: theme.navy, fontFamily: theme.fontFamily,
              cursor: busy ? 'wait' : 'pointer', textAlign: 'left',
            }}
          >
            <Flag size={16} color={theme.gray400} aria-hidden="true" />
            {reason}
          </button>
        ))}
      </div>
    </Modal>
  )
}
