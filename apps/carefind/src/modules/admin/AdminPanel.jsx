import { useState } from 'react'
import '../../styles/tokens.css'
import { AdminProvider, useAdmin } from './provider/AdminProvider.jsx'
import AdminShell from './shell/AdminShell.jsx'
import OverviewSection from './sections/OverviewSection.jsx'
import FeedRankingSection from './sections/FeedRankingSection.jsx'
import VerificationsSection from './sections/VerificationsSection.jsx'
import ClaimsSection from './sections/ClaimsSection.jsx'
import ReportsSection from './sections/ReportsSection.jsx'
import ModerationSection from './sections/ModerationSection.jsx'
import UsersSection from './sections/UsersSection.jsx'
import BusinessesSection from './sections/BusinessesSection.jsx'
import RevenueSection from './sections/RevenueSection.jsx'
import OrdersSection from './sections/OrdersSection.jsx'
import WithdrawalsSection from './sections/WithdrawalsSection.jsx'
import MoneyChecksSection from './sections/MoneyChecksSection.jsx'
import PostsSection from './sections/PostsSection.jsx'
import StoriesSection from './sections/StoriesSection.jsx'
import NewsSection from './sections/NewsSection.jsx'
import PromotionsSection from './sections/PromotionsSection.jsx'
import { ModerationProvider } from './stores/moderationStore'
import LegacyTabHost from './legacy/LegacyTabHost.jsx'
import { isAllowed } from './navigation'

// The admin console. AdminProvider verifies the session and holds what every
// screen shares; AdminShell is the navigation and topbar; each section below
// is a redesigned screen. Tabs that have not been redesigned yet are rendered
// by LegacyTabHost with the props they were written against.
function ActiveSection({ tab, setTab }) {
  const { permissions } = useAdmin()

  // A role that has this section switched off sees the dashboard instead. This
  // only tidies the UI; the server decides what any request may do.
  if (!isAllowed(permissions, tab)) return <OverviewSection permissions={permissions} onOpenTab={setTab} />

  if (tab === 'overview') return <OverviewSection permissions={permissions} onOpenTab={setTab} />
  if (tab === 'feed_ranking') return <FeedRankingSection />
  if (tab === 'verifications') return <VerificationsSection />
  if (tab === 'claims') return <ClaimsSection />
  if (tab === 'reports') return <ReportsSection />
  if (tab === 'moderation') return <ModerationProvider><ModerationSection /></ModerationProvider>
  if (tab === 'users') return <UsersSection />
  if (tab === 'businesses') return <BusinessesSection />
  if (tab === 'revenue') return <RevenueSection />
  if (tab === 'orders') return <OrdersSection />
  if (tab === 'withdrawals') return <WithdrawalsSection />
  if (tab === 'reconciliation') return <MoneyChecksSection />
  if (tab === 'posts') return <PostsSection />
  if (tab === 'stories') return <StoriesSection />
  if (tab === 'news') return <NewsSection />
  if (tab === 'promotions') return <PromotionsSection />
  return <LegacyTabHost tab={tab} setTab={setTab} />
}

export default function AdminPanel() {
  const [tab, setTab] = useState('overview')
  return (
    <AdminProvider>
      <AdminShell tab={tab} onTabChange={setTab}>
        <ActiveSection tab={tab} setTab={setTab} />
      </AdminShell>
    </AdminProvider>
  )
}
