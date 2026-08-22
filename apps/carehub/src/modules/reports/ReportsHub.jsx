import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { MODULES, slugToReportTab, getReportTabs, getReportDefaultTab, modulePath } from '../../lib/permissions'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import Reports from './Reports'
import AdrReportsList from '../adr/AdrReportsList'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, border } = theme

// Reports Hub (planning-artifacts/ux-designs/…/EXPERIENCE.md §2). The single
// /dashboard/reports route renders the role-filtered tab bar and mounts the
// active tab's module. Missing, unknown or forbidden :tab slugs redirect to the
// role's default tab instead of rendering a blank pane, and deep links keep
// working for bookmarks. Tab labels/subtitles come from the module registry so
// the hub never drifts from what the sidebar advertises.
export default function ReportsHub({ brand, role, customRoles = {}, ...pageProps }) {
  const { tab: tabSlug } = useParams()
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const bType = brand?.business_type || brand?.type || 'skincare'
  const tabs = getReportTabs(role, bType, customRoles)
  const defaultTab = getReportDefaultTab(role, bType, customRoles)
  const activeTab = tabSlug ? slugToReportTab[tabSlug] : defaultTab

  if (!defaultTab || !tabs.includes(activeTab)) {
    return <Navigate to={defaultTab ? modulePath(defaultTab) : '/dashboard'} replace />
  }

  const subtitles = {
    reports: 'Sales, expenses, purchases and VAT across your business',
    'adr-reports': 'Adverse drug reaction reporting with a 24-hour NAFDAC/PCN submission window',
  }

  return (
    <div>
      <div style={{ padding: isMobile ? '16px 16px 0' : '24px 24px 0' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: gray400, marginBottom: 6 }}>
          Intelligence &amp; Reporting
        </div>
        <div style={{ fontSize: '21px', fontWeight: 900, letterSpacing: '-0.02em', color: navy }}>
          {MODULES[activeTab].label}
        </div>
        <div style={{ fontSize: '12px', fontWeight: 600, color: gray500, marginTop: 4 }}>
          {subtitles[activeTab]}
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Reports"
        style={{ display: 'flex', gap: 4, marginTop: 18, padding: isMobile ? '0 16px' : '0 24px', borderBottom: `1px solid ${border}`, overflowX: 'auto' }}
      >
        {tabs.map(id => {
          const on = id === activeTab
          return (
            <button
              key={id}
              role="tab"
              aria-selected={on}
              onClick={() => navigate(modulePath(id))}
              style={{
                flexShrink: 0, padding: '10px 16px', fontSize: 13, fontWeight: on ? 800 : 600,
                color: on ? tealDeep : gray600, background: on ? tealMist : 'transparent',
                border: 'none', borderBottom: `2px solid ${on ? tealDeep : 'transparent'}`,
                cursor: 'pointer', borderRadius: '10px 10px 0 0', whiteSpace: 'nowrap',
              }}
            >
              {MODULES[id].label}
            </button>
          )
        })}
      </div>

      <div style={{ padding: isMobile ? '16px' : '24px' }}>
        {activeTab === 'reports' && <Reports {...pageProps} brand={brand} role={role} embedded />}
        {activeTab === 'adr-reports' && <AdrReportsList {...pageProps} brand={brand} embedded />}
      </div>
    </div>
  )
}