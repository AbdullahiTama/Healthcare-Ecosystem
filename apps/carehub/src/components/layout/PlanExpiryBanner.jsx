import { useNavigate } from 'react-router-dom'
import { theme } from '../../styles/theme'

const { danger, dangerBg, warning, warningBg } = theme

// Non-blocking by design (see the CareHub subscription design conversation):
// a hard lockout risks a hospital losing access to patient records mid-shift
// over a billing lapse, so this only ever nags, never restricts. Renders
// nothing outside the warning window.
export default function PlanExpiryBanner({ brand }) {
  const navigate = useNavigate()
  if (!brand?.plan_expires_at) return null

  const daysLeft = Math.ceil((new Date(brand.plan_expires_at) - new Date()) / 86400000)
  if (daysLeft > 7) return null

  const expired = daysLeft < 0
  return (
    <button
      onClick={() => navigate('/dashboard/settings')}
      style={{
        width: '100%', padding: '8px 20px', textAlign: 'center', fontSize: '13px', fontWeight: '700', cursor: 'pointer', border: 'none',
        background: expired ? dangerBg : warningBg, color: expired ? danger : warning,
        borderBottom: `1px solid ${expired ? danger : warning}`,
      }}
    >
      {expired
        ? `Your plan expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago — renew in Settings to keep your account in good standing.`
        : `Your plan renews in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — renew now in Settings.`}
      {' '}→
    </button>
  )
}
