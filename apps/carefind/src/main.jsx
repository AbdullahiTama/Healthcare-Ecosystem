import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import './styles/global.css'
import { initSentry, Sentry } from './lib/sentry'
import { QueryProvider } from './lib/queryClient.jsx'
import { AuthProvider } from './providers/AuthContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

initSentry()

import RequireAuth from './modules/account/RequireAuth.jsx'
import { CartProvider } from './modules/shop/CartProvider.jsx'
import { WishlistProvider } from './modules/shop/WishlistProvider.jsx'

const ForBusiness = lazy(() => import('./modules/marketing/ForBusiness.jsx'))
const About = lazy(() => import('./modules/marketing/About.jsx'))
const Feed = lazy(() => import('./modules/social-feed/Feed.jsx'))
const PostPage = lazy(() => import('./modules/social-feed/PostPage.jsx'))
const Search = lazy(() => import('./modules/healthcare-discovery/Search.jsx'))
const BusinessProfile = lazy(() => import('./modules/business-profiles-reviews/BusinessProfile.jsx'))
const Login = lazy(() => import('./modules/account/Login.jsx'))
const ResetPassword = lazy(() => import('./modules/account/ResetPassword.jsx'))
const Onboarding = lazy(() => import('./modules/account/Onboarding.jsx'))
const Profile = lazy(() => import('./modules/account/Profile.jsx'))
const PublicProfile = lazy(() => import('./PublicProfile.jsx'))
const SavedPosts = lazy(() => import('./modules/social-feed/SavedPosts.jsx'))
const VerifyProfessional = lazy(() => import('./modules/account/VerifyProfessional.jsx'))
const ClaimBusiness = lazy(() => import('./modules/claims/ClaimBusiness.jsx'))
const ClaimStaffPosition = lazy(() => import('./modules/claims/ClaimStaffPosition.jsx'))
const Dashboard = lazy(() => import('./modules/account/Dashboard.jsx'))
const BusinessDashboard = lazy(() => import('./modules/claims/BusinessDashboard.jsx'))
const ProfessionalDashboard = lazy(() => import('./modules/account/ProfessionalDashboard.jsx'))
const DrugProfile = lazy(() => import('./modules/healthcare-discovery/DrugProfile.jsx'))
const Wallet = lazy(() => import('./modules/wallet-payments/Wallet.jsx'))
const ProfessionalMonetization = lazy(() => import('./modules/subscriptions-monetization/ProfessionalMonetization.jsx'))
const News = lazy(() => import('./modules/news-publishing/News.jsx'))
const NewsArticle = lazy(() => import('./modules/news-publishing/NewsArticle.jsx'))
const LiveSession = lazy(() => import('./modules/live-streaming/LiveSession.jsx'))
const Notifications = lazy(() => import('./modules/account/Notifications.jsx'))
const LiveShow = lazy(() => import('./modules/live-streaming/LiveShow.jsx'))
const PlaylistCreate = lazy(() => import('./modules/playlists/PlaylistCreate.jsx'))
const PlaylistView = lazy(() => import('./modules/playlists/PlaylistView.jsx'))
const LiveDashboard = lazy(() => import('./modules/live-streaming/LiveDashboard.jsx'))
const Shop = lazy(() => import('./modules/shop/Shop.jsx'))
const ProductDetail = lazy(() => import('./modules/shop/ProductDetail.jsx'))
const Cart = lazy(() => import('./modules/shop/Cart.jsx'))
const Checkout = lazy(() => import('./modules/shop/Checkout.jsx'))
const OrderDetail = lazy(() => import('./modules/shop/OrderDetail.jsx'))
const OrderList = lazy(() => import('./modules/shop/OrderList.jsx'))
const Wishlist = lazy(() => import('./modules/shop/Wishlist.jsx'))
const Addresses = lazy(() => import('./modules/account/Addresses.jsx'))
const PublicTracking = lazy(() => import('./modules/shop/PublicTracking.jsx'))

const AdminPanel = lazy(() => import('./modules/admin/AdminPanel.jsx'))
const BusinessesHub = lazy(() => import('./modules/businesses-hub/BusinessesHub.jsx'))
const DashboardHub = lazy(() => import('./modules/dashboard-hub/DashboardHub.jsx'))
const AgentRegistration = lazy(() => import('./modules/agents-hub/AgentRegistration.jsx'))
const AgentApproval = lazy(() => import('./modules/agents-hub/AgentApproval.jsx'))
const AgentEarnings = lazy(() => import('./modules/agents-hub/AgentEarnings.jsx'))
const AgentTransfer = lazy(() => import('./modules/agents-hub/AgentTransfer.jsx'))
const AgentLogin = lazy(() => import('./pages/AgentLogin.jsx'))

// Business Directory & Discovery
const BusinessDirectoryPage = lazy(() => import('./modules/business-directory/BusinessDirectoryPage'))
const BusinessDiscoveryPage = lazy(() => import('./modules/business-discovery/BusinessDiscoveryPage'))

const Loading = () => (
  <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div className="cf-spinner" style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid #e2e8f0', borderTopColor: '#0E6F5A', animation: 'cf-spin 0.7s linear infinite' }} />
  </div>
)

const SuspenseWrapper = ({ children }) => (
  <Suspense fallback={<Loading />}>{children}</Suspense>
)

const RoutesWithKey = () => {
  const location = useLocation()
  return (
    <Routes key={location.key}>
      {/* Public — no login required */}
      <Route path="/" element={<SuspenseWrapper><ForBusiness /></SuspenseWrapper>} />
      <Route path="/about" element={<SuspenseWrapper><About /></SuspenseWrapper>} />
      <Route path="/feed" element={<SuspenseWrapper><Feed /></SuspenseWrapper>} />
      <Route path="/search" element={<SuspenseWrapper><Search /></SuspenseWrapper>} />
      <Route path="/shop" element={<Navigate to="/search?tab=shop" replace />} />
      <Route path="/shop/:productId" element={<SuspenseWrapper><ProductDetail /></SuspenseWrapper>} />
      <Route path="/business/:id" element={<SuspenseWrapper><BusinessProfile /></SuspenseWrapper>} />
      <Route path="/login" element={<SuspenseWrapper><Login /></SuspenseWrapper>} />
      <Route path="/reset-password" element={<SuspenseWrapper><ResetPassword /></SuspenseWrapper>} />
      <Route path="/u/:id" element={<SuspenseWrapper><PublicProfile /></SuspenseWrapper>} />
      <Route path="/post/:id" element={<SuspenseWrapper><PostPage /></SuspenseWrapper>} />
      <Route path="/drug/:name" element={<SuspenseWrapper><DrugProfile /></SuspenseWrapper>} />
      <Route path="/news" element={<SuspenseWrapper><News /></SuspenseWrapper>} />
      <Route path="/news/:id" element={<SuspenseWrapper><NewsArticle /></SuspenseWrapper>} />
      <Route path="/live/:id" element={<SuspenseWrapper><LiveSession /></SuspenseWrapper>} />
      <Route path="/live-show/:id" element={<SuspenseWrapper><LiveShow /></SuspenseWrapper>} />
      <Route path="/playlist/:id" element={<SuspenseWrapper><PlaylistView /></SuspenseWrapper>} />
      <Route path="/track/:token" element={<SuspenseWrapper><PublicTracking /></SuspenseWrapper>} />

      {/* Requires a logged-in consumer session */}
      <Route path="/onboarding" element={<SuspenseWrapper><RequireAuth><Onboarding /></RequireAuth></SuspenseWrapper>} />
      <Route path="/profile" element={<SuspenseWrapper><RequireAuth><Profile /></RequireAuth></SuspenseWrapper>} />
      <Route path="/saved" element={<SuspenseWrapper><RequireAuth><SavedPosts /></RequireAuth></SuspenseWrapper>} />
      <Route path="/verify" element={<SuspenseWrapper><RequireAuth><VerifyProfessional /></RequireAuth></SuspenseWrapper>} />
      <Route path="/claim-business" element={<SuspenseWrapper><RequireAuth><ClaimBusiness /></RequireAuth></SuspenseWrapper>} />
      <Route path="/claim-staff-position" element={<SuspenseWrapper><RequireAuth><ClaimStaffPosition /></RequireAuth></SuspenseWrapper>} />
      <Route path="/dashboard" element={<SuspenseWrapper><RequireAuth><Dashboard /></RequireAuth></SuspenseWrapper>} />
      <Route path="/business-dashboard" element={<SuspenseWrapper><RequireAuth><BusinessDashboard /></RequireAuth></SuspenseWrapper>} />
      <Route path="/professional-dashboard" element={<SuspenseWrapper><RequireAuth><ProfessionalDashboard /></RequireAuth></SuspenseWrapper>} />
      <Route path="/wallet" element={<SuspenseWrapper><RequireAuth><Wallet /></RequireAuth></SuspenseWrapper>} />
      <Route path="/earn" element={<SuspenseWrapper><RequireAuth><ProfessionalMonetization /></RequireAuth></SuspenseWrapper>} />
      <Route path="/notifications" element={<SuspenseWrapper><RequireAuth><Notifications /></RequireAuth></SuspenseWrapper>} />
      <Route path="/playlist/create" element={<SuspenseWrapper><RequireAuth><PlaylistCreate /></RequireAuth></SuspenseWrapper>} />
      <Route path="/playlist/:id/add" element={<SuspenseWrapper><RequireAuth><PlaylistCreate /></RequireAuth></SuspenseWrapper>} />
      <Route path="/playlist/:id/edit/:partId" element={<SuspenseWrapper><RequireAuth><PlaylistCreate /></RequireAuth></SuspenseWrapper>} />
      <Route path="/live-dashboard/:id" element={<SuspenseWrapper><RequireAuth><LiveDashboard /></RequireAuth></SuspenseWrapper>} />

      {/* Admin — accessible only via /login redirect */}
      <Route path="/admin-panel" element={<SuspenseWrapper><AdminPanel /></SuspenseWrapper>} />
      <Route path="/admin/businesses" element={<SuspenseWrapper><BusinessesHub /></SuspenseWrapper>} />
      <Route path="/admin/dashboard" element={<SuspenseWrapper><DashboardHub /></SuspenseWrapper>} />
      <Route path="/admin/agents" element={<SuspenseWrapper><AgentApproval /></SuspenseWrapper>} />
      <Route path="/admin/applications" element={<SuspenseWrapper><AgentApproval /></SuspenseWrapper>} />
      <Route path="/admin/earnings" element={<SuspenseWrapper><AgentEarnings /></SuspenseWrapper>} />
      <Route path="/admin/transfers" element={<SuspenseWrapper><AgentTransfer /></SuspenseWrapper>} />

      {/* Business Directory & Discovery */}
      <Route path="/business-directory" element={<SuspenseWrapper><BusinessDirectoryPage /></SuspenseWrapper>} />
      <Route path="/business-discovery" element={<SuspenseWrapper><BusinessDiscoveryPage /></SuspenseWrapper>} />

      {/* Agents */}
      <Route path="/agents/register" element={<SuspenseWrapper><AgentRegistration /></SuspenseWrapper>} />
      <Route path="/agents/approval" element={<SuspenseWrapper><AgentApproval /></SuspenseWrapper>} />
      <Route path="/agents/earnings" element={<SuspenseWrapper><AgentEarnings /></SuspenseWrapper>} />
      <Route path="/agents/transfer" element={<SuspenseWrapper><AgentTransfer /></SuspenseWrapper>} />
      <Route path="/agent-login" element={<SuspenseWrapper><AgentLogin /></SuspenseWrapper>} />

      {/* Shop — Cart & Checkout */}
      <Route path="/cart" element={<SuspenseWrapper><RequireAuth><Cart /></RequireAuth></SuspenseWrapper>} />
      <Route path="/checkout" element={<SuspenseWrapper><RequireAuth><Checkout /></RequireAuth></SuspenseWrapper>} />
      <Route path="/orders" element={<SuspenseWrapper><RequireAuth><OrderList /></RequireAuth></SuspenseWrapper>} />
      <Route path="/orders/:orderId" element={<SuspenseWrapper><RequireAuth><OrderDetail /></RequireAuth></SuspenseWrapper>} />
      <Route path="/wishlist" element={<SuspenseWrapper><RequireAuth><Wishlist /></RequireAuth></SuspenseWrapper>} />
      <Route path="/account/addresses" element={<SuspenseWrapper><RequireAuth><Addresses /></RequireAuth></SuspenseWrapper>} />
    </Routes>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary>
    <QueryProvider>
    <AuthProvider>
      <WishlistProvider>
      <CartProvider>
        <BrowserRouter>
          <ErrorBoundary>
            <RoutesWithKey />
          </ErrorBoundary>
        </BrowserRouter>
    </CartProvider>
    </WishlistProvider>
  </AuthProvider>
  </QueryProvider>
  </Sentry.ErrorBoundary>
</React.StrictMode>,
)
