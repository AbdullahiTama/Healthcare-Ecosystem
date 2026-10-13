import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

// AdminPanel's routing of the Phase 2a, 2b, 3, 4a, 4b and 5a tabs. The sections, the shell and
// the provider are stubbed so the test exercises only AdminPanel's own choice
// of section and its permission gate (`isAllowed` from the real navigation).
// The stub shell lists only what `visibleGroups` lets the role see, as the real
// AdminNav does.

const admin = vi.hoisted(() => ({ permissions: {} }))

vi.mock('./provider/AdminProvider.jsx', () => ({
  AdminProvider: ({ children }) => children,
  useAdmin: () => admin,
}))
vi.mock('./shell/AdminShell.jsx', async () => {
  const { visibleGroups } = await vi.importActual('./navigation')
  return {
    default: function StubShell({ onTabChange, children }) {
      const groups = visibleGroups(admin.permissions)
      return (
        <div>
          <nav aria-label="Admin sections">
            {groups.flatMap(g => g.items).map(item => (
              <button key={item.key} type="button" onClick={() => onTabChange(item.key)}>{item.label}</button>
            ))}
          </nav>
          <main>{children}</main>
        </div>
      )
    },
  }
})
vi.mock('./sections/OverviewSection.jsx', () => ({ default: () => <h1>Overview</h1> }))
vi.mock('./sections/FeedRankingSection.jsx', () => ({ default: () => <h1>Feed ranking</h1> }))
vi.mock('./sections/VerificationsSection.jsx', () => ({ default: () => <h1>Verification</h1> }))
vi.mock('./sections/ClaimsSection.jsx', () => ({ default: () => <h1>Claims</h1> }))
vi.mock('./sections/ReportsSection.jsx', () => ({ default: () => <h1>Reports</h1> }))
vi.mock('./sections/ModerationSection.jsx', () => ({ default: () => <h1>Moderation</h1> }))
vi.mock('./sections/UsersSection.jsx', () => ({ default: () => <h1>Users</h1> }))
vi.mock('./sections/BusinessesSection.jsx', () => ({ default: () => <h1>Businesses</h1> }))
vi.mock('./sections/RevenueSection.jsx', () => ({ default: () => <h1>Revenue</h1> }))
vi.mock('./sections/OrdersSection.jsx', () => ({ default: () => <h1>Orders</h1> }))
vi.mock('./sections/WithdrawalsSection.jsx', () => ({ default: () => <h1>Withdrawals</h1> }))
vi.mock('./sections/MoneyChecksSection.jsx', () => ({ default: () => <h1>Money checks</h1> }))
vi.mock('./sections/PostsSection.jsx', () => ({ default: () => <h1>Posts</h1> }))
vi.mock('./sections/StoriesSection.jsx', () => ({ default: () => <h1>Stories</h1> }))
vi.mock('./sections/NewsSection.jsx', () => ({ default: () => <h1>News</h1> }))
vi.mock('./sections/PromotionsSection.jsx', () => ({ default: () => <h1>Promotions</h1> }))
vi.mock('./sections/GoLiveSection.jsx', () => ({ default: () => <h1>Go Live</h1> }))
vi.mock('./sections/AlertsSection.jsx', () => ({ default: () => <h1>Notifications</h1> }))
vi.mock('./sections/AuditLogSection.jsx', () => ({ default: () => <h1>Audit log</h1> }))
vi.mock('./sections/SearchesSection.jsx', () => ({ default: () => <h1>Search Analytics</h1> }))
vi.mock('./sections/DrugIntelSection.jsx', () => ({ default: () => <h1>Drug Intelligence</h1> }))
vi.mock('./sections/ErrorsSection.jsx', () => ({ default: () => <h1>Error Inbox</h1> }))
vi.mock('./legacy/LegacyTabHost.jsx', () => ({ default: ({ tab }) => <h1>Legacy {tab}</h1> }))

import AdminPanel from './AdminPanel.jsx'

// Nav label -> the permission key, and the heading its section renders.
const TABS = [
  { nav: 'Verifications', key: 'verifications', heading: 'Verification' },
  { nav: 'Claims', key: 'claims', heading: 'Claims' },
  { nav: 'Reports', key: 'reports', heading: 'Reports' },
  { nav: 'Moderation queue', key: 'moderation', heading: 'Moderation' },
  { nav: 'Users', key: 'users', heading: 'Users' },
  { nav: 'Businesses', key: 'businesses', heading: 'Businesses' },
  { nav: 'Revenue', key: 'revenue', heading: 'Revenue' },
  { nav: 'Orders', key: 'orders', heading: 'Orders' },
  { nav: 'Withdrawals', key: 'withdrawals', heading: 'Withdrawals' },
  { nav: 'Money checks', key: 'reconciliation', heading: 'Money checks' },
  { nav: 'Posts', key: 'posts', heading: 'Posts' },
  { nav: 'Stories', key: 'stories', heading: 'Stories' },
  { nav: 'News', key: 'news', heading: 'News' },
  { nav: 'Promotions', key: 'promotions', heading: 'Promotions' },
  { nav: 'Go live', key: 'golive', heading: 'Go Live' },
  { nav: 'Alerts', key: 'notifications', heading: 'Notifications' },
  { nav: 'Audit log', key: 'audit_log', heading: 'Audit log' },
  { nav: 'Searches', key: 'searches', heading: 'Search Analytics' },
  { nav: 'Drug intel', key: 'drugs', heading: 'Drug Intelligence' },
  { nav: 'Errors', key: 'errors', heading: 'Error Inbox' },
]

const nav = () => within(screen.getByRole('navigation', { name: 'Admin sections' }))
const heading = () => screen.getByRole('heading', { level: 1 })

beforeEach(() => { admin.permissions = {} })

describe('AdminPanel: the Phase 2a, 2b, 3, 4a, 4b and 5a tabs', () => {
  it('starts on the Overview', () => {
    render(<AdminPanel />)
    expect(heading()).toHaveTextContent('Overview')
  })

  for (const tab of TABS) {
    it(`routes ${tab.key} to its own section, not the legacy host`, () => {
      render(<AdminPanel />)
      fireEvent.click(nav().getByRole('button', { name: tab.nav }))
      expect(heading()).toHaveTextContent(tab.heading)
      expect(screen.queryByText(/^Legacy /)).not.toBeInTheDocument()
    })

    it(`hides ${tab.key} from a role without it, and shows the Overview if it was open`, () => {
      const { rerender } = render(<AdminPanel />)
      fireEvent.click(nav().getByRole('button', { name: tab.nav }))
      expect(heading()).toHaveTextContent(tab.heading)

      // The role loses the tab while it is open (a refreshed permission set).
      admin.permissions = { [tab.key]: false }
      rerender(<AdminPanel />)
      expect(nav().queryByRole('button', { name: tab.nav })).not.toBeInTheDocument()
      expect(heading()).toHaveTextContent('Overview')
    })
  }
})
