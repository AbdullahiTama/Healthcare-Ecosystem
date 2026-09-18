import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import '../../styles/tokens.css'
import { usersRepository } from './repositories/usersRepository'
import { contentRepository } from './repositories/contentRepository'
import { commerceRepository } from './repositories/commerceRepository'
import { liveRepository } from './repositories/liveRepository'
import { theme, toggleTheme } from '../../styles/theme'
import { callAdminAuth } from './adminApi'
import AdminLayout from './AdminLayout.jsx'
import { useRealtimeChannel } from './hooks/useRealtimeChannel'
import ShopTab from './tabs/ShopTab.jsx'
import CommandPalette from './CommandPalette.jsx'
import HealthPulse from './HealthPulse.jsx'
import AdminAiCopilot from './AdminAiCopilot.jsx'
import useCommandPalette from './useCommandPalette.js'
import { ConfirmDialog, Loading, Toast, useToast } from '../../components/ui'
import { NAV_GROUPS } from './AdminSidebar.jsx'
import { Sparkles } from 'lucide-react'
import { timeAgo } from './ui'
import { useAdminData, useAdminStories, useAdminNews, useAdminPromotions, useAdminSearchLogs, useAdminLiveShows, useAdminShopData, useAdminRoles } from '../../hooks/queries'
import { useQueryClient } from '@tanstack/react-query'

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
import EmailTemplatesTab from './tabs/EmailTemplatesTab.jsx'
import ModerationQueue from './tabs/ModerationQueue.jsx'
import AuditLog from './components/AuditLog.jsx'
import OrdersTab from './tabs/OrdersTab.jsx'
import DashboardTab from './tabs/DashboardTab.jsx'
import ErrorsTab from './tabs/ErrorsTab.jsx'
import { ModerationProvider } from './stores/moderationStore'

const ALL_TABS = NAV_GROUPS.flatMap(g => g.items)

export default function AdminPanel() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [adminUser, setAdminUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')
  const [adminPermissions, setAdminPermissions] = useState({})
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()

  // Credential review: which document is being signed, and any failure to
  // report inline against that row.
  const [credentialLoadingId, setCredentialLoadingId] = useState(null)
  const [credentialError, setCredentialError] = useState({ id: null, message: '' })
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
  const [storyTitle, setStoryTitle] = useState('')
  const [storyBody, setStoryBody] = useState('')
  const [storyBg, setStoryBg] = useState('var(--color-primary)')
  const [storyImageFile, setStoryImageFile] = useState(null)
  const [savingStory, setSavingStory] = useState(false)
  const [editingNews, setEditingNews] = useState(null)
  const [savingNews, setSavingNews] = useState(false)
  const [promoTitle, setPromoTitle] = useState('')
  const [promoLink, setPromoLink] = useState('')
  const [promoDays, setPromoDays] = useState('7')
  const [promoImage, setPromoImage] = useState(null)
  const [savingPromo, setSavingPromo] = useState(false)
  const [liveTitle, setLiveTitle] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [trailerFile, setTrailerFile] = useState(null)
  const [creatingShow, setCreatingShow] = useState(false)
  const [liveGuests, setLiveGuests] = useState([])
  const [guestSearch, setGuestSearch] = useState('')
  const [liveItems, setLiveItems] = useState([])
  const [liveStats, setLiveStats] = useState({ likes: 0, views: 0, shares: 0, gifts: 0 })
  const [liveComments, setLiveComments] = useState([])
  const [liveDraft, setLiveDraft] = useState('')
  const [liveImage, setLiveImage] = useState(null)
  const [postingLive, setPostingLive] = useState(false)
  const [selectedPost, setSelectedPost] = useState(null)
  const [postAuthor, setPostAuthor] = useState(null)
  const [aiCopilotOpen, setAiCopilotOpen] = useState(false)
  const [adminActionHistory, setAdminActionHistory] = useState([])
  const [newRoleName, setNewRoleName] = useState('')
  const [newRoleDesc, setNewRoleDesc] = useState('')
  const [newRoleTabs, setNewRoleTabs] = useState({})
  const [editingRoleId, setEditingRoleId] = useState(null)
  const [editingRoleTabs, setEditingRoleTabs] = useState({})
  const [savingRole, setSavingRole] = useState(false)

  const invalidateAdmin = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['admin'] })
  }, [qc])

  const { data: adminData } = useAdminData(!!adminUser)
  const { data: stories = [] } = useAdminStories(!!adminUser)
  const { data: newsData } = useAdminNews(!!adminUser)
  const { data: promotions = [] } = useAdminPromotions(!!adminUser)
  const { data: searchLogs = [] } = useAdminSearchLogs(!!adminUser)
  const { data: liveShowsData } = useAdminLiveShows(!!adminUser)
  const { data: shopData } = useAdminShopData(!!adminUser)
  const { data: adminRoles = [] } = useAdminRoles(!!adminUser)

  const { posts = [], users = [], verifications = [], claims = [], reports = [], transactions = [], tasks = [], teams = [], staff = [], businesses = [], withdrawals = [], notifications = [], phoneMap = {}, notifCount = 0, roleNotifCount = 0, stats = {} } = adminData || {}
  const newsItems = newsData?.items || []
  const newsPhones = newsData?.phones || {}
  const activeShows = liveShowsData?.active || []
  const scheduledShows = liveShowsData?.scheduled || []
  const ecomApps = shopData?.apps || []
  const ecomProductsAdmin = shopData?.products || []
  const shopOrdersAdmin = shopData?.orders || []

  async function logAuditAction(auditAction, targetType, targetId, metadata = {}) {
    try {
      await callAdminAuth('log_audit_action', {
        token: localStorage.getItem('admin_token'),
        auditAction,
        targetType,
        targetId,
        metadata,
      })
    } catch { /* non-blocking — audit failure must not block moderation */ }
  }
  // Generic confirmation-dialog state: { title, consequence, confirmLabel, action }.
  // `action` is the real, destructive operation — deferred until the admin confirms
  // (SCREEN_PATTERNS.md pattern 29: never a bare "Are you sure?", state the consequence).
  const [confirmState, setConfirmState] = useState(null)
  function askConfirm({ title, consequence, confirmLabel = 'Delete', action }) {
    setConfirmState({ title, consequence, confirmLabel, action })
  }
  const { open: cmdOpen, setOpen: setCmdOpen, addToRecent } = useCommandPalette()

  const handleCmdNavigate = useCallback((tabKey) => {
    setTab(tabKey)
    addToRecent(tabKey)
    setCmdOpen(false)
  }, [addToRecent, setCmdOpen])

  useRealtimeChannel({
    channelName: 'admin-notifications',
    subscription: { schema: 'public', table: 'verification_requests' },
    onInsert: () => invalidateAdmin(),
    onUpdate: () => invalidateAdmin(),
    pollInterval: 30000,
    pollFn: invalidateAdmin,
  })

  useRealtimeChannel({
    channelName: 'admin-posts',
    subscription: { schema: 'public', table: 'posts' },
    onInsert: () => invalidateAdmin(),
    pollInterval: 30000,
    pollFn: invalidateAdmin,
  })

  useRealtimeChannel({
    channelName: 'admin-reports',
    subscription: { schema: 'public', table: 'reports' },
    onInsert: () => invalidateAdmin(),
    onUpdate: () => invalidateAdmin(),
    pollInterval: 30000,
    pollFn: invalidateAdmin,
  })

  useEffect(() => {
    const verifySession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error || !session) {
          localStorage.removeItem('admin_token')
          localStorage.removeItem('admin_user')
          localStorage.removeItem('admin_permissions')
          navigate('/login')
          return
        }

        const token = localStorage.getItem('admin_token')
        const userData = localStorage.getItem('admin_user')
        const permsData = localStorage.getItem('admin_permissions')
        if (!token || !userData) {
          navigate('/login')
          return
        }

        let parsedAdmin
        try {
          parsedAdmin = JSON.parse(userData)
        } catch {
          localStorage.removeItem('admin_user')
          navigate('/login')
          return
        }

        setAdminUser(parsedAdmin)
        if (permsData) {
          try {
            setAdminPermissions(JSON.parse(permsData))
          } catch {
            localStorage.removeItem('admin_permissions')
          }
        }
        setLoading(false)
      } catch {
        localStorage.removeItem('admin_token')
        localStorage.removeItem('admin_user')
        localStorage.removeItem('admin_permissions')
        navigate('/login')
      }
    }

    verifySession()
  }, [])

  useEffect(() => {
    if (adminUser) invalidateAdmin()
  }, [adminUser])

  const loadAll = invalidateAdmin

  async function updateEcomApp(id, status) {
    try {
      await callAdminAuth('update_ecommerce_application', { token: localStorage.getItem('admin_token'), id, status })
      showToast(`Application ${status}`, { type: 'success' }); invalidateAdmin()
    } catch (e) { showToast(e.message, { type: 'error' }) }
  }
  async function moderateProduct(id, patch) {
    try {
      await callAdminAuth('moderate_ecommerce_product', { token: localStorage.getItem('admin_token'), id, ...patch })
      showToast('Product updated', { type: 'success' }); invalidateAdmin()
    } catch (e) { showToast(e.message, { type: 'error' }) }
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
    invalidateAdmin()
    showToast('Show scheduled! It will show a countdown to your audience. Tap "Start Now" when you\'re ready to go live.', { type: 'success' })
  }

  async function startScheduledShow(showId) {
    try {
      await callAdminAuth('start_scheduled_show', { token: localStorage.getItem('admin_token'), showId })
      invalidateAdmin()
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
      invalidateAdmin()
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
    invalidateAdmin()
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
      invalidateAdmin()
      showToast('Live show ended', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't end the show: ${err.message}`, { type: 'error' })
    }
  }

  async function loadLiveControl(showId) {
    const result = await liveRepository.getLiveControl(showId)
    setLiveItems(result.items || [])
    setLiveComments(result.comments || [])
    setLiveStats(result.stats || { likes: 0, shares: 0, views: 0, gifts: 0 })
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
      invalidateAdmin()
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
      invalidateAdmin()
      showToast('Promotion deleted', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't delete the promotion: ${err.message}`, { type: 'error' })
    }
  }

  async function viewUserDetails(u) {
    setSelectedUser(u)
    const data = await usersRepository.getUserPosts(u.id)
    setUserPosts(data || [])
  }

  async function approveNews(item) {
    setSavingNews(true)
    const edits = editingNews && editingNews.id === item.id
      ? { headline: editingNews.headline, subtitle: editingNews.subtitle, body: editingNews.body }
      : {}
    try {
      await callAdminAuth('approve_news', { token: localStorage.getItem('admin_token'), id: item.id, edits })
      logAuditAction('approve', 'news', item.id, { headline: item.headline })
      setAdminActionHistory(prev => [...prev.slice(-49), { action: 'approve', target: 'news', id: item.id, timestamp: new Date().toISOString() }])
      showToast('News item approved', { type: 'success' })
      // Optimistic update so UI reflects immediately even before reload
      qc.setQueryData(['admin', 'news'], prev => ({ ...prev, items: (prev?.items || []).map(n => n.id === item.id ? { ...n, ...edits, status: 'approved', published_at: new Date().toISOString() } : n) }))
    } catch (err) {
      showToast(`Couldn't approve the news item: ${err.message}`, { type: 'error' })
    }
    setEditingNews(null)
    setSavingNews(false)
    invalidateAdmin()
    invalidateAdmin()
  }

  async function rejectNews(id) {
    try {
      await callAdminAuth('reject_news', { token: localStorage.getItem('admin_token'), id })
      logAuditAction('reject', 'news', id, {})
      setAdminActionHistory(prev => [...prev.slice(-49), { action: 'reject', target: 'news', id, timestamp: new Date().toISOString() }])
      showToast('News item rejected', { type: 'success' })
      qc.setQueryData(['admin', 'news'], prev => ({ ...prev, items: (prev?.items || []).map(n => n.id === id ? { ...n, status: 'rejected' } : n) }))
    } catch (err) {
      showToast(`Couldn't reject the news item: ${err.message}`, { type: 'error' })
    }
    setEditingNews(null)
    invalidateAdmin()
    invalidateAdmin()
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
      logAuditAction('delete', 'news', id, {})
      qc.setQueryData(['admin', 'news'], prev => ({ ...prev, items: (prev?.items || []).filter(n => n.id !== id) }))
      showToast('News item deleted', { type: 'success' })
      invalidateAdmin()
      invalidateAdmin()
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
      setStoryTitle(''); setStoryBody(''); setStoryBg('var(--color-primary)'); setStoryImageFile(null)
      invalidateAdmin()
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
      invalidateAdmin()
      showToast('Story deleted', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't delete the story: ${err.message}`, { type: 'error' })
    }
  }

  async function viewPostDetails(p) {
    setSelectedPost(p)
    setPostAuthor(null)
    if (p.user_id) {
      const profile = await usersRepository.getUserProfile(p.user_id)
      setPostAuthor(profile || null)
    }
  }

  async function suspendUser(userId, days) {
    try {
      await callAdminAuth('suspend_user', { token: localStorage.getItem('admin_token'), userId, days })
      logAuditAction('suspend', 'user', userId, { days })
      setSelectedUser(null)
      invalidateAdmin()
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
      logAuditAction('delete', 'user', userId, { name: selectedUser?.full_name || selectedUser?.display_name })
      showToast('User deleted', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't delete the user: ${err.message}`, { type: 'error' })
    }
    setSelectedUser(null)
    setDeletingUser(false)
    invalidateAdmin()
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
      logAuditAction('approve', 'verification', id, { userId, profession })
      setAdminActionHistory(prev => [...prev.slice(-49), { action: 'approve', target: 'verification', id, timestamp: new Date().toISOString() }])
      invalidateAdmin()
      showToast('Verification approved', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't approve the verification: ${err.message}`, { type: 'error' })
    }
  }

  async function rejectVerif(id) {
    try {
      await callAdminAuth('reject_verification', { token: localStorage.getItem('admin_token'), id })
      logAuditAction('reject', 'verification', id, {})
      setAdminActionHistory(prev => [...prev.slice(-49), { action: 'reject', target: 'verification', id, timestamp: new Date().toISOString() }])
      invalidateAdmin()
      showToast('Verification rejected', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't reject the verification: ${err.message}`, { type: 'error' })
    }
  }

  async function approveClaim(id, businessId) {
    try {
      await callAdminAuth('approve_claim', { token: localStorage.getItem('admin_token'), claimId: id, businessId })
      logAuditAction('approve', 'claim', id, { businessId })
      setAdminActionHistory(prev => [...prev.slice(-49), { action: 'approve', target: 'claim', id, timestamp: new Date().toISOString() }])
      invalidateAdmin()
      showToast('Claim approved', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't approve the claim: ${err.message}`, { type: 'error' })
    }
  }

  async function rejectClaim(id) {
    try {
      await callAdminAuth('reject_claim', { token: localStorage.getItem('admin_token'), claimId: id })
      logAuditAction('reject', 'claim', id, {})
      setAdminActionHistory(prev => [...prev.slice(-49), { action: 'reject', target: 'claim', id, timestamp: new Date().toISOString() }])
      invalidateAdmin()
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
      logAuditAction('delete', 'post', id, {})
      setAdminActionHistory(prev => [...prev.slice(-49), { action: 'reject', target: 'post', id, timestamp: new Date().toISOString() }])
      invalidateAdmin()
      showToast('Post deleted', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't delete the post: ${err.message}`, { type: 'error' })
    }
  }

  async function resolveReport(id) {
    try {
      await callAdminAuth('resolve_report', { token: localStorage.getItem('admin_token'), id })
      logAuditAction('resolve', 'report', id, {})
      setAdminActionHistory(prev => [...prev.slice(-49), { action: 'approve', target: 'report', id, timestamp: new Date().toISOString() }])
      invalidateAdmin()
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
      invalidateAdmin()
      showToast('User verified', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't verify the user: ${err.message}`, { type: 'error' })
    }
  }

  async function searchDrugs() {
    if (!drugSearch.trim()) return
    const products = await commerceRepository.searchProducts(drugSearch)
    if (!products?.length) { setDrugReviews([]); return }
    setDrugName(products[0].name)
    const reviews = await commerceRepository.getProductReviews(products.map(p => p.id))
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
    setSavingTask(false); invalidateAdmin()
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
      invalidateAdmin()
    } catch (err) {
      setStaffMsg('Error: ' + err.message)
    }
    setSavingStaff(false)
  }

  async function createTeam(e) {
    e.preventDefault()
    try {
      await callAdminAuth('create_team', { token: localStorage.getItem('admin_token'), name: teamName })
      setTeamName(''); invalidateAdmin()
    } catch (err) {
      setStaffMsg('Error: ' + err.message)
    }
  }

  if (loading) return <Loading fullScreen aria-live="polite" aria-busy="true" />

  const card = { border: '1px solid var(--border)', borderRadius: 14, padding: 14, background: 'var(--panel)', marginBottom: 10 }
  const input = { width: '100%', padding: 10, fontSize: 13, border: '1px solid var(--border)', borderRadius: 10, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--fg)' }

  async function handleSignOut() {
    await supabase.auth.signOut()
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_user')
    localStorage.removeItem('admin_permissions')
    navigate('/login')
  }

  return (
    <ModerationProvider>
    <AdminLayout
      activeTab={tab}
      onTabChange={setTab}
      adminUser={adminUser}
      permissions={adminPermissions}
      notifCount={roleNotifCount}
      onSignOut={handleSignOut}
      onOpenCmdPalette={() => setCmdOpen(true)}
    >
      <div aria-live="polite" aria-busy={loading}>
        {tab === 'overview' && <HealthPulse onNavigate={setTab} />}
        {tab === 'overview' && <DashboardTab stats={stats} setTab={setTab} posts={posts} users={users} transactions={transactions} verifications={verifications} reports={reports} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} />}
        {tab === 'overview' && <OverviewTab stats={stats} setTab={setTab} posts={posts} users={users} transactions={transactions} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} />}
        {tab === 'moderation' && <ModerationQueue reports={reports} posts={posts} verifications={verifications} showToast={showToast} loadAll={loadAll} />}
        {tab === 'audit_log' && <AuditLog />}
        {tab === 'errors' && <ErrorsTab showToast={showToast} />}
        {tab === 'verifications' && <VerificationsTab verifications={verifications} openCredential={openCredential} credentialLoadingId={credentialLoadingId} credentialError={credentialError} approveVerif={approveVerif} rejectVerif={rejectVerif} />}
        {tab === 'claims' && <ClaimsTab claims={claims} approveClaim={approveClaim} rejectClaim={rejectClaim} />}
        {tab === 'reports' && <ReportsTab reports={reports} deletePost={deletePost} resolveReport={resolveReport} />}
        {tab === 'users' && <UsersTab users={users} selectedUser={selectedUser} setSelectedUser={setSelectedUser} userSearch={userSearch} setUserSearch={setUserSearch} userVerifiedFilter={userVerifiedFilter} setUserVerifiedFilter={setUserVerifiedFilter} userSpecialtyFilter={userSpecialtyFilter} setUserSpecialtyFilter={setUserSpecialtyFilter} phoneMap={phoneMap} viewUserDetails={viewUserDetails} suspendDays={suspendDays} setSuspendDays={setSuspendDays} suspendUser={suspendUser} deleteUser={deleteUser} deletingUser={deletingUser} userPosts={userPosts} verifyingUser={verifyingUser} setVerifyingUser={setVerifyingUser} verifySpecialty={verifySpecialty} setVerifySpecialty={setVerifySpecialty} manualVerify={manualVerify} adminUser={adminUser} />}
        {tab === 'posts' && <PostsTab posts={posts} selectedPost={selectedPost} setSelectedPost={setSelectedPost} postAuthor={postAuthor} setPostAuthor={setPostAuthor} postSearch={postSearch} setPostSearch={setPostSearch} postTypeFilter={postTypeFilter} setPostTypeFilter={setPostTypeFilter} postDateFrom={postDateFrom} setPostDateFrom={setPostDateFrom} postDateTo={postDateTo} setPostDateTo={setPostDateTo} viewPostDetails={viewPostDetails} deletePost={deletePost} />}
        {tab === 'revenue' && <RevenueTab transactions={transactions} />}
        {tab === 'orders' && <OrdersTab transactions={transactions} showToast={showToast} loadAll={loadAll} />}
        {tab === 'drugs' && <DrugsTab drugSearch={drugSearch} setDrugSearch={setDrugSearch} drugReviews={drugReviews} drugName={drugName} setDrugName={setDrugName} drugRatingFilter={drugRatingFilter} setDrugRatingFilter={setDrugRatingFilter} drugDateFrom={drugDateFrom} setDrugDateFrom={setDrugDateFrom} drugDateTo={drugDateTo} setDrugDateTo={setDrugDateTo} searchDrugs={searchDrugs} />}
        {tab === 'tasks' && <TasksTab tasks={tasks} taskTitle={taskTitle} setTaskTitle={setTaskTitle} taskDesc={taskDesc} setTaskDesc={setTaskDesc} taskComp={taskComp} setTaskComp={setTaskComp} taskSpec={taskSpec} setTaskSpec={setTaskSpec} savingTask={savingTask} createTask={createTask} />}
        {tab === 'teams' && <TeamsTab teams={teams} staff={staff} teamName={teamName} setTeamName={setTeamName} createTeam={createTeam} staffName={staffName} setStaffName={setStaffName} staffEmail={staffEmail} setStaffEmail={setStaffEmail} staffPass={staffPass} setStaffPass={setStaffPass} staffRole={staffRole} setStaffRole={setStaffRole} staffTeam={staffTeam} setStaffTeam={setStaffTeam} savingStaff={savingStaff} staffMsg={staffMsg} setStaffMsg={setStaffMsg} createStaff={createStaff} adminUser={adminUser} adminRoles={adminRoles} newRoleName={newRoleName} setNewRoleName={setNewRoleName} newRoleDesc={newRoleDesc} setNewRoleDesc={setNewRoleDesc} newRoleTabs={newRoleTabs} setNewRoleTabs={setNewRoleTabs} editingRoleId={editingRoleId} setEditingRoleId={setEditingRoleId} editingRoleTabs={editingRoleTabs} setEditingRoleTabs={setEditingRoleTabs} savingRole={savingRole} loadAdminRoles={invalidateAdmin} showToast={showToast} ALL_TABS={ALL_TABS} />}
        {tab === 'withdrawals' && <WithdrawalsTab withdrawals={withdrawals} onApprove={async (id) => { try { await callAdminAuth('approve_withdrawal', { token: localStorage.getItem('admin_token'), id }); invalidateAdmin(); showToast('Withdrawal approved', { type: 'success' }) } catch (err) { showToast(`Couldn't approve the withdrawal: ${err.message}`, { type: 'error' }) } }} onReject={async (id) => { try { await callAdminAuth('reject_withdrawal', { token: localStorage.getItem('admin_token'), id }); invalidateAdmin(); showToast('Withdrawal rejected', { type: 'success' }) } catch (err) { showToast(`Couldn't reject the withdrawal: ${err.message}`, { type: 'error' }) } }} />}
        {tab === 'businesses' && <BusinessesTab businesses={businesses} bizSearch={bizSearch} setBizSearch={setBizSearch} bizTypeFilter={bizTypeFilter} setBizTypeFilter={setBizTypeFilter} bizStateFilter={bizStateFilter} setBizStateFilter={setBizStateFilter} bizStatusFilter={bizStatusFilter} setBizStatusFilter={setBizStatusFilter} selectedBiz={selectedBiz} setSelectedBiz={setSelectedBiz} bizReviews={bizReviews} setBizReviews={setBizReviews} bizProducts={bizProducts} setBizProducts={setBizProducts} supabase={supabase} />}
        {tab === 'stories' && <StoriesTab stories={stories} storyTitle={storyTitle} setStoryTitle={setStoryTitle} storyBody={storyBody} setStoryBody={setStoryBody} storyBg={storyBg} setStoryBg={setStoryBg} storyImageFile={storyImageFile} setStoryImageFile={setStoryImageFile} savingStory={savingStory} createStory={createStory} deleteStory={deleteStory} />}
        {tab === 'news' && <NewsTab newsItems={newsItems} editingNews={editingNews} setEditingNews={setEditingNews} newsPhones={newsPhones} savingNews={savingNews} approveNews={approveNews} rejectNews={rejectNews} deleteNews={deleteNews} />}
        {tab === 'promotions' && <PromotionsTab promotions={promotions} promoTitle={promoTitle} setPromoTitle={setPromoTitle} promoLink={promoLink} setPromoLink={setPromoLink} promoDays={promoDays} setPromoDays={setPromoDays} promoImage={promoImage} setPromoImage={setPromoImage} savingPromo={savingPromo} createPromotion={createPromotion} deletePromotion={deletePromotion} />}
        {tab === 'searches' && <SearchesTab searchLogs={searchLogs} />}
        {tab === 'golive' && <GoLiveTab activeShows={activeShows} scheduledShows={scheduledShows} liveTitle={liveTitle} setLiveTitle={setLiveTitle} scheduledAt={scheduledAt} setScheduledAt={setScheduledAt} trailerFile={trailerFile} setTrailerFile={setTrailerFile} creatingShow={creatingShow} liveGuests={liveGuests} setLiveGuests={setLiveGuests} guestSearch={guestSearch} setGuestSearch={setGuestSearch} users={users} startLiveShow={startLiveShow} scheduleShow={scheduleShow} endLiveShow={endLiveShow} startScheduledShow={startScheduledShow} cancelScheduledShow={cancelScheduledShow} liveDraft={liveDraft} setLiveDraft={setLiveDraft} liveImage={liveImage} setLiveImage={setLiveImage} postingLive={postingLive} postLiveItem={postLiveItem} liveItems={liveItems} liveStats={liveStats} liveComments={liveComments} hideLiveComment={hideLiveComment} loadLiveControl={loadLiveControl} toggleGuest={toggleGuest} showToast={showToast} postLiveVoice={postLiveVoice} postLiveSlide={postLiveSlide} postLiveVideo={postLiveVideo} />}
        {tab === 'shop' && <ShopTab showToast={showToast} />}
        {tab === 'notifications' && <NotificationsTab notifications={notifications} setTab={setTab} />}
        {tab === 'email_templates' && <EmailTemplatesTab showToast={showToast} />}
      </div>

    <ConfirmDialog
      show={!!confirmState}
      onClose={() => setConfirmState(null)}
      onConfirm={() => { const action = confirmState?.action; setConfirmState(null); action && action() }}
      title={confirmState?.title}
      consequence={confirmState?.consequence}
      confirmLabel={confirmState?.confirmLabel || 'Delete'}
    />
    <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    <CommandPalette
      open={cmdOpen}
      onClose={() => setCmdOpen(false)}
      onNavigate={handleCmdNavigate}
      onSignOut={handleSignOut}
      onRefresh={loadAll}
      permissions={adminPermissions}
    />
    
    {/* AI Copilot Button */}
    <button
      onClick={() => setAiCopilotOpen(true)}
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        width: 56,
        height: 56,
        borderRadius: '50%',
      background: 'var(--teal-deep)',
      border: 'none',
      boxShadow: '0 4px 12px rgba(14, 111, 90, 0.3)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999,
        transition: 'transform 0.2s',
      }}
      onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
      onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
    >
      <Sparkles size={24} color="var(--fg)" />
    </button>
    
    {/* AI Copilot */}
    <AdminAiCopilot
      isOpen={aiCopilotOpen}
      onClose={() => setAiCopilotOpen(false)}
      currentTab={tab}
      recentActions={adminActionHistory}
      onFeedback={(suggestionId, accepted) => {
        setAdminActionHistory(prev => [...prev.slice(-49), { action: accepted ? 'copilot_accept' : 'copilot_reject', target: suggestionId, timestamp: new Date().toISOString() }])
      }}
    />
    </AdminLayout>
    </ModerationProvider>
  )
}
