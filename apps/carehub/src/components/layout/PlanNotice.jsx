import { useEffect, useState } from 'react'
import { Modal, GhostBtn, TealBtn } from '../ui'
import { theme } from '../../styles/theme'
import { bannerText, wantsDailyNotice } from '../../lib/planStatus'

const { navy, gray600, bg } = theme

// Remembered per business and per day in this browser only. If storage is unavailable (private mode), the notice
// simply shows again next time; that is the safe direction.
const keyFor = (brandId) => `carehub.planNotice.${brandId}`
const today = () => new Date().toISOString().slice(0, 10)
function seenToday(brandId) {
  try { return localStorage.getItem(keyFor(brandId)) === today() } catch { return false }
}
function markSeen(brandId) {
  try { localStorage.setItem(keyFor(brandId), today()) } catch { /* not remembered: shown again next visit */ }
}

const TITLES = {
  expiring: 'Your plan expires soon',
  grace: 'Your plan has expired',
  restricted: 'Your plan has expired: some features are paused',
}

// The once-a-day popup for the owner and managers: the last 7 days before expiry, the grace period and while
// restricted (wantsDailyNotice). Rendered by PlanExpiryBanner, which already limits it to people who can act on it.
export default function PlanNotice({ brandId, status, onRenew }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (brandId && wantsDailyNotice(status) && !seenToday(brandId)) setOpen(true)
  }, [brandId, status?.state])

  if (!open) return null
  const close = () => { markSeen(brandId); setOpen(false) }
  const renew = () => { close(); onRenew() }

  return (
    <Modal show onClose={close} title={TITLES[status.state] || 'Your plan'}
      footer={<><GhostBtn onClick={close} style={{ flex: 1, padding: 12 }}>Remind me tomorrow</GhostBtn><TealBtn onClick={renew} style={{ flex: 1, padding: 12 }}>Renew now</TealBtn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13.5, color: navy, lineHeight: 1.6 }}>
        <p style={{ margin: 0 }}>{bannerText(status)}</p>
        {status.state === 'restricted' ? (
          <div style={{ padding: 12, borderRadius: theme.radius.md, background: bg, color: gray600, fontSize: 13 }}>
            <strong style={{ color: navy }}>Paused until you renew:</strong> adding staff, branches and products, imports, and exports.
            <br /><strong style={{ color: navy }}>Still working:</strong> the POS and sales, and viewing all your records.
          </div>
        ) : (
          <div style={{ padding: 12, borderRadius: theme.radius.md, background: bg, color: gray600, fontSize: 13 }}>
            If the plan is not renewed in time, adding staff, branches and products, imports and exports will be paused. Sales and your records are never affected.
          </div>
        )}
      </div>
    </Modal>
  )
}
