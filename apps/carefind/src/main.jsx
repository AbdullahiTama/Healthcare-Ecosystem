import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './styles/global.css'
import { initSentry, Sentry } from './lib/sentry'
import { QueryProvider } from './lib/queryClient.jsx'
import { AuthProvider } from './providers/AuthContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

initSentry()
import RequireAuth from './modules/account/RequireAuth.jsx'
import Feed from './modules/social-feed/Feed.jsx'
import PostPage from './modules/social-feed/PostPage.jsx'
import Search from './modules/healthcare-discovery/Search.jsx'
import BusinessProfile from './modules/business-profiles-reviews/BusinessProfile.jsx'
import Login from './modules/account/Login.jsx'
import ResetPassword from './modules/account/ResetPassword.jsx'
import Onboarding from './modules/account/Onboarding.jsx'
import Profile from './modules/account/Profile.jsx'
import PublicProfile from './PublicProfile.jsx'
import SavedPosts from './modules/social-feed/SavedPosts.jsx'
import VerifyProfessional from './modules/account/VerifyProfessional.jsx'
import ClaimBusiness from './modules/claims/ClaimBusiness.jsx'
import ClaimStaffPosition from './modules/claims/ClaimStaffPosition.jsx'
import Dashboard from './modules/account/Dashboard.jsx'
import BusinessDashboard from './modules/claims/BusinessDashboard.jsx'
import ProfessionalDashboard from './modules/account/ProfessionalDashboard.jsx'
import DrugProfile from './modules/healthcare-discovery/DrugProfile.jsx'
import Wallet from './modules/wallet-payments/Wallet.jsx'
import ProfessionalMonetization from './modules/subscriptions-monetization/ProfessionalMonetization.jsx'
import AdminLogin from './modules/admin/AdminLogin.jsx'
import News from './modules/news-publishing/News.jsx'
import NewsArticle from './modules/news-publishing/NewsArticle.jsx'
import LiveSession from './modules/live-streaming/LiveSession.jsx'
import Notifications from './modules/account/Notifications.jsx'
import LiveShow from './modules/live-streaming/LiveShow.jsx'
import PlaylistCreate from './modules/playlists/PlaylistCreate.jsx'
import PlaylistView from './modules/playlists/PlaylistView.jsx'
import LiveDashboard from './modules/live-streaming/LiveDashboard.jsx'
import ForBusiness from './modules/marketing/ForBusiness.jsx'
import About from './modules/marketing/About.jsx'
import Shop from './modules/shop/Shop.jsx'
import ProductDetail from './modules/shop/ProductDetail.jsx'
import Cart from './modules/shop/Cart.jsx'
import Checkout from './modules/shop/Checkout.jsx'
import OrderDetail from './modules/shop/OrderDetail.jsx'
import OrderList from './modules/shop/OrderList.jsx'
import Wishlist from './modules/shop/Wishlist.jsx'
import Addresses from './modules/account/Addresses.jsx'
import PublicTracking from './modules/shop/PublicTracking.jsx'
import { CartProvider } from './modules/shop/CartProvider.jsx'
import { WishlistProvider } from './modules/shop/WishlistProvider.jsx'

const AdminPanel = lazy(() => import('./modules/admin/AdminPanel.jsx'))
const BusinessesHub = lazy(() => import('./modules/businesses-hub/BusinessesHub.jsx'))
const DashboardHub = lazy(() => import('./modules/dashboard-hub/DashboardHub.jsx'))
const AgentRegistration = lazy(() => import('./modules/agents-hub/AgentRegistration.jsx'))
const AgentApproval = lazy(() => import('./modules/agents-hub/AgentApproval.jsx'))
const AgentEarnings = lazy(() => import('./modules/agents-hub/AgentEarnings.jsx'))
const AgentTransfer = lazy(() => import('./modules/agents-hub/AgentTransfer.jsx'))
const AgentLogin = lazy(() => import('./pages/AgentLogin.jsx'))

const Loading = () => (
  <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div className="cf-spinner" style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid #e2e8f0', borderTopColor: '#0E6F5A', animation: 'cf-spin 0.7s linear infinite' }} />
  </div>
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary>
    <QueryProvider>
    <AuthProvider>
      <WishlistProvider>
      <CartProvider>
        <BrowserRouter>
          <ErrorBoundary>
            <Routes>
            {/* Public — no login required */}
            <Route path="/" element={<ForBusiness />} />
            <Route path="/about" element={<About />} />
            <Route path="/feed" element={<Feed />} />
            <Route path="/search" element={<Search />} />
            <Route path="/shop" element={<Navigate to="/search?tab=shop" replace />} />
            <Route path="/shop/:productId" element={<ProductDetail />} />
            <Route path="/business/:id" element={<BusinessProfile />} />
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/u/:id" element={<PublicProfile />} />
            <Route path="/post/:id" element={<PostPage />} />
            <Route path="/drug/:name" element={<DrugProfile />} />
            <Route path="/news" element={<News />} />
            <Route path="/news/:id" element={<NewsArticle />} />
            <Route path="/live/:id" element={<LiveSession />} />
            <Route path="/live-show/:id" element={<LiveShow />} />
            <Route path="/playlist/:id" element={<PlaylistView />} />
            <Route path="/track/:token" element={<PublicTracking />} />

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
            <Route path="/admin/businesses" element={<Suspense fallback={<Loading />}><BusinessesHub /></Suspense>} />
            <Route path="/admin/dashboard" element={<Suspense fallback={<Loading />}><DashboardHub /></Suspense>} />
            <Route path="/admin/agents" element={<Suspense fallback={<Loading />}><AgentApproval /></Suspense>} />
            <Route path="/admin/applications" element={<Suspense fallback={<Loading />}><AgentApproval /></Suspense>} />
            <Route path="/admin/earnings" element={<Suspense fallback={<Loading />}><AgentEarnings /></Suspense>} />
            <Route path="/admin/transfers" element={<Suspense fallback={<Loading />}><AgentTransfer /></Suspense>} />

            {/* Agents — self-registration + self-service portal */}
            <Route path="/agents/register" element={<Suspense fallback={<Loading />}><AgentRegistration /></Suspense>} />
            <Route path="/agents/approval" element={<Suspense fallback={<Loading />}><AgentApproval /></Suspense>} />
            <Route path="/agents/earnings" element={<Suspense fallback={<Loading />}><AgentEarnings /></Suspense>} />
            <Route path="/agents/transfer" element={<Suspense fallback={<Loading />}><AgentTransfer /></Suspense>} />
            <Route path="/agent-login" element={<Suspense fallback={<Loading />}><AgentLogin /></Suspense>} />

            {/* Shop Cart & Checkout - requires auth */}
            <Route path="/cart" element={<RequireAuth><Cart /></RequireAuth>} />
            <Route path="/checkout" element={<RequireAuth><Checkout /></RequireAuth>} />
            <Route path="/orders" element={<RequireAuth><OrderList /></RequireAuth>} />
            <Route path="/orders/:orderId" element={<RequireAuth><OrderDetail /></RequireAuth>} />
            <Route path="/wishlist" element={<RequireAuth><Wishlist /></RequireAuth>} />
            <Route path="/account/addresses" element={<RequireAuth><Addresses /></RequireAuth>} />
          </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </CartProvider>
    </WishlistProvider>
  </AuthProvider>
  </QueryProvider>
  </Sentry.ErrorBoundary>
</React.StrictMode>,
)
