import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './providers/AuthContext.jsx'
import RequireAuth from './RequireAuth.jsx'
import Feed from './modules/social-feed/Feed.jsx'
import Search from './modules/healthcare-discovery/Search.jsx'
import BusinessProfile from './modules/business-profiles-reviews/BusinessProfile.jsx'
import Login from './Login.jsx'
import Onboarding from './Onboarding.jsx'
import Profile from './Profile.jsx'
import PublicProfile from './PublicProfile.jsx'
import SavedPosts from './modules/social-feed/SavedPosts.jsx'
import VerifyProfessional from './VerifyProfessional.jsx'
import ClaimBusiness from './modules/claims/ClaimBusiness.jsx'
import ClaimStaffPosition from './modules/claims/ClaimStaffPosition.jsx'
import Dashboard from './Dashboard.jsx'
import BusinessDashboard from './modules/claims/BusinessDashboard.jsx'
import ProfessionalDashboard from './ProfessionalDashboard.jsx'
import DrugProfile from './modules/healthcare-discovery/DrugProfile.jsx'
import Wallet from './modules/wallet-payments/Wallet.jsx'
import ProfessionalMonetization from './modules/subscriptions-monetization/ProfessionalMonetization.jsx'
import AdminLogin from './modules/admin/AdminLogin.jsx'
import News from './modules/news-publishing/News.jsx'
import NewsArticle from './modules/news-publishing/NewsArticle.jsx'
import LiveSession from './modules/live-streaming/LiveSession.jsx'
import Notifications from './Notifications.jsx'
import LiveShow from './modules/live-streaming/LiveShow.jsx'
import PlaylistCreate from './modules/playlists/PlaylistCreate.jsx'
import PlaylistView from './modules/playlists/PlaylistView.jsx'
import LiveDashboard from './modules/live-streaming/LiveDashboard.jsx'

const AdminPanel = lazy(() => import('./modules/admin/AdminPanel.jsx'))

const Loading = () => (
  <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
    <p style={{ color: '#64748b' }}>Loading...</p>
  </div>
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public — no login required */}
          <Route path="/" element={<Feed />} />
          <Route path="/search" element={<Search />} />
          <Route path="/business/:id" element={<BusinessProfile />} />
          <Route path="/login" element={<Login />} />
          <Route path="/u/:id" element={<PublicProfile />} />
          <Route path="/drug/:name" element={<DrugProfile />} />
          <Route path="/news" element={<News />} />
          <Route path="/news/:id" element={<NewsArticle />} />
          <Route path="/live/:id" element={<LiveSession />} />
          <Route path="/live-show/:id" element={<LiveShow />} />
          <Route path="/playlist/:id" element={<PlaylistView />} />

          {/* Requires a logged-in consumer session */}
          <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="/saved" element={<RequireAuth><SavedPosts /></RequireAuth>} />
          <Route path="/verify" element={<RequireAuth><VerifyProfessional /></RequireAuth>} />
          <Route path="/claim-business" element={<RequireAuth><ClaimBusiness /></RequireAuth>} />
          <Route path="/claim-staff-position" element={<RequireAuth><ClaimStaffPosition /></RequireAuth>} />
          <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/business-dashboard" element={<RequireAuth><BusinessDashboard /></RequireAuth>} />
          <Route path="/professional-dashboard" element={<RequireAuth><ProfessionalDashboard /></RequireAuth>} />
          <Route path="/wallet" element={<RequireAuth><Wallet /></RequireAuth>} />
          <Route path="/earn" element={<RequireAuth><ProfessionalMonetization /></RequireAuth>} />
          <Route path="/notifications" element={<RequireAuth><Notifications /></RequireAuth>} />
          <Route path="/playlist/create" element={<RequireAuth><PlaylistCreate /></RequireAuth>} />
          <Route path="/playlist/:id/add" element={<RequireAuth><PlaylistCreate /></RequireAuth>} />
          <Route path="/playlist/:id/edit/:partId" element={<RequireAuth><PlaylistCreate /></RequireAuth>} />
          <Route path="/live-dashboard/:id" element={<RequireAuth><LiveDashboard /></RequireAuth>} />

          {/* Admin — separate session mechanism (admin_token), not the consumer `user` RequireAuth checks */}
          <Route path="/admin" element={<AdminLogin />} />
          <Route path="/admin-login" element={<AdminLogin />} />
          <Route path="/admin-panel" element={<Suspense fallback={<Loading />}><AdminPanel /></Suspense>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
)
