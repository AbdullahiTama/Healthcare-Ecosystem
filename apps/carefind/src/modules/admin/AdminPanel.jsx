import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import { callAdminAuth } from './adminApi'
import AdminLayout from './AdminLayout.jsx'
import AdminShop from './AdminShop.jsx'
import { ConfirmDialog, Loading, Toast, useToast } from '../../components/ui'
import { NAV_GROUPS } from './AdminSidebar.jsx'

import OverviewTab from './tabs/OverviewTab.jsx'
import VerificationsTab from './tabs/VerificationsTab.jsx'
import ClaimsTab from './tabs/ClaimsTab.jsx'
import ReportsTab from './tabs/ReportsTab.jsx'
import UsersTab from './tabs/UsersTab.jsx'
import PostsTab from './tabs/PostsTab.jsx'
import RevenueTab from './tabs/RevenueTab.jsx'
import DrugsTab from './tabs/DrugsTab.jsx'
import TasksTab from './tabs/TasksTab.jsx'
import TeamsTab from './tabs/TeamsTab.jsx'
import WithdrawalsTab from './tabs/WithdrawalsTab.jsx'
import BusinessesTab from './tabs/BusinessesTab.jsx'
import StoriesTab from './tabs/StoriesTab.jsx'
import NewsTab from './tabs/NewsTab.jsx'
import PromotionsTab from './tabs/PromotionsTab.jsx'
import SearchesTab from './tabs/SearchesTab.jsx'
import GoLiveTab from './tabs/GoLiveTab.jsx'
import NotificationsTab from './tabs/NotificationsTab.jsx'

const ALL_TABS = NAV_GROUPS.flatMap(g => g.items)

function timeAgo(d) {
  if (!d) return 'Never'
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function AdminPanel() {
  const navigate = useNavigate()
  const [adminUser, setAdminUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')
  const [stats, setStats] = useState({})
  const [users, setUsers] = useState([])
  const [verifications, setVerifications] = useState([])
  // Credential review: which document is being signed, and any failure to
  // report inline against that row.
  const [credentialLoadingId, setCredentialLoadingId] = useState(null)
  const [credentialError, setCredentialError] = useState({ id: null, message: '' })
  const [claims, setClaims] = useState([])
  const [reports, setReports] = useState([])
  const [posts, setPosts] = useState([])
  const [transactions, setTransactions] = useState([])
  const [tasks, setTasks] = useState([])
  const [teams, setTeams] = useState([])
  const [staff, setStaff] = useState([])
  const [userSearch, setUserSearch] = useState('')
  const [postSearch, setPostSearch] = useState('')
  const [drugSearch, setDrugSearch] = useState('')
  const [drugReviews, setDrugReviews] = useState([])
  const [drugName, setDrugName] = useState('')
  const [drugRatingFilter, setDrugRatingFilter] = useState('all')
  const [drugDateFrom, setDrugDateFrom] = useState('')
  const [drugDateTo, setDrugDateTo] = useState('')
  const [postTypeFilter, setPostTypeFilter] = useState('all')
  const [postDateFrom, setPostDateFrom] = useState('')
  const [postDateTo, setPostDateTo] = useState('')
  const [userVerifiedFilter, setUserVerifiedFilter] = useState('all')
  const [userSpecialtyFilter, setUserSpecialtyFilter] = useState('')
  const [reportStatusFilter, setReportStatusFilter] = useState('pending')
  const [selectedUser, setSelectedUser] = useState(null)
  const [suspendDays, setSuspendDays] = useState('7')
  const [userPosts, setUserPosts] = useState([])
  const [deletingUser, setDeletingUser] = useState(false)
  const [businesses, setBusinesses] = useState([])
  const [bizSearch, setBizSearch] = useState('')
  const [bizTypeFilter, setBizTypeFilter] = useState('all')
  const [bizStateFilter, setBizStateFilter] = useState('')
  const [bizStatusFilter, setBizStatusFilter] = useState('all')
  const [selectedBiz, setSelectedBiz] = useState(null)
  const [bizReviews, setBizReviews] = useState([])
  const [bizProducts, setBizProducts] = useState([])
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [taskComp, setTaskComp] = useState('')
  const [taskSpec, setTaskSpec] = useState('')
  const [savingTask, setSavingTask] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [staffEmail, setStaffEmail] = useState('')
  const [staffPass, setStaffPass] = useState('')
  const [staffName, setStaffName] = useState('')
  const [staffRole, setStaffRole] = useState('moderator')
  const [staffTeam, setStaffTeam] = useState('')
  const [savingStaff, setSavingStaff] = useState(false)
  const [staffMsg, setStaffMsg] = useState('')
  const [verifyingUser, setVerifyingUser] = useState(null)
  const [verifySpecialty, setVerifySpecialty] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [notifCount, setNotifCount] = useState(0)
  const [roleNotifCount, setRoleNotifCount] = useState(0)
  const [withdrawals, setWithdrawals] = useState([])
  const [notifications, setNotifications] = useState([])
  const [stories, setStories] = useState([])
  const [storyTitle, setStoryTitle] = useState('')
  const [storyBody, setStoryBody] = useState('')
  const [storyBg, setStoryBg] = useState('#0E6F5A')
  const [storyImageFile, setStoryImageFile] = useState(null)
  const [savingStory, setSavingStory] = useState(false)
  const [newsItems, setNewsItems] = useState([])
  const [editingNews, setEditingNews] = useState(null)
  const [newsPhones, setNewsPhones] = useState({})
  const [savingNews, setSavingNews] = useState(false)
  const [promotions, setPromotions] = useState([])
  const [promoTitle, setPromoTitle] = useState('')
  const [promoLink, setPromoLink] = useState('')
  const [promoDays, setPromoDays] = useState('7')
  const [promoImage, setPromoImage] = useState(null)
  const [savingPromo, setSavingPromo] = useState(false)
  const [searchLogs, setSearchLogs] = useState([])
  const [ecomApps, setEcomApps] = useState([])
  const [ecomProductsAdmin, setEcomProductsAdmin] = useState([])
  const [shopOrdersAdmin, setShopOrdersAdmin] = useState([])
  const [liveTitle, setLiveTitle] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [trailerFile, setTrailerFile] = useState(null)
  const [scheduledShows, setScheduledShows] = useState([])
  const [liveGuests, setLiveGuests] = useState([])
  const [activeShows, setActiveShows] = useState([])
  const [creatingShow, setCreatingShow] = useState(false)
  const [guestSearch, setGuestSearch] = useState('')
  const [liveItems, setLiveItems] = useState([])
  const [liveStats, setLiveStats] = useState({ likes: 0, views: 0, shares: 0, gifts: 0 })
  const [liveComments, setLiveComments] = useState([])
  const [liveDraft, setLiveDraft] = useState('')
  const [liveImage, setLiveImage] = useState(null)
  const [postingLive, setPostingLive] = useState(false)
  const [selectedPost, setSelectedPost] = useState(null)
  const [postAuthor, setPostAuthor] = useState(null)
  const [phoneMap, setPhoneMap] = useState({})
  const [adminPermissions, setAdminPermissions] = useState({})
  const [adminRoles, setAdminRoles] = useState([])
  const [newRoleName, setNewRoleName] = useState('')
  const [newRoleDesc, setNewRoleDesc] = useState('')
  const [newRoleTabs, setNewRoleTabs] = useState({})
  const [editingRoleId, setEditingRoleId] = useState(null)
  const [editingRoleTabs, setEditingRoleTabs] = useState({})
  const [savingRole, setSavingRole] = useState(false)
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()
  // Generic confirmation-dialog state: { title, consequence, confirmLabel, action }.
  // `action` is the real, destructive operation — deferred until the admin confirms
  // (SCREEN_PATTERNS.md pattern 29: never a bare "Are you sure?", state the consequence).
  const [confirmState, setConfirmState] = useState(null)
  function askConfirm({ title, consequence, confirmLabel = 'Delete', action }) {
    setConfirmState({ title, consequence, confirmLabel, action })
  }

  useEffect(() => {
    try {
      const token = localStorage.getItem('admin_token')
      const userData = localStorage.getItem('admin_user')
      const permsData = localStorage.getItem('admin_permissions')
      if (!token || !userData) { navigate('/admin'); return }
      const decoded = atob(token)
      const parts = decoded.split('|')
      if (parts.length !== 3 || Date.now() - parseInt(parts[2]) > 86400000) {
        localStorage.removeItem('admin_token')
        localStorage.removeItem('admin_user')
        localStorage.removeItem('admin_permissions')
        navigate('/admin')
        return
      }
      const parsedAdmin = JSON.parse(userData)
      setAdminUser(parsedAdmin)
      if (permsData) setAdminPermissions(JSON.parse(permsData))
      loadAll()
    } catch { navigate('/admin') }

    // Auto-refresh notifications every 30 seconds
    const interval = setInterval(() => {
      loadAll()
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  async function loadAll() {
    // Load posts and profiles separately to isolate any failures
    const postsRes = await supabase.from('posts').select('id, content, post_type, created_at, user_id').order('created_at', { ascending: false }).limit(50)
    const usersRes2 = await supabase.from('profiles').select('id, full_name, display_name, is_verified, verification_label, specialty, location, website, created_at, cover_url').order('created_at', { ascending: false }).limit(100)
    if (usersRes2.data) setUsers(usersRes2.data)

    const adminToken = localStorage.getItem('admin_token')
    const [usersRes, verifRes, claimsRes, reportsRes, txRes, tasksRes, teamsRes, bizRes, staffRes, withdrawRes, taskSubRes, consultRes, newsRes] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      callAdminAuth('list_verification_requests', { token: adminToken }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
      callAdminAuth('list_business_claims', { token: adminToken }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
      callAdminAuth('list_reports', { token: adminToken }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
      callAdminAuth('list_transactions', { token: adminToken }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
      supabase.from('tasks').select('*').order('created_at', { ascending: false }),
      callAdminAuth('list_teams', { token: adminToken }).then(r => ({ data: r.teams })).catch(() => ({ data: [] })),
      supabase.from('businesses').select('id, name, business_type, city, state, whatsapp, visible_on_carefind, created_at').order('created_at', { ascending: false }).limit(100),
      callAdminAuth('list_staff', { token: adminToken }).then(r => ({ data: r.staff })).catch(() => ({ data: [] })),
      callAdminAuth('list_withdrawal_requests', { token: adminToken }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
      callAdminAuth('list_task_submissions', { token: adminToken }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
      supabase.from('professional_consultations').select('*, profiles!professional_consultations_professional_id_fkey(full_name, display_name)').eq('status', 'paid').order('created_at', { ascending: false }).limit(20),
      callAdminAuth('list_news', { token: adminToken }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
    ])
    setVerifications(verifRes.data || [])
    // Build phone lookup: user_id -> phone (from verification requests)
    const pm = {}
    ;(verifRes.data || []).forEach(v => { if (v.user_id && v.phone) pm[v.user_id] = v.phone })
    setPhoneMap(pm)
    setClaims(claimsRes.data || [])
    setReports(reportsRes.data || [])
    setPosts(postsRes.data || [])
    setTransactions(txRes.data || [])
    setTasks(tasksRes.data || [])
    setTeams(teamsRes.data || [])
    setStaff(staffRes.data || [])
    setWithdrawals(withdrawRes.data || [])

    // Build notification feed
    const allNotifs = [
      ...(verifRes.data || []).filter(v => v.status === 'pending').map(v => ({ id: v.id, type: 'verification', icon: '🩺', title: `Verification request from ${v.full_name}`, subtitle: v.profession, time: v.created_at, severity: 'warning', tab: 'verifications', role: 'verification_officer' })),
      ...(claimsRes.data || []).filter(c => c.status === 'pending').map(c => ({ id: c.id, type: 'claim', icon: '🏥', title: `Business claim: ${c.businesses?.name}`, subtitle: 'Pending approval', time: c.created_at, severity: 'warning', tab: 'claims', role: 'business_manager' })),
      ...(reportsRes.data || []).filter(r => r.status === 'pending').map(r => ({ id: r.id, type: 'report', icon: '🚩', title: `Post reported: ${r.reason}`, subtitle: r.posts?.content?.slice(0, 60), time: r.created_at, severity: 'urgent', tab: 'reports', role: 'moderator' })),
      ...(withdrawRes.data || []).filter(w => w.status === 'pending').map(w => ({ id: w.id, type: 'withdrawal', icon: '💰', title: `Withdrawal request: ₦${(w.amount * 200).toLocaleString()}`, subtitle: w.profiles?.full_name || 'User', time: w.created_at, severity: 'warning', tab: 'withdrawals', role: 'super_admin' })),
      ...(taskSubRes.data || []).filter(s => s.status === 'pending').map(s => ({ id: s.id, type: 'task', icon: '📋', title: `Task submission: ${s.tasks?.title}`, subtitle: s.profiles?.full_name || 'Professional', time: s.created_at, severity: 'info', tab: 'tasks', role: 'super_admin' })),
      ...(consultRes.data || []).map(c => ({ id: c.id, type: 'consultation', icon: '📅', title: 'New consultation booking', subtitle: c.profiles?.full_name || 'Professional', time: c.created_at, severity: 'info', tab: 'overview', role: 'verification_officer' })),
      ...(newsRes.data || []).filter(n => n.status === 'pending').map(n => ({ id: n.id, type: 'news', icon: '📰', title: `News submission: ${(n.headline || 'New article').slice(0, 60)}`, subtitle: n.profiles?.full_name || n.profiles?.display_name || 'Contributor', time: n.created_at, severity: 'warning', tab: 'news', role: 'super_admin' })),
    ].sort((a, b) => new Date(b.time) - new Date(a.time))

    setNotifications(allNotifs)
    setBusinesses(bizRes.data || [])
    const rev = (txRes.data || []).filter(t => t.type === 'topup').reduce((s, t) => s + (t.naira_amount || 0), 0)
    const pendingVerifs = (verifRes.data || []).filter(v => v.status === 'pending').length
    const pendingClaims = (claimsRes.data || []).filter(c => c.status === 'pending').length
    const openReports = (reportsRes.data || []).filter(r => r.status === 'pending').length

    setStats({
      users: usersRes.count ?? usersRes2.data?.length ?? 0,
      posts: postsRes.data?.length || 0,
      pendingVerifs,
      pendingClaims,
      reports: openReports,
      revenue: rev / 100,
      transactions: txRes.data?.length || 0,
    })

    const pendingWithdrawals = (withdrawRes.data || []).filter(w => w.status === 'pending').length
    const pendingTaskSubs = (taskSubRes.data || []).filter(s => s.status === 'pending').length
    const newConsults = (consultRes.data || []).length
    const pendingNews = (newsRes.data || []).filter(n => n.status === 'pending').length

    // Super admin sees all notifications
    const totalNotifs = pendingVerifs + pendingClaims + openReports + pendingWithdrawals + pendingTaskSubs + pendingNews
    setNotifCount(totalNotifs)

    // Role-specific notifications
    const role = JSON.parse(localStorage.getItem('admin_user') || '{}').role || ''
    if (role === 'super_admin') setRoleNotifCount(totalNotifs)
    else if (role === 'verification_officer') setRoleNotifCount(pendingVerifs + newConsults)
    else if (role === 'business_manager') setRoleNotifCount(pendingClaims)
    else if (role === 'moderator' || role === 'content_manager') setRoleNotifCount(openReports + pendingNews)
    else if (role === 'analytics_manager') setRoleNotifCount(pendingWithdrawals)
    else setRoleNotifCount(pendingNews ? pendingNews : 0)

    setLoading(false)
  }

  useEffect(() => { if (adminUser) { loadStories(); loadNews(); loadPromotions(); loadSearchLogs(); loadActiveShows(); loadShopAdmin(); loadAdminRoles() } }, [adminUser])

  async function loadAdminRoles() {
    try {
      const { data } = await callAdminAuth('list_admin_roles', { token: localStorage.getItem('admin_token') })
      setAdminRoles(data || [])
    } catch { setAdminRoles([]) }
  }

  async function loadShopAdmin() {
    try {
      const token = localStorage.getItem('admin_token')
      const [appsRes, prodsRes, ordersRes] = await Promise.all([
        callAdminAuth('list_ecommerce_applications', { token }).catch(()=>({ data: [] })),
        callAdminAuth('list_ecommerce_products_admin', { token }).catch(()=>({ data: [] })),
        callAdminAuth('list_shop_orders_admin', { token }).catch(()=>({ data: [] })),
      ])
      setEcomApps(appsRes.data || [])
      setEcomProductsAdmin(prodsRes.data || [])
      setShopOrdersAdmin(ordersRes.data || [])
    } catch { /* ignore */ }
  }
  async function updateEcomApp(id, status) {
    try {
      await callAdminAuth('update_ecommerce_application', { token: localStorage.getItem('admin_token'), id, status })
      showToast(`Application ${status}`, { type: 'success' }); loadShopAdmin()
    } catch (e) { showToast(e.message, { type: 'error' }) }
  }
  async function moderateProduct(id, patch) {
    try {
      await callAdminAuth('moderate_ecommerce_product', { token: localStorage.getItem('admin_token'), id, ...patch })
      showToast('Product updated', { type: 'success' }); loadShopAdmin()
    } catch (e) { showToast(e.message, { type: 'error' }) }
  }

  async function loadActiveShows() {
    const { data } = await supabase
      .from('live_shows')
      .select('id, title, status, started_at, host_id')
      .eq('status', 'live')
      .order('started_at', { ascending: false })
    setActiveShows(data || [])
    const { data: sched } = await supabase
      .from('live_shows')
      .select('id, title, status, scheduled_at, trailer_url, host_id')
      .eq('status', 'scheduled')
      .order('scheduled_at', { ascending: true })
    setScheduledShows(sched || [])
  }

  async function scheduleShow() {
    if (!liveTitle.trim()) { showToast('Add a show title', { type: 'warning' }); return }
    if (!scheduledAt) { showToast('Pick a date & time for the show', { type: 'warning' }); return }
    setCreatingShow(true)
    let trailerUrl = null
    if (trailerFile) {
      const ext = trailerFile.name.split('.').pop() || 'mp4'
      const path = `trailer-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('live-media').upload(path, trailerFile, { contentType: trailerFile.type || 'video/mp4' })
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('live-media').getPublicUrl(path)
        trailerUrl = urlData.publicUrl
      }
    }
    try {
      await callAdminAuth('schedule_show', {
        token: localStorage.getItem('admin_token'),
        title: liveTitle.trim(),
        scheduledAt,
        trailerUrl,
        guestIds: liveGuests.map(g => g.id),
      })
    } catch (err) {
      showToast(`Couldn't schedule the show: ${err.message}`, { type: 'error' })
      setCreatingShow(false)
      return
    }
    setLiveTitle(''); setScheduledAt(''); setTrailerFile(null); setLiveGuests([]); setGuestSearch('')
    setCreatingShow(false)
    loadActiveShows()
    showToast('Show scheduled! It will show a countdown to your audience. Tap "Start Now" when you\'re ready to go live.', { type: 'success' })
  }

  async function startScheduledShow(showId) {
    try {
      await callAdminAuth('start_scheduled_show', { token: localStorage.getItem('admin_token'), showId })
      loadActiveShows()
      showToast('You are now LIVE!', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't start the show: ${err.message}`, { type: 'error' })
    }
  }

  function cancelScheduledShow(showId) {
    askConfirm({
      title: 'Cancel this scheduled show?',
      consequence: 'This cancels the scheduled show and removes its countdown from the audience view. Invited guests will need to be re-added if you reschedule it.',
      confirmLabel: 'Cancel Show',
      action: () => reallyCancelScheduledShow(showId),
    })
  }
  async function reallyCancelScheduledShow(showId) {
    try {
      await callAdminAuth('cancel_scheduled_show', { token: localStorage.getItem('admin_token'), showId })
      loadActiveShows()
      showToast('Scheduled show cancelled', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't cancel the show: ${err.message}`, { type: 'error' })
    }
  }

  function toggleGuest(u) {
    setLiveGuests(prev => prev.some(g => g.id === u.id) ? prev.filter(g => g.id !== u.id) : [...prev, u])
  }

  async function startLiveShow() {
    if (!liveTitle.trim()) { showToast('Add a show title', { type: 'warning' }); return }
    setCreatingShow(true)
    // Admin login isn't a profile row, so host_id stays null and we mark it a platform show.
    try {
      await callAdminAuth('start_live_show', {
        token: localStorage.getItem('admin_token'),
        title: liveTitle.trim(),
        guestIds: liveGuests.map(g => g.id),
      })
    } catch (err) {
      showToast(`Couldn't start the show: ${err.message}`, { type: 'error' })
      setCreatingShow(false)
      return
    }
    setLiveTitle(''); setLiveGuests([]); setGuestSearch('')
    setCreatingShow(false)
    loadActiveShows()
    showToast('Live show started! Open the Control Room to begin posting.', { type: 'success' })
  }

  function endLiveShow(showId) {
    askConfirm({
      title: 'End this live show?',
      consequence: 'This immediately ends the live broadcast for everyone watching. The show cannot be resumed once ended.',
      confirmLabel: 'End Show',
      action: () => reallyEndLiveShow(showId),
    })
  }
  async function reallyEndLiveShow(showId) {
    try {
      await callAdminAuth('end_live_show', { token: localStorage.getItem('admin_token'), showId })
      loadActiveShows()
      showToast('Live show ended', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't end the show: ${err.message}`, { type: 'error' })
    }
  }

  async function loadLiveControl(showId) {
    const [itemsRes, commentsRes, likeRes, shareRes, viewRes, giftRes] = await Promise.all([
      supabase.from('live_items').select('id, kind, content, created_at').eq('show_id', showId).order('created_at', { ascending: false }),
      supabase.from('live_comments').select('id, content, hidden, created_at, profiles(full_name, display_name)').eq('show_id', showId).order('created_at', { ascending: false }).limit(60),
      supabase.from('live_reactions').select('id', { count: 'exact', head: true }).eq('show_id', showId),
      supabase.from('live_shares').select('id', { count: 'exact', head: true }).eq('show_id', showId),
      supabase.from('live_views').select('id', { count: 'exact', head: true }).eq('show_id', showId),
      supabase.from('gifts').select('coins').eq('post_id', showId),
    ])
    setLiveItems(itemsRes.data || [])
    setLiveComments(commentsRes.data || [])
    setLiveStats({
      likes: likeRes.count || 0,
      shares: shareRes.count || 0,
      views: viewRes.count || 0,
      gifts: (giftRes.data || []).reduce((s, g) => s + (g.coins || 0), 0),
    })
  }

  async function postLiveItem(showId) {
    if (!liveDraft.trim() && !liveImage) return
    setPostingLive(true)
    const token = localStorage.getItem('admin_token')
    if (liveImage) {
      const ext = liveImage.name.split('.').pop()
      const path = `live-${showId}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('live-media').upload(path, liveImage)
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('live-media').getPublicUrl(path)
        await callAdminAuth('post_live_item', { token, showId, kind: 'image', content: urlData.publicUrl }).catch(err => showToast(`Couldn't post the image: ${err.message}`, { type: 'error' }))
      }
      setLiveImage(null)
    }
    if (liveDraft.trim()) {
      await callAdminAuth('post_live_item', { token, showId, kind: 'text', content: liveDraft.trim() }).catch(err => showToast(`Couldn't post: ${err.message}`, { type: 'error' }))
      setLiveDraft('')
    }
    setPostingLive(false)
    loadLiveControl(showId)
  }

  async function hideLiveComment(cid, showId) {
    try {
      await callAdminAuth('hide_live_comment', { token: localStorage.getItem('admin_token'), id: cid })
      loadLiveControl(showId)
    } catch (err) {
      showToast(`Couldn't hide the comment: ${err.message}`, { type: 'error' })
    }
  }

  async function postLiveVoice(showId, url) {
    await callAdminAuth('post_live_item', { token: localStorage.getItem('admin_token'), showId, kind: 'voice', content: url }).catch(err => showToast(`Couldn't post the voice note: ${err.message}`, { type: 'error' }))
    loadLiveControl(showId)
  }

  async function postLiveSlide(showId, url, num, total) {
    await callAdminAuth('post_live_item', { token: localStorage.getItem('admin_token'), showId, kind: 'slide', content: `${url}|||${num}|||${total}` }).catch(err => showToast(`Couldn't post the slide: ${err.message}`, { type: 'error' }))
    loadLiveControl(showId)
  }

  async function postLiveVideo(showId, url) {
    await callAdminAuth('post_live_item', { token: localStorage.getItem('admin_token'), showId, kind: 'video', content: url }).catch(err => showToast(`Couldn't post the video: ${err.message}`, { type: 'error' }))
    loadLiveControl(showId)
  }

  async function loadSearchLogs() {
    try {
      const { data } = await callAdminAuth('list_search_logs', { token: localStorage.getItem('admin_token') })
      setSearchLogs(data || [])
    } catch {
      setSearchLogs([])
    }
  }

  async function loadPromotions() {
    const { data } = await supabase.from('promotions').select('*').order('created_at', { ascending: false })
    setPromotions(data || [])
  }

  async function createPromotion() {
    if (!promoTitle.trim()) { showToast('Add a title', { type: 'warning' }); return }
    setSavingPromo(true)
    let imageUrl = null
    if (promoImage) {
      const ext = promoImage.name.split('.').pop()
      const path = `promo-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('promo-images').upload(path, promoImage)
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('promo-images').getPublicUrl(path)
        imageUrl = urlData.publicUrl
      }
    }
    try {
      await callAdminAuth('create_promotion', {
        token: localStorage.getItem('admin_token'),
        title: promoTitle.trim(),
        linkUrl: promoLink.trim() || null,
        imageUrl,
        days: promoDays,
      })
      setPromoTitle(''); setPromoLink(''); setPromoDays('7'); setPromoImage(null)
      loadPromotions()
      showToast('Promotion created', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't create the promotion: ${err.message}`, { type: 'error' })
    }
    setSavingPromo(false)
  }

  function deletePromotion(id) {
    askConfirm({
      title: 'Delete this promotion?',
      consequence: 'This permanently removes the promotion from the app. This cannot be undone.',
      confirmLabel: 'Delete',
      action: () => reallyDeletePromotion(id),
    })
  }
  async function reallyDeletePromotion(id) {
    try {
      await callAdminAuth('delete_promotion', { token: localStorage.getItem('admin_token'), id })
      loadPromotions()
      showToast('Promotion deleted', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't delete the promotion: ${err.message}`, { type: 'error' })
    }
  }

  async function viewUserDetails(u) {
    setSelectedUser(u)
    const { data } = await supabase.from('posts').select('id, content, post_type, created_at').eq('user_id', u.id).order('created_at', { ascending: false }).limit(10)
    setUserPosts(data || [])
  }

  async function loadStories() {
    const { data } = await supabase.from('stories').select('*').order('created_at', { ascending: false })
    setStories(data || [])
  }

  async function loadNews() {
    try {
      const { data, phones } = await callAdminAuth('list_news', { token: localStorage.getItem('admin_token') })
      setNewsItems(data || [])
      setNewsPhones(phones || {})
    } catch (err) {
      const msg = err?.message || ''
      const isAuth = msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('invalid or expired token') || msg.toLowerCase().includes('no token')
      if (isAuth) {
        showToast('Session expired, re-login', { type: 'error' })
      } else {
        showToast(`Could not load news: ${msg}`, { type: 'error' })
      }
      setNewsItems([])
    }
  }

  async function approveNews(item) {
    setSavingNews(true)
    const edits = editingNews && editingNews.id === item.id
      ? { headline: editingNews.headline, subtitle: editingNews.subtitle, body: editingNews.body }
      : {}
    try {
      await callAdminAuth('approve_news', { token: localStorage.getItem('admin_token'), id: item.id, edits })
      showToast('News item approved', { type: 'success' })
      // Optimistic update so UI reflects immediately even before reload
      setNewsItems(prev => prev.map(n => n.id === item.id ? { ...n, ...edits, status: 'approved', published_at: new Date().toISOString() } : n))
    } catch (err) {
      showToast(`Couldn't approve the news item: ${err.message}`, { type: 'error' })
    }
    setEditingNews(null)
    setSavingNews(false)
    loadNews()
    loadAll()
  }

  async function rejectNews(id) {
    try {
      await callAdminAuth('reject_news', { token: localStorage.getItem('admin_token'), id })
      showToast('News item rejected', { type: 'success' })
      setNewsItems(prev => prev.map(n => n.id === id ? { ...n, status: 'rejected' } : n))
    } catch (err) {
      showToast(`Couldn't reject the news item: ${err.message}`, { type: 'error' })
    }
    setEditingNews(null)
    loadNews()
    loadAll()
  }

  function deleteNews(id) {
    askConfirm({
      title: 'Permanently delete this news item?',
      consequence: 'This permanently removes the news item from the app. This cannot be undone.',
      confirmLabel: 'Delete',
      action: () => reallyDeleteNews(id),
    })
  }
  async function reallyDeleteNews(id) {
    try {
      await callAdminAuth('delete_news', { token: localStorage.getItem('admin_token'), id })
      setNewsItems(prev => prev.filter(n => n.id !== id))
      showToast('News item deleted', { type: 'success' })
      loadNews()
      loadAll()
    } catch (err) {
      showToast(`Couldn't delete the news item: ${err.message}`, { type: 'error' })
    }
  }

  async function createStory() {
    if (!storyTitle.trim() && !storyBody.trim() && !storyImageFile) return
    setSavingStory(true)
    let imageUrl = null
    if (storyImageFile) {
      const ext = storyImageFile.name.split('.').pop()
      const path = `story-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('story-images').upload(path, storyImageFile)
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('story-images').getPublicUrl(path)
        imageUrl = urlData.publicUrl
      }
    }
    try {
      await callAdminAuth('create_story', {
        token: localStorage.getItem('admin_token'),
        title: storyTitle.trim() || null,
        body: storyBody.trim() || null,
        imageUrl,
        bgColor: storyBg,
      })
      setStoryTitle(''); setStoryBody(''); setStoryBg('#0E6F5A'); setStoryImageFile(null)
      loadStories()
      showToast('Story published', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't create the story: ${err.message}`, { type: 'error' })
    }
    setSavingStory(false)
  }

  function deleteStory(id) {
    askConfirm({
      title: 'Delete this story?',
      consequence: 'This permanently removes the story from the feed. This cannot be undone.',
      confirmLabel: 'Delete',
      action: () => reallyDeleteStory(id),
    })
  }
  async function reallyDeleteStory(id) {
    try {
      await callAdminAuth('delete_story', { token: localStorage.getItem('admin_token'), id })
      loadStories()
      showToast('Story deleted', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't delete the story: ${err.message}`, { type: 'error' })
    }
  }

  async function viewPostDetails(p) {
    setSelectedPost(p)
    setPostAuthor(null)
    if (p.user_id) {
      const { data } = await supabase.from('profiles').select('id, full_name, display_name, is_verified, verification_label, cover_url').eq('id', p.user_id).single()
      setPostAuthor(data || null)
    }
  }

  async function suspendUser(userId, days) {
    try {
      await callAdminAuth('suspend_user', { token: localStorage.getItem('admin_token'), userId, days })
      setSelectedUser(null)
      loadAll()
      showToast(`User suspended for ${days} days`, { type: 'success' })
    } catch (err) {
      showToast(`Couldn't suspend the user: ${err.message}`, { type: 'error' })
    }
  }

  function deleteUser(userId) {
    const name = selectedUser?.full_name || selectedUser?.display_name || 'this user'
    askConfirm({
      title: 'Delete this user?',
      consequence: `This permanently deletes ${name}'s account and all their posts, comments, and content. This cannot be undone.`,
      confirmLabel: 'Delete',
      action: () => reallyDeleteUser(userId),
    })
  }
  async function reallyDeleteUser(userId) {
    setDeletingUser(true)
    try {
      await callAdminAuth('delete_user', { token: localStorage.getItem('admin_token'), userId })
      showToast('User deleted', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't delete the user: ${err.message}`, { type: 'error' })
    }
    setSelectedUser(null)
    setDeletingUser(false)
    loadAll()
  }

  // Resolve a private credential document to a short-lived signed URL and
  // open it. The admin API holds the service-role key; the browser never does.
  async function openCredential(requestId) {
    setCredentialLoadingId(requestId)
    setCredentialError({ id: null, message: '' })

    // The tab is opened SYNCHRONOUSLY, inside the click's user-activation
    // window, and pointed at the signed URL once it arrives. Calling
    // window.open() after the await is blocked by Chrome and Safari, which
    // would look like the button doing nothing at all.
    const tab = window.open('', '_blank', 'noopener,noreferrer')
    try {
      const { url } = await callAdminAuth('credential_url', { token: localStorage.getItem('admin_token'), requestId })
      if (tab) {
        tab.location = url
      } else {
        // Popups blocked entirely — hand the reviewer a link rather than
        // failing silently.
        setCredentialError({ id: requestId, message: 'Your browser blocked the document window. Allow popups for this site and try again.' })
      }
    } catch (err) {
      if (tab) tab.close()
      setCredentialError({ id: requestId, message: `Could not open the document: ${err.message}` })
    } finally {
      setCredentialLoadingId(null)
    }
  }

  async function approveVerif(id, userId, profession) {
    try {
      await callAdminAuth('approve_verification', { token: localStorage.getItem('admin_token'), id, userId, profession })
      loadAll()
      showToast('Verification approved', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't approve the verification: ${err.message}`, { type: 'error' })
    }
  }

  async function rejectVerif(id) {
    try {
      await callAdminAuth('reject_verification', { token: localStorage.getItem('admin_token'), id })
      loadAll()
      showToast('Verification rejected', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't reject the verification: ${err.message}`, { type: 'error' })
    }
  }

  async function approveClaim(id, businessId) {
    try {
      await callAdminAuth('approve_claim', { token: localStorage.getItem('admin_token'), claimId: id, businessId })
      loadAll()
      showToast('Claim approved', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't approve the claim: ${err.message}`, { type: 'error' })
    }
  }

  async function rejectClaim(id) {
    try {
      await callAdminAuth('reject_claim', { token: localStorage.getItem('admin_token'), claimId: id })
      loadAll()
      showToast('Claim rejected', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't reject the claim: ${err.message}`, { type: 'error' })
    }
  }

  function deletePost(id) {
    askConfirm({
      title: 'Delete this post?',
      consequence: 'This permanently deletes the post along with its likes and comments. This cannot be undone.',
      confirmLabel: 'Delete',
      action: () => reallyDeletePost(id),
    })
  }
  async function reallyDeletePost(id) {
    try {
      await callAdminAuth('delete_post', { token: localStorage.getItem('admin_token'), id })
      loadAll()
      showToast('Post deleted', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't delete the post: ${err.message}`, { type: 'error' })
    }
  }

  async function resolveReport(id) {
    try {
      await callAdminAuth('resolve_report', { token: localStorage.getItem('admin_token'), id })
      loadAll()
      showToast('Report resolved', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't resolve the report: ${err.message}`, { type: 'error' })
    }
  }

  async function manualVerify(userId, specialty) {
    if (!specialty) return
    try {
      await callAdminAuth('manual_verify', { token: localStorage.getItem('admin_token'), userId, specialty })
      setVerifyingUser(null)
      setVerifySpecialty('')
      loadAll()
      showToast('User verified', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't verify the user: ${err.message}`, { type: 'error' })
    }
  }

  async function searchDrugs() {
    if (!drugSearch.trim()) return
    const { data: products } = await supabase.from('products').select('id, name').ilike('name', `%${drugSearch}%`).limit(5)
    if (!products?.length) { setDrugReviews([]); return }
    setDrugName(products[0].name)
    const { data: reviews } = await supabase.from('product_reviews').select('*').in('product_id', products.map(p => p.id)).order('created_at', { ascending: false })
    setDrugReviews(reviews || [])
  }

  async function createTask() {
    if (!taskTitle || !taskDesc || !taskComp) return
    setSavingTask(true)
    try {
      await callAdminAuth('create_task', { token: localStorage.getItem('admin_token'), title: taskTitle, description: taskDesc, compensation: taskComp, specialty: taskSpec || null })
      setTaskTitle(''); setTaskDesc(''); setTaskComp(''); setTaskSpec('')
      showToast('Task created', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't create the task: ${err.message}`, { type: 'error' })
    }
    setSavingTask(false); loadAll()
  }

  async function createStaff(e) {
    e.preventDefault(); setSavingStaff(true); setStaffMsg('')
    try {
      await callAdminAuth('create_staff', {
        token: localStorage.getItem('admin_token'),
        newEmail: staffEmail.toLowerCase(), newPassword: staffPass,
        newName: staffName, newRole: staffRole, teamId: staffTeam || null,
      })
      setStaffMsg('Staff account created!')
      setStaffName(''); setStaffEmail(''); setStaffPass(''); setStaffRole('moderator'); setStaffTeam('')
      loadAll()
    } catch (err) {
      setStaffMsg('Error: ' + err.message)
    }
    setSavingStaff(false)
  }

  async function createTeam(e) {
    e.preventDefault()
    try {
      await callAdminAuth('create_team', { token: localStorage.getItem('admin_token'), name: teamName })
      setTeamName(''); loadAll()
    } catch (err) {
      setStaffMsg('Error: ' + err.message)
    }
  }

  function exportCSV(data, filename) {
    if (!data.length) return
    const keys = Object.keys(data[0])
    const csv = [keys.join(','), ...data.map(row => keys.map(k => `"${(row[k] || '').toString().replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click()
  }

  if (loading) return <Loading fullScreen />

  const card = { border: `1px solid ${theme.border}`, borderRadius: theme.radius.lg, padding: 14, background: theme.cardBg, marginBottom: 10 }
  const input = { width: '100%', padding: 10, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, boxSizing: 'border-box', background: theme.bg, color: theme.textDark }

  function handleSignOut() {
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_user')
    localStorage.removeItem('admin_permissions')
    navigate('/admin')
  }

  return (
    <AdminLayout
      activeTab={tab}
      onTabChange={setTab}
      adminUser={adminUser}
      permissions={adminPermissions}
      notifCount={roleNotifCount}
      onSignOut={handleSignOut}
    >
      <>
        {tab === 'overview' && <OverviewTab stats={stats} setTab={setTab} posts={posts} users={users} transactions={transactions} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} />}
        {tab === 'verifications' && <VerificationsTab verifications={verifications} openCredential={openCredential} credentialLoadingId={credentialLoadingId} credentialError={credentialError} approveVerif={approveVerif} rejectVerif={rejectVerif} />}
        {tab === 'claims' && <ClaimsTab claims={claims} approveClaim={approveClaim} rejectClaim={rejectClaim} />}
        {tab === 'reports' && <ReportsTab reports={reports} deletePost={deletePost} resolveReport={resolveReport} />}
        {tab === 'users' && <UsersTab users={users} selectedUser={selectedUser} setSelectedUser={setSelectedUser} userSearch={userSearch} setUserSearch={setUserSearch} userVerifiedFilter={userVerifiedFilter} setUserVerifiedFilter={setUserVerifiedFilter} userSpecialtyFilter={userSpecialtyFilter} setUserSpecialtyFilter={setUserSpecialtyFilter} phoneMap={phoneMap} viewUserDetails={viewUserDetails} suspendDays={suspendDays} setSuspendDays={setSuspendDays} suspendUser={suspendUser} deleteUser={deleteUser} deletingUser={deletingUser} userPosts={userPosts} verifyingUser={verifyingUser} setVerifyingUser={setVerifyingUser} verifySpecialty={verifySpecialty} setVerifySpecialty={setVerifySpecialty} manualVerify={manualVerify} adminUser={adminUser} />}
        {tab === 'posts' && <PostsTab posts={posts} selectedPost={selectedPost} setSelectedPost={setSelectedPost} postAuthor={postAuthor} setPostAuthor={setPostAuthor} postSearch={postSearch} setPostSearch={setPostSearch} postTypeFilter={postTypeFilter} setPostTypeFilter={setPostTypeFilter} postDateFrom={postDateFrom} setPostDateFrom={setPostDateFrom} postDateTo={postDateTo} setPostDateTo={setPostDateTo} viewPostDetails={viewPostDetails} deletePost={deletePost} />}
        {tab === 'revenue' && <RevenueTab transactions={transactions} />}
        {tab === 'drugs' && <DrugsTab drugSearch={drugSearch} setDrugSearch={setDrugSearch} drugReviews={drugReviews} drugName={drugName} setDrugName={setDrugName} drugRatingFilter={drugRatingFilter} setDrugRatingFilter={setDrugRatingFilter} drugDateFrom={drugDateFrom} setDrugDateFrom={setDrugDateFrom} drugDateTo={drugDateTo} setDrugDateTo={setDrugDateTo} searchDrugs={searchDrugs} />}
        {tab === 'tasks' && <TasksTab tasks={tasks} taskTitle={taskTitle} setTaskTitle={setTaskTitle} taskDesc={taskDesc} setTaskDesc={setTaskDesc} taskComp={taskComp} setTaskComp={setTaskComp} taskSpec={taskSpec} setTaskSpec={setTaskSpec} savingTask={savingTask} createTask={createTask} />}
        {tab === 'teams' && <TeamsTab teams={teams} staff={staff} teamName={teamName} setTeamName={setTeamName} createTeam={createTeam} staffName={staffName} setStaffName={setStaffName} staffEmail={staffEmail} setStaffEmail={setStaffEmail} staffPass={staffPass} setStaffPass={setStaffPass} staffRole={staffRole} setStaffRole={setStaffRole} staffTeam={staffTeam} setStaffTeam={setStaffTeam} savingStaff={savingStaff} staffMsg={staffMsg} setStaffMsg={setStaffMsg} createStaff={createStaff} adminUser={adminUser} adminRoles={adminRoles} newRoleName={newRoleName} setNewRoleName={setNewRoleName} newRoleDesc={newRoleDesc} setNewRoleDesc={setNewRoleDesc} newRoleTabs={newRoleTabs} setNewRoleTabs={setNewRoleTabs} editingRoleId={editingRoleId} setEditingRoleId={setEditingRoleId} editingRoleTabs={editingRoleTabs} setEditingRoleTabs={setEditingRoleTabs} savingRole={savingRole} loadAdminRoles={loadAdminRoles} showToast={showToast} ALL_TABS={ALL_TABS} />}
        {tab === 'withdrawals' && <WithdrawalsTab withdrawals={withdrawals} onApprove={async (id) => { try { await callAdminAuth('approve_withdrawal', { token: localStorage.getItem('admin_token'), id }); loadAll(); showToast('Withdrawal approved', { type: 'success' }) } catch (err) { showToast(`Couldn't approve the withdrawal: ${err.message}`, { type: 'error' }) } }} onReject={async (id) => { try { await callAdminAuth('reject_withdrawal', { token: localStorage.getItem('admin_token'), id }); loadAll(); showToast('Withdrawal rejected', { type: 'success' }) } catch (err) { showToast(`Couldn't reject the withdrawal: ${err.message}`, { type: 'error' }) } }} />}
        {tab === 'businesses' && <BusinessesTab businesses={businesses} bizSearch={bizSearch} setBizSearch={setBizSearch} bizTypeFilter={bizTypeFilter} setBizTypeFilter={setBizTypeFilter} bizStateFilter={bizStateFilter} setBizStateFilter={setBizStateFilter} bizStatusFilter={bizStatusFilter} setBizStatusFilter={setBizStatusFilter} selectedBiz={selectedBiz} setSelectedBiz={setSelectedBiz} bizReviews={bizReviews} setBizReviews={setBizReviews} bizProducts={bizProducts} setBizProducts={setBizProducts} supabase={supabase} />}
        {tab === 'stories' && <StoriesTab stories={stories} storyTitle={storyTitle} setStoryTitle={setStoryTitle} storyBody={storyBody} setStoryBody={setStoryBody} storyBg={storyBg} setStoryBg={setStoryBg} storyImageFile={storyImageFile} setStoryImageFile={setStoryImageFile} savingStory={savingStory} createStory={createStory} deleteStory={deleteStory} />}
        {tab === 'news' && <NewsTab newsItems={newsItems} editingNews={editingNews} setEditingNews={setEditingNews} newsPhones={newsPhones} savingNews={savingNews} approveNews={approveNews} rejectNews={rejectNews} deleteNews={deleteNews} />}
        {tab === 'promotions' && <PromotionsTab promotions={promotions} promoTitle={promoTitle} setPromoTitle={setPromoTitle} promoLink={promoLink} setPromoLink={setPromoLink} promoDays={promoDays} setPromoDays={setPromoDays} promoImage={promoImage} setPromoImage={setPromoImage} savingPromo={savingPromo} createPromotion={createPromotion} deletePromotion={deletePromotion} />}
        {tab === 'searches' && <SearchesTab searchLogs={searchLogs} />}
        {tab === 'golive' && <GoLiveTab activeShows={activeShows} scheduledShows={scheduledShows} liveTitle={liveTitle} setLiveTitle={setLiveTitle} scheduledAt={scheduledAt} setScheduledAt={setScheduledAt} trailerFile={trailerFile} setTrailerFile={setTrailerFile} creatingShow={creatingShow} liveGuests={liveGuests} setLiveGuests={setLiveGuests} guestSearch={guestSearch} setGuestSearch={setGuestSearch} users={users} startLiveShow={startLiveShow} scheduleShow={scheduleShow} endLiveShow={endLiveShow} startScheduledShow={startScheduledShow} cancelScheduledShow={cancelScheduledShow} liveDraft={liveDraft} setLiveDraft={setLiveDraft} liveImage={liveImage} setLiveImage={setLiveImage} postingLive={postingLive} postLiveItem={postLiveItem} liveItems={liveItems} liveStats={liveStats} liveComments={liveComments} hideLiveComment={hideLiveComment} loadLiveControl={loadLiveControl} toggleGuest={toggleGuest} showToast={showToast} postLiveVoice={postLiveVoice} postLiveSlide={postLiveSlide} postLiveVideo={postLiveVideo} />}
        {tab === 'shop' && <AdminShop showToast={showToast} />}
        {tab === 'notifications' && <NotificationsTab notifications={notifications} setTab={setTab} />}
      </>

    <ConfirmDialog
      show={!!confirmState}
      onClose={() => setConfirmState(null)}
      onConfirm={() => { const action = confirmState?.action; setConfirmState(null); action && action() }}
      title={confirmState?.title}
      consequence={confirmState?.consequence}
      confirmLabel={confirmState?.confirmLabel || 'Delete'}
    />
    <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </AdminLayout>
  )
}
