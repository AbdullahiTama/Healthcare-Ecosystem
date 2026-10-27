import { useNavigate } from 'react-router-dom'
import { theme } from '../../styles/theme'
import { usePlanStatus } from '../../hooks/usePlanStatus'
import { bannerText, seesPlanAlerts } from '../../lib/planStatus'
import PlanNotice from './PlanNotice'

const { danger, dangerBg, warning, warningBg } = theme

// The plan alert on every dashboard page, for the owner and managers, from 14 days before expiry, through the 7-day
// grace period and while the plan is restricted (lib/planStatus.js). It never blocks the page: an expired plan pauses
// adding staff, branches and products, imports and exports, but records stay readable and the POS keeps selling, so a
// pharmacy or hospital is never cut off from patients over a billing lapse. Also mounts the once-a-day popup.
export default function PlanExpiryBanner({ brand, role = 'Owner' }) {
  const navigate = useNavigate()
  const status = usePlanStatus()
  if (!seesPlanAlerts(role)) return null
  const text = bannerText(status)
  if (!text) return null

  const urgent = status.state === 'grace' || status.state === 'restricted'
  return (
    <>
      <button
        type='button'
        onClick={() => navigate('/dashboard/settings')}
        aria-label={`${text} Open Settings to renew.`}
        style={{
          width: '100%', padding: '8px 20px', textAlign: 'center', fontSize: '13px', fontWeight: '700', cursor: 'pointer', border: 'none',
          background: urgent ? dangerBg : warningBg, color: urgent ? danger : warning,
          borderBottom: `1px solid ${urgent ? danger : warning}`,
        }}
      >
        {text} <span aria-hidden='true'>Renew →</span>
      </button>
      <PlanNotice brandId={brand?.id} status={status} onRenew={() => navigate('/dashboard/settings')} />
    </>
  )
}
