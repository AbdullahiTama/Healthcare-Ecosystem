import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import { callAdminAuth } from './adminApi'
import FeedRankingConfig from './FeedRankingConfig.jsx'
import DistributionExperiments from './DistributionExperiments.jsx'
import { ConfirmDialog, Loading, Toast, useToast } from '../../components/ui'
import VoiceRecorder from '../../components/VoiceRecorder.jsx'
import SlideUploader from '../../components/SlideUploader.jsx'
import VideoUploader from '../../components/VideoUploader.jsx'
import VideoRecorder from '../../components/VideoRecorder.jsx'

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
      if (!token || !userData) { navigate('/admin'); return }
      const decoded = atob(token)
      const parts = decoded.split('|')
      if (parts.length !== 3 || Date.now() - parseInt(parts[2]) > 86400000) {
        localStorage.removeItem('admin_token')
        localStorage.removeItem('admin_user')
        navigate('/admin')
        return
      }
      const parsedAdmin = JSON.parse(userData)
      setAdminUser(parsedAdmin)
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
    const [usersRes, verifRes, claimsRes, reportsRes, txRes, tasksRes, teamsRes, bizRes, staffRes, withdrawRes, taskSubRes, consultRes] = await Promise.all([
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

    // Super admin sees all notifications
    const totalNotifs = pendingVerifs + pendingClaims + openReports + pendingWithdrawals + pendingTaskSubs
    setNotifCount(totalNotifs)

    // Role-specific notifications
    const role = JSON.parse(localStorage.getItem('admin_user') || '{}').role || ''
    if (role === 'super_admin') setRoleNotifCount(totalNotifs)
    else if (role === 'verification_officer') setRoleNotifCount(pendingVerifs + newConsults)
    else if (role === 'business_manager') setRoleNotifCount(pendingClaims)
    else if (role === 'moderator' || role === 'content_manager') setRoleNotifCount(openReports)
    else if (role === 'analytics_manager') setRoleNotifCount(pendingWithdrawals)
    else setRoleNotifCount(0)

    setLoading(false)
  }

  useEffect(() => { if (adminUser) { loadStories(); loadNews(); loadPromotions(); loadSearchLogs(); loadActiveShows() } }, [adminUser])

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
    } catch {
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
    } catch (err) {
      showToast(`Couldn't approve the news item: ${err.message}`, { type: 'error' })
    }
    setEditingNews(null)
    setSavingNews(false)
    loadNews()
  }

  async function rejectNews(id) {
    try {
      await callAdminAuth('reject_news', { token: localStorage.getItem('admin_token'), id })
      showToast('News item rejected', { type: 'success' })
    } catch (err) {
      showToast(`Couldn't reject the news item: ${err.message}`, { type: 'error' })
    }
    setEditingNews(null)
    loadNews()
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
      loadNews()
      showToast('News item deleted', { type: 'success' })
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
    try {
      const { url } = await callAdminAuth('credential_url', { token: localStorage.getItem('admin_token'), requestId })
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
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

  const TABS = [
    { key: 'overview', label: '📊 Overview' },
    { key: 'verifications', label: `🩺 Verify (${stats.pendingVerifs || 0})` },
    { key: 'claims', label: `🏥 Claims (${stats.pendingClaims || 0})` },
    { key: 'reports', label: `🚩 Reports (${stats.reports || 0})` },
    { key: 'users', label: '👥 Users' },
    { key: 'posts', label: '📝 Posts' },
    { key: 'revenue', label: '💰 Revenue' },
    { key: 'drugs', label: '💊 Drug Intel' },
    { key: 'tasks', label: '📋 Tasks' },
    { key: 'teams', label: '👨‍💼 Teams' },
    { key: 'withdrawals', label: `💰 Withdrawals (${withdrawals.filter(w => w.status === 'pending').length})` },
    { key: 'businesses', label: `🏢 Companies (${businesses.length})` },
    { key: 'stories', label: `📸 Stories (${stories.length})` },
    { key: 'news', label: `📰 News (${newsItems.filter(n => n.status === 'pending').length})` },
    { key: 'promotions', label: `🎯 Promos (${promotions.filter(p => !p.expires_at || new Date(p.expires_at) > new Date()).length})` },
    { key: 'searches', label: `🔎 Searches (${searchLogs.filter(s => !s.found).length})` },
    { key: 'golive', label: `📡 Go Live (${activeShows.length})` },
    { key: 'notifications', label: `🔔 All Alerts (${notifCount})` },
  ]

  const btnStyle = (active) => ({
    flexShrink: 0, padding: '7px 12px', borderRadius: 18, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
    border: active ? 'none' : `1px solid ${theme.border}`,
    background: active ? theme.tealGradient : theme.bg,
    color: active ? '#fff' : theme.textMid,
  })

  const card = { border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, background: theme.cardBg, marginBottom: 10 }
  const input = { width: '100%', padding: 10, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 10, boxSizing: 'border-box' }

  return (
    <>
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{ background: theme.heroGradient, padding: '20px 16px 16px', color: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: '0 0 2px 0', fontSize: 19, fontWeight: 900 }}>CareFind Admin</h1>
            <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{adminUser?.full_name} · {adminUser?.role?.replace('_', ' ')}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {roleNotifCount > 0 && (
              <div style={{ position: 'relative' }}>
                <button onClick={() => setTab('overview')} style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  🔔
                </button>
                <div style={{ position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: '50%', background: theme.danger, color: '#fff', fontSize: 9, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center',                     border: '2px solid #0E6F5A' }}>
                  {roleNotifCount > 99 ? '99+' : roleNotifCount}
                </div>
              </div>
            )}
            <button onClick={() => { localStorage.removeItem('admin_token'); localStorage.removeItem('admin_user'); navigate('/admin') }}
              style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
              Sign Out
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, padding: '10px 12px', overflowX: 'auto', background: '#fff', borderBottom: `1px solid ${theme.border}`, WebkitOverflowScrolling: 'touch' }}>
        {TABS.map(t => <button key={t.key} onClick={() => setTab(t.key)} style={btnStyle(tab === t.key)}>{t.label}</button>)}
      </div>

      <div style={{ padding: '14px 14px 0' }}>

        {tab === 'overview' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              {[
                { label: 'Total Users', value: stats.users, icon: '👥', tab: 'users' },
                { label: 'Total Posts', value: stats.posts, icon: '📝', tab: 'posts' },
                { label: 'Pending Verifs', value: stats.pendingVerifs, icon: '🩺', alert: stats.pendingVerifs > 0, tab: 'verifications' },
                { label: 'Open Reports', value: stats.reports, icon: '🚩', alert: stats.reports > 0, tab: 'reports' },
                { label: 'Transactions', value: stats.transactions, icon: '💳', tab: 'revenue' },
                { label: 'Revenue', value: `₦${(stats.revenue || 0).toLocaleString()}`, icon: '💰', tab: 'revenue' },
              ].map(s => (
                <div key={s.label} onClick={() => setTab(s.tab)} style={{ border: `1px solid ${s.alert ? theme.alertLight : theme.border}`, borderRadius: 14, padding: 14, background: s.alert ? theme.dangerBg : theme.cardBg, textAlign: 'center', cursor: 'pointer' }}>
                  <p style={{ margin: '0 0 4px 0', fontSize: 20 }}>{s.icon}</p>
                  <p style={{ margin: '0 0 2px 0', fontSize: 20, fontWeight: 900, color: s.alert ? theme.alert : theme.navy }}>{s.value}</p>
                  <p style={{ margin: 0, fontSize: 10, color: theme.textLight, fontWeight: 700 }}>{s.label}</p>
                </div>
              ))}
            </div>
            <FeedRankingConfig />
            <DistributionExperiments />
            <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 14, background: theme.cardBg, marginTop: 4 }}>
              <p style={{ margin: '0 0 10px 0', fontWeight: 800, fontSize: 13, color: theme.navy }}>📅 Filter by Date</p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 3 }}>From</label>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ width: '100%', padding: 8, fontSize: 12, border: `1px solid ${theme.border}`, borderRadius: 8, boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 3 }}>To</label>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ width: '100%', padding: 8, fontSize: 12, border: `1px solid ${theme.border}`, borderRadius: 8, boxSizing: 'border-box' }} />
                </div>
              </div>
              {(dateFrom || dateTo) && (
                <div>
                  <p style={{ margin: '0 0 6px 0', fontSize: 12, color: theme.textMid, fontWeight: 600 }}>Activity in range:</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[
                      { label: 'Posts', value: posts.filter(p => (!dateFrom || p.created_at >= dateFrom) && (!dateTo || p.created_at <= dateTo + 'T23:59:59')).length },
                      { label: 'Users', value: users.filter(u => (!dateFrom || u.created_at >= dateFrom) && (!dateTo || u.created_at <= dateTo + 'T23:59:59')).length },
                      { label: 'Transactions', value: transactions.filter(t => (!dateFrom || t.created_at >= dateFrom) && (!dateTo || t.created_at <= dateTo + 'T23:59:59')).length },
                    ].map(s => (
                      <div key={s.label} style={{ flex: 1, background: theme.tealMist, borderRadius: 10, padding: '8px 6px', textAlign: 'center' }}>
                        <p style={{ margin: '0 0 2px 0', fontSize: 18, fontWeight: 900, color: theme.tealDeep }}>{s.value}</p>
                        <p style={{ margin: 0, fontSize: 10, color: theme.textLight, fontWeight: 700 }}>{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => { setDateFrom(''); setDateTo('') }} style={{ marginTop: 8, padding: '5px 10px', background: 'none', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 11, color: theme.textLight }}>Clear filter</button>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'verifications' && (
          <div>
            {verifications.length === 0 && <p style={{ color: theme.textLight, fontSize: 13 }}>No verification requests yet.</p>}
            {verifications.map(v => (
              <div key={v.id} style={{ ...card, border: `1px solid ${v.status === 'pending' ? theme.alertLight : theme.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <p style={{ margin: '0 0 2px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>{v.full_name}</p>
                    <p style={{ margin: '0 0 2px 0', fontSize: 12, color: theme.tealDeep, fontWeight: 700 }}>{v.profession}</p>
                    {v.phone && <p style={{ margin: '0 0 2px 0', fontSize: 11.5, color: theme.textLight }}>{v.phone} · {v.workplace}</p>}
                    <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{timeAgo(v.created_at)}</p>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 20, height: 'fit-content', background: v.status === 'approved' ? theme.tealMist : v.status === 'rejected' ? theme.dangerBg : theme.amberBg, color: v.status === 'approved' ? theme.success : v.status === 'rejected' ? theme.alert : theme.amberText }}>{v.status}</span>
                </div>
                {/* Issue #5: the credentials bucket is private now — licence
                    and ID documents were world-readable through their public
                    URL. A reviewer asks the admin API (service role) for a
                    5-minute signed URL instead of linking at the object. */}
                {v.credential_url && (
                  <button
                    type="button"
                    onClick={() => openCredential(v.id)}
                    disabled={credentialLoadingId === v.id}
                    style={{ display: 'inline-block', marginBottom: 10, padding: 0, background: 'none', border: 'none', fontSize: 12, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    {credentialLoadingId === v.id ? 'Opening…' : '📎 View Credential'}
                  </button>
                )}
                {credentialError.id === v.id && (
                  <p style={{ margin: '0 0 10px 0', fontSize: 11.5, color: theme.alert }}>{credentialError.message}</p>
                )}
                {v.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => approveVerif(v.id, v.user_id, v.profession)} style={{ flex: 1, padding: 9, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13 }}>✓ Approve</button>
                    <button onClick={() => rejectVerif(v.id)} style={{ flex: 1, padding: 9, background: theme.dangerBg, color: theme.alert, border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13 }}>✕ Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'claims' && (
          <div>
            {claims.length === 0 && <p style={{ color: theme.textLight, fontSize: 13 }}>No business claims yet.</p>}
            {claims.map(c => (
              <div key={c.id} style={{ ...card, border: `1px solid ${c.status === 'pending' ? theme.alertLight : theme.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <p style={{ margin: '0 0 2px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>{c.businesses?.name}</p>
                    <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{timeAgo(c.created_at)}</p>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 20, background: c.status === 'approved' ? theme.tealMist : c.status === 'rejected' ? theme.dangerBg : theme.amberBg, color: c.status === 'approved' ? theme.success : c.status === 'rejected' ? theme.alert : theme.amberText }}>{c.status}</span>
                </div>
                {c.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => approveClaim(c.id, c.business_id)} style={{ flex: 1, padding: 9, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13 }}>✓ Approve</button>
                    <button onClick={() => rejectClaim(c.id)} style={{ flex: 1, padding: 9, background: theme.dangerBg, color: theme.alert, border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13 }}>✕ Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'reports' && (
          <div>
            {reports.length === 0 && <p style={{ color: theme.textLight, fontSize: 13 }}>No reports yet.</p>}
            {reports.map(r => (
              <div key={r.id} style={{ ...card, border: `1px solid ${r.status === 'pending' ? theme.alertLight : theme.border}` }}>
                <p style={{ margin: '0 0 4px 0', fontSize: 11, color: theme.alert, fontWeight: 800 }}>🚩 {r.reason}</p>
                <p style={{ margin: '0 0 8px 0', fontSize: 13, color: theme.textMid }}>{r.posts?.content?.slice(0, 120)}</p>
                <p style={{ margin: '0 0 10px 0', fontSize: 11, color: theme.textLight }}>{timeAgo(r.created_at)}</p>
                {r.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => deletePost(r.post_id)} style={{ flex: 1, padding: 8, background: theme.dangerBg, color: theme.alert, border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 12 }}>🗑️ Delete Post</button>
                    <button onClick={() => resolveReport(r.id)} style={{ flex: 1, padding: 8, background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 10, fontWeight: 700, fontSize: 12 }}>✓ Dismiss</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'users' && (
          <div>
            {/* User Detail Modal */}
            {selectedUser && (
              <div style={{ border: `1px solid ${theme.tealBright}`, borderRadius: 16, padding: 16, background: theme.tealMist, marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: theme.navy }}>👤 User Details</h3>
                  <button onClick={() => setSelectedUser(null)} style={{ background: 'none', border: 'none', fontSize: 18, color: theme.textLight }}>✕</button>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ width: 50, height: 50, borderRadius: '50%', background: selectedUser.cover_url ? `url(${selectedUser.cover_url})` : theme.tealGradient, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, fontWeight: 800, flexShrink: 0 }}>
                    {!selectedUser.cover_url && (selectedUser.full_name || selectedUser.display_name || '?')[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p style={{ margin: '0 0 2px 0', fontWeight: 900, fontSize: 15, color: theme.navy }}>{selectedUser.full_name || 'No full name'}</p>
                    {selectedUser.display_name && <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>@{selectedUser.display_name}</p>}
                  </div>
                </div>
                <div style={{ background: '#fff', borderRadius: 12, padding: 12, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { label: 'User ID', value: selectedUser.id?.slice(0, 16) + '...' },
                    { label: 'Title', value: selectedUser.verification_label || 'Not set' },
                    { label: 'Specialty', value: selectedUser.specialty || 'Not set' },
                    { label: 'Location', value: selectedUser.location || 'Not set' },
                    { label: 'Verified', value: selectedUser.is_verified ? '✓ Yes' : 'No' },
                    { label: 'Joined', value: new Date(selectedUser.created_at).toLocaleDateString() },
                    { label: 'Posts', value: userPosts.length },
                  ].map(f => (
                    <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: theme.textLight, fontWeight: 700 }}>{f.label}</span>
                      <span style={{ fontSize: 12, color: theme.navy, fontWeight: 600 }}>{f.value}</span>
                    </div>
                  ))}
                </div>

                {/* Contact */}
                {(phoneMap[selectedUser.id] || selectedUser.website) && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    {phoneMap[selectedUser.id] && (
                      <a href={`tel:${phoneMap[selectedUser.id]}`} style={{ flex: 1, textAlign: 'center', padding: 10, background: theme.tealGradient, color: '#fff', borderRadius: 12, fontWeight: 800, fontSize: 13, textDecoration: 'none' }}>
                        📞 Call
                      </a>
                    )}
                    {selectedUser.website && (
                      <a href={selectedUser.website.startsWith('http') ? selectedUser.website : `https://${selectedUser.website}`} target="_blank" rel="noreferrer" style={{ flex: 1, textAlign: 'center', padding: 10, background: '#fff', color: theme.tealDeep, border: `1px solid ${theme.tealDeep}`, borderRadius: 12, fontWeight: 800, fontSize: 13, textDecoration: 'none' }}>
                        🌐 Website
                      </a>
                    )}
                  </div>
                )}
                {phoneMap[selectedUser.id] && (
                  <p style={{ margin: '0 0 10px 0', fontSize: 12, color: theme.textLight, textAlign: 'center' }}>📱 {phoneMap[selectedUser.id]}</p>
                )}

                {/* Verify */}
                {!selectedUser.is_verified && (
                  verifyingUser === selectedUser.id ? (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                      <input value={verifySpecialty} onChange={(e) => setVerifySpecialty(e.target.value)} placeholder="Specialty (e.g. Pharmacist)" style={{ flex: 1, padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.tealDeep}`, borderRadius: 10 }} />
                      <button onClick={() => manualVerify(selectedUser.id, verifySpecialty)} style={{ padding: '8px 12px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 700 }}>✓ Verify</button>
                    </div>
                  ) : (
                    <button onClick={() => setVerifyingUser(selectedUser.id)} style={{ width: '100%', padding: 9, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                      ✓ Verify This User
                    </button>
                  )
                )}

                {/* Suspend */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <select value={suspendDays} onChange={(e) => setSuspendDays(e.target.value)} style={{ flex: 1, padding: 9, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 10, background: '#fff' }}>
                    <option value="1">Suspend 1 day</option>
                    <option value="3">Suspend 3 days</option>
                    <option value="7">Suspend 7 days</option>
                    <option value="14">Suspend 14 days</option>
                    <option value="30">Suspend 30 days</option>
                    <option value="365">Suspend 1 year</option>
                  </select>
                  <button onClick={() => suspendUser(selectedUser.id, suspendDays)} style={{ flex: 1, padding: 9, background: theme.amberBg, color: theme.amberText, border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13 }}>
                    ⏸ Suspend
                  </button>
                </div>

                {/* Delete */}
                {selectedUser.id !== adminUser?.id && (
                  <button onClick={() => deleteUser(selectedUser.id)} disabled={deletingUser} style={{ width: '100%', padding: 10, background: theme.dangerBg, color: theme.alert, border: `1px solid ${theme.alertLight}`, borderRadius: 12, fontWeight: 800, fontSize: 13 }}>
                    {deletingUser ? 'Deleting...' : '🗑️ Permanently Delete Account'}
                  </button>
                )}

                {/* Recent posts */}
                {userPosts.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <p style={{ fontSize: 11, fontWeight: 800, color: theme.textLight, textTransform: 'uppercase', margin: '0 0 8px 0' }}>Recent Posts ({userPosts.length})</p>
                    {userPosts.slice(0, 3).map(p => (
                      <div key={p.id} style={{ padding: '8px 0', borderTop: `1px solid ${theme.border}` }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase' }}>{p.post_type}</span>
                        <p style={{ margin: '2px 0 0 0', fontSize: 12, color: theme.textMid }}>{p.content?.slice(0, 100)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Filter bar */}
            <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 12, background: theme.cardBg, marginBottom: 12 }}>
              <p style={{ margin: '0 0 8px 0', fontSize: 12, fontWeight: 800, color: theme.navy }}>🔍 Filter Users</p>
              <input type="text" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Search by name or username..." style={{ ...input, marginBottom: 8 }} />
              <input type="text" value={userSpecialtyFilter} onChange={(e) => setUserSpecialtyFilter(e.target.value)} placeholder="Filter by title..." style={{ ...input, marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {['all','verified','unverified'].map(f => (
                  <button key={f} onClick={() => setUserVerifiedFilter(f)} style={{ flex: 1, padding: '6px 0', borderRadius: 10, fontSize: 11, fontWeight: 700, border: 'none', background: userVerifiedFilter === f ? theme.tealDeep : theme.bg, color: userVerifiedFilter === f ? '#fff' : theme.textMid, textTransform: 'capitalize' }}>{f}</button>
                ))}
              </div>
              <button onClick={() => {
                const filtered = users.filter(u => {
                  const matchSearch = !userSearch || (u.full_name || u.display_name || '').toLowerCase().includes(userSearch.toLowerCase())
                  const matchVerified = userVerifiedFilter === 'all' || (userVerifiedFilter === 'verified' ? u.is_verified : !u.is_verified)
                  const matchSpecialty = !userSpecialtyFilter || (u.verification_label || '').toLowerCase().includes(userSpecialtyFilter.toLowerCase())
                  return matchSearch && matchVerified && matchSpecialty
                })
                exportCSV(filtered, 'users_export.csv')
              }} style={{ width: '100%', padding: 8, background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 12 }}>Export Filtered CSV</button>
            </div>

            {users.filter(u => {
              const matchSearch = !userSearch || (u.full_name || u.display_name || '').toLowerCase().includes(userSearch.toLowerCase())
              const matchVerified = userVerifiedFilter === 'all' || (userVerifiedFilter === 'verified' ? u.is_verified : !u.is_verified)
              const matchSpecialty = !userSpecialtyFilter || (u.verification_label || '').toLowerCase().includes(userSpecialtyFilter.toLowerCase())
              return matchSearch && matchVerified && matchSpecialty
            }).map(u => (
              <div key={u.id} style={{ ...card, cursor: 'pointer' }} onClick={() => viewUserDetails(u)}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: u.cover_url ? `url(${u.cover_url})` : theme.tealGradient, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 800, flexShrink: 0 }}>
                    {!u.cover_url && (u.full_name || u.display_name || '?')[0]?.toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <p style={{ margin: '0 0 1px 0', fontWeight: 700, fontSize: 13.5, color: theme.navy }}>{u.full_name || u.display_name || 'No name'}</p>
                      {u.is_verified && <span style={{ fontSize: 9, fontWeight: 800, color: theme.tealDeep, background: theme.tealMist, padding: '1px 6px', borderRadius: 20 }}>✓</span>}
                    </div>
                    {u.display_name && u.full_name && <p style={{ margin: '0 0 1px 0', fontSize: 11, color: theme.textLight }}>@{u.display_name}</p>}
                    {u.verification_label && <p style={{ margin: '0 0 1px 0', fontSize: 11, color: theme.tealDeep, fontWeight: 700 }}>{u.verification_label}</p>}
                    {u.location && <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>📍 {u.location}</p>}
                    {phoneMap[u.id] && <p style={{ margin: '2px 0 0 0', fontSize: 11, color: theme.tealDeep, fontWeight: 700 }}>📱 {phoneMap[u.id]}</p>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{ fontSize: 10, color: theme.textLight }}>{timeAgo(u.created_at)}</span>
                    {phoneMap[u.id] && (
                      <a href={`tel:${phoneMap[u.id]}`} onClick={(e) => e.stopPropagation()} style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: theme.tealDeep, padding: '3px 10px', borderRadius: 20, textDecoration: 'none' }}>
                        📞 Call
                      </a>
                    )}
                    <span style={{ fontSize: 10, color: theme.tealDeep, fontWeight: 700 }}>Tap to manage →</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'posts' && (
          <div>
            {/* Post Detail Panel */}
            {selectedPost && (
              <div style={{ border: `1px solid ${theme.tealBright}`, borderRadius: 16, padding: 16, background: theme.tealMist, marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: theme.navy }}>📝 Post Detail</h3>
                  <button onClick={() => { setSelectedPost(null); setPostAuthor(null) }} style={{ background: 'none', border: 'none', fontSize: 18, color: theme.textLight }}>✕</button>
                </div>

                {/* Author */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, background: '#fff', borderRadius: 12, padding: 10 }}>
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: postAuthor?.cover_url ? `url(${postAuthor.cover_url})` : theme.tealGradient, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, fontWeight: 800, flexShrink: 0 }}>
                    {!postAuthor?.cover_url && (postAuthor?.full_name || postAuthor?.display_name || '?')[0]?.toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: theme.navy }}>{postAuthor?.full_name || postAuthor?.display_name || 'Unknown user'}</p>
                      {postAuthor?.is_verified && <span style={{ fontSize: 9, fontWeight: 800, color: theme.tealDeep, background: theme.tealMist, padding: '1px 6px', borderRadius: 20 }}>✓</span>}
                    </div>
                    {postAuthor?.display_name && postAuthor?.full_name && <p style={{ margin: '1px 0 0 0', fontSize: 11, color: theme.textLight }}>@{postAuthor.display_name}</p>}
                    {postAuthor?.verification_label && <p style={{ margin: '1px 0 0 0', fontSize: 11, color: theme.tealDeep, fontWeight: 700 }}>{postAuthor.verification_label}</p>}
                  </div>
                </div>

                {/* Meta */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', background: '#fff', padding: '3px 9px', borderRadius: 20 }}>{selectedPost.post_type}</span>
                  <span style={{ fontSize: 11, color: theme.textLight }}>{timeAgo(selectedPost.created_at)}</span>
                </div>

                {/* Full content */}
                <div style={{ background: '#fff', borderRadius: 12, padding: 14, marginBottom: 12 }}>
                  <p style={{ margin: 0, fontSize: 14, color: theme.textMid, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{selectedPost.content}</p>
                </div>

                {/* Delete */}
                <button onClick={() => { deletePost(selectedPost.id); setSelectedPost(null); setPostAuthor(null) }} style={{ width: '100%', padding: 10, background: theme.dangerBg, color: theme.alert, border: `1px solid ${theme.alertLight}`, borderRadius: 12, fontWeight: 800, fontSize: 13 }}>
                  🗑️ Delete This Post
                </button>
              </div>
            )}

            <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 12, background: theme.cardBg, marginBottom: 12 }}>
              <p style={{ margin: '0 0 8px 0', fontSize: 12, fontWeight: 800, color: theme.navy }}>🔍 Filter Posts</p>
              <input type="text" value={postSearch} onChange={(e) => setPostSearch(e.target.value)} placeholder="Search by keyword..." style={{ ...input, marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                {['all','text','question','review','article','visual','premium'].map(t => (
                  <button key={t} onClick={() => setPostTypeFilter(t)} style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, border: 'none', background: postTypeFilter === t ? theme.tealDeep : theme.bg, color: postTypeFilter === t ? '#fff' : theme.textMid, textTransform: 'capitalize' }}>{t}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 2 }}>From</label>
                  <input type="date" value={postDateFrom} onChange={(e) => setPostDateFrom(e.target.value)} style={{ ...input }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 2 }}>To</label>
                  <input type="date" value={postDateTo} onChange={(e) => setPostDateTo(e.target.value)} style={{ ...input }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => {
                  const filtered = posts.filter(p => {
                    const matchSearch = !postSearch || p.content?.toLowerCase().includes(postSearch.toLowerCase())
                    const matchType = postTypeFilter === 'all' || p.post_type === postTypeFilter
                    const matchFrom = !postDateFrom || p.created_at >= postDateFrom
                    const matchTo = !postDateTo || p.created_at <= postDateTo + 'T23:59:59'
                    return matchSearch && matchType && matchFrom && matchTo
                  })
                  exportCSV(filtered, 'filtered_posts.csv')
                }} style={{ flex: 1, padding: 8, background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 12 }}>
                  Export Filtered CSV
                </button>
                <button onClick={() => { setPostSearch(''); setPostTypeFilter('all'); setPostDateFrom(''); setPostDateTo('') }} style={{ padding: '0 12px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 10, fontSize: 11 }}>Clear</button>
              </div>
            </div>
            {(() => {
              const filtered = posts.filter(p => {
                const matchSearch = !postSearch || p.content?.toLowerCase().includes(postSearch.toLowerCase())
                const matchType = postTypeFilter === 'all' || p.post_type === postTypeFilter
                const matchFrom = !postDateFrom || p.created_at >= postDateFrom
                const matchTo = !postDateTo || p.created_at <= postDateTo + 'T23:59:59'
                return matchSearch && matchType && matchFrom && matchTo
              })
              return (
                <div>
                  <p style={{ fontSize: 11, color: theme.textLight, margin: '0 0 8px 0' }}>{filtered.length} post{filtered.length !== 1 ? 's' : ''} found</p>
                  {filtered.map(p => (
                    <div key={p.id} style={card}>
                      <div onClick={() => viewPostDetails(p)} style={{ cursor: 'pointer' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', background: theme.tealMist, padding: '2px 7px', borderRadius: 20 }}>{p.post_type}</span>
                          <span style={{ fontSize: 11, color: theme.textLight }}>{timeAgo(p.created_at)}</span>
                        </div>
                        <p style={{ margin: '0 0 6px 0', fontSize: 13, color: theme.textMid }}>{p.content?.slice(0, 150)}{p.content?.length > 150 ? '…' : ''}</p>
                        <p style={{ margin: '0 0 8px 0', fontSize: 11, color: theme.tealDeep, fontWeight: 700 }}>Tap to read full post →</p>
                      </div>
                      <button onClick={() => deletePost(p.id)} style={{ padding: '6px 12px', background: theme.dangerBg, color: theme.alert, border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>🗑️ Delete</button>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        )}

        {tab === 'revenue' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button onClick={() => exportCSV(transactions, 'transactions.csv')} style={{ padding: '8px 14px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 700 }}>Export CSV</button>
            </div>
            {transactions.map(t => (
              <div key={t.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ margin: '0 0 2px 0', fontWeight: 700, fontSize: 13, color: theme.navy, textTransform: 'capitalize' }}>{t.type?.replace('_', ' ')}</p>
                  <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{timeAgo(t.created_at)}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: '0 0 2px 0', fontWeight: 900, fontSize: 14, color: theme.success }}>{t.amount} 🪙</p>
                  {t.naira_amount && <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>₦{(t.naira_amount / 100).toLocaleString()}</p>}
                </div>
              </div>
            ))}
            {transactions.length === 0 && <p style={{ color: theme.textLight, fontSize: 13 }}>No transactions yet.</p>}
          </div>
        )}

        {tab === 'drugs' && (
          <div>
            <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 12, background: theme.cardBg, marginBottom: 12 }}>
              <p style={{ margin: '0 0 8px 0', fontSize: 12, fontWeight: 800, color: theme.navy }}>🔍 Drug Intelligence Search</p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input type="text" value={drugSearch} onChange={(e) => setDrugSearch(e.target.value)} placeholder="Medication name..." style={{ ...input, flex: 1 }} />
                <button onClick={searchDrugs} style={{ padding: '0 14px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13 }}>Search</button>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: theme.textLight, fontWeight: 700 }}>Rating:</span>
                {['all','1','2','3','4','5'].map(r => (
                  <button key={r} onClick={() => setDrugRatingFilter(r)} style={{ padding: '4px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, border: 'none', background: drugRatingFilter === r ? theme.tealDeep : theme.bg, color: drugRatingFilter === r ? '#fff' : theme.textMid }}>
                    {r === 'all' ? 'All' : '★'.repeat(parseInt(r))}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 2 }}>From</label>
                  <input type="date" value={drugDateFrom} onChange={(e) => setDrugDateFrom(e.target.value)} style={{ ...input }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 2 }}>To</label>
                  <input type="date" value={drugDateTo} onChange={(e) => setDrugDateTo(e.target.value)} style={{ ...input }} />
                </div>
              </div>
            </div>

            {drugReviews.length > 0 && (() => {
              const filtered = drugReviews.filter(r => {
                const matchRating = drugRatingFilter === 'all' || r.rating === parseInt(drugRatingFilter)
                const matchFrom = !drugDateFrom || r.created_at >= drugDateFrom
                const matchTo = !drugDateTo || r.created_at <= drugDateTo + 'T23:59:59'
                return matchRating && matchFrom && matchTo
              })
              const avgRating = filtered.length ? (filtered.reduce((s, r) => s + r.rating, 0) / filtered.length).toFixed(1) : 0
              const positive = filtered.filter(r => r.rating >= 4).length
              const negative = filtered.filter(r => r.rating <= 2).length
              return (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div>
                      <p style={{ margin: '0 0 2px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>{drugName}</p>
                      <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>{filtered.length} reviews · Avg: ★{avgRating}</p>
                    </div>
                    <button onClick={() => exportCSV(filtered, `${drugName}_filtered_reviews.csv`)} style={{ padding: '6px 10px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>Export CSV</button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    {[
                      { label: 'Positive', value: positive, color: theme.tealMist, textColor: theme.success },
                      { label: 'Neutral', value: filtered.length - positive - negative, color: theme.amberSoft, textColor: theme.amberText },
                      { label: 'Negative', value: negative, color: theme.dangerBg, textColor: theme.alert },
                    ].map(s => (
                      <div key={s.label} style={{ flex: 1, background: s.color, borderRadius: 12, padding: '10px 8px', textAlign: 'center' }}>
                        <p style={{ margin: '0 0 2px 0', fontSize: 18, fontWeight: 900, color: s.textColor }}>{s.value}</p>
                        <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: s.textColor }}>{s.label}</p>
                      </div>
                    ))}
                  </div>
                  {filtered.map(r => (
                    <div key={r.id} style={card}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <p style={{ margin: 0, color: '#f59e0b', fontSize: 13 }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</p>
                        <span style={{ fontSize: 11, color: theme.textLight }}>{timeAgo(r.created_at)}</span>
                      </div>
                      {r.comment && <p style={{ margin: 0, fontSize: 13, color: theme.textMid }}>{r.comment}</p>}
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        )}

        {tab === 'tasks' && (
          <div>
            <div style={card}>
              <p style={{ margin: '0 0 10px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>Create Sponsored Task</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Task Title" style={input} />
                <input type="number" value={taskComp} onChange={(e) => setTaskComp(e.target.value)} placeholder="Compensation (₦)" style={input} />
                <input value={taskSpec} onChange={(e) => setTaskSpec(e.target.value)} placeholder="Target Specialty (optional)" style={input} />
                <textarea value={taskDesc} onChange={(e) => setTaskDesc(e.target.value)} placeholder="Task description..." rows={3} style={{ ...input, resize: 'none', fontFamily: 'inherit' }} />
                <button onClick={createTask} disabled={savingTask} style={{ padding: 11, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 13 }}>
                  {savingTask ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </div>
            {tasks.map(t => (
              <div key={t.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: 13.5, color: theme.navy }}>{t.title}</p>
                  <p style={{ margin: 0, fontWeight: 900, fontSize: 13, color: theme.success }}>₦{t.compensation?.toLocaleString()}</p>
                </div>
                <p style={{ margin: '0 0 4px 0', fontSize: 12, color: theme.textMid }}>{t.description?.slice(0, 100)}</p>
                {t.specialty && <p style={{ margin: 0, fontSize: 11, color: theme.tealDeep, fontWeight: 700 }}>{t.specialty}</p>}
              </div>
            ))}
          </div>
        )}

        {tab === 'teams' && (
          <div>
            <div style={card}>
              <p style={{ margin: '0 0 10px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>Create Team</p>
              <form onSubmit={createTeam} style={{ display: 'flex', gap: 8 }}>
                <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name..." required style={{ ...input, flex: 1 }} />
                <button type="submit" style={{ padding: '0 14px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13 }}>Add</button>
              </form>
            </div>

            <div style={{ ...card, marginTop: 12 }}>
              <p style={{ margin: '0 0 10px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>Add Staff Member</p>
              {staffMsg && <p style={{ color: staffMsg.startsWith('Error') ? theme.alert : theme.success, fontSize: 13, margin: '0 0 8px 0' }}>{staffMsg}</p>}
              <form onSubmit={createStaff} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="Full Name" required style={input} />
                <input type="email" value={staffEmail} onChange={(e) => setStaffEmail(e.target.value)} placeholder="Email" required style={input} />
                <input type="password" value={staffPass} onChange={(e) => setStaffPass(e.target.value)} placeholder="Password" required style={input} />
                <select value={staffRole} onChange={(e) => setStaffRole(e.target.value)} style={{ ...input, background: '#fff' }}>
                  <option value="moderator">🛡️ Content Moderator</option>
                  <option value="verification_officer">🩺 Verification Officer</option>
                  <option value="business_manager">🏥 Business Manager</option>
                  <option value="support_agent">💬 Support Agent</option>
                  <option value="analytics_manager">📊 Analytics Manager</option>
                </select>
                <select value={staffTeam} onChange={(e) => setStaffTeam(e.target.value)} style={{ ...input, background: '#fff' }}>
                  <option value="">No team</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button type="submit" disabled={savingStaff} style={{ padding: 11, background: theme.navy, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 13 }}>
                  {savingStaff ? 'Creating...' : 'Create Staff Account'}
                </button>
              </form>
            </div>

            {teams.map(t => (
              <div key={t.id} style={{ ...card, marginTop: 12 }}>
                <p style={{ margin: '0 0 8px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>{t.name}</p>
                {staff.filter(s => s.team_id === t.id).map(m => (
                  <div key={m.id} style={{ padding: '8px 0', borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <p style={{ margin: '0 0 1px 0', fontSize: 13, fontWeight: 700, color: theme.navy }}>{m.full_name}</p>
                      <p style={{ margin: 0, fontSize: 11, color: theme.tealDeep, fontWeight: 700 }}>{m.role}</p>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 20, background: m.is_active ? theme.tealMist : theme.dangerBg, color: m.is_active ? theme.success : theme.alert }}>
                      {m.is_active ? 'Active' : 'Suspended'}
                    </span>
                  </div>
                ))}
                {staff.filter(s => s.team_id === t.id).length === 0 && <p style={{ color: theme.textLight, fontSize: 12, margin: 0 }}>No members yet</p>}
              </div>
            ))}

            {staff.filter(s => s.role === 'super_admin').map(m => (
              <div key={m.id} style={{ border: '1px solid #e9d5ff', borderRadius: 12, padding: 12, background: '#faf5ff', marginTop: 12 }}>
                <p style={{ margin: '0 0 2px 0', fontWeight: 800, fontSize: 13, color: '#7c3aed' }}>👑 {m.full_name}</p>
                <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{m.email} · Super Admin · Last login: {timeAgo(m.last_login)}</p>
              </div>
            ))}
          </div>
        )}


        {tab === 'withdrawals' && (
          <div>
            {withdrawals.length === 0 && <p style={{ color: theme.textLight, fontSize: 13 }}>No withdrawal requests yet.</p>}
            {withdrawals.map(w => (
              <div key={w.id} style={{ ...card, border: `1px solid ${w.status === 'pending' ? theme.alertLight : theme.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <p style={{ margin: '0 0 2px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>{w.profiles?.full_name || 'User'}</p>
                    <p style={{ margin: '0 0 2px 0', fontSize: 13, color: theme.tealDeep, fontWeight: 700 }}>₦{(w.amount * 200).toLocaleString()}</p>
                    {w.bank_name && <p style={{ margin: '0 0 2px 0', fontSize: 12, color: theme.textLight }}>{w.bank_name} · {w.account_number}</p>}
                    {w.account_name && <p style={{ margin: '0 0 2px 0', fontSize: 12, color: theme.textLight }}>{w.account_name}</p>}
                    <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{timeAgo(w.created_at)}</p>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 20, height: 'fit-content', background: w.status === 'approved' ? theme.tealMist : w.status === 'rejected' ? theme.dangerBg : theme.amberBg, color: w.status === 'approved' ? theme.success : w.status === 'rejected' ? theme.alert : theme.amberText }}>{w.status}</span>
                </div>
                {w.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={async () => { try { await callAdminAuth('approve_withdrawal', { token: localStorage.getItem('admin_token'), id: w.id }); loadAll(); showToast('Withdrawal approved', { type: 'success' }) } catch (err) { showToast(`Couldn't approve the withdrawal: ${err.message}`, { type: 'error' }) } }} style={{ flex: 1, padding: 9, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13 }}>✓ Approve</button>
                    <button onClick={async () => { try { await callAdminAuth('reject_withdrawal', { token: localStorage.getItem('admin_token'), id: w.id }); loadAll(); showToast('Withdrawal rejected', { type: 'success' }) } catch (err) { showToast(`Couldn't reject the withdrawal: ${err.message}`, { type: 'error' }) } }} style={{ flex: 1, padding: 9, background: theme.dangerBg, color: theme.alert, border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13 }}>✕ Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'businesses' && (
          <div>
            <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 12, background: theme.cardBg, marginBottom: 12 }}>
              <p style={{ margin: '0 0 8px 0', fontSize: 12, fontWeight: 800, color: theme.navy }}>🔍 Filter Companies</p>
              <input type="text" value={bizSearch} onChange={(e) => setBizSearch(e.target.value)} placeholder="Search company name..." style={{ ...input, marginBottom: 8 }} />
              <input type="text" value={bizStateFilter} onChange={(e) => setBizStateFilter(e.target.value)} placeholder="Filter by state/city..." style={{ ...input, marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                {['all','pharmacy','hospital','clinic','dental','optical','wellness','skincare'].map(t => (
                  <button key={t} onClick={() => setBizTypeFilter(t)} style={{ padding: '4px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, border: 'none', background: bizTypeFilter === t ? theme.tealDeep : theme.bg, color: bizTypeFilter === t ? '#fff' : theme.textMid, textTransform: 'capitalize' }}>{t}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {['all','claimed','unclaimed'].map(s => (
                  <button key={s} onClick={() => setBizStatusFilter(s)} style={{ flex: 1, padding: '6px 0', borderRadius: 10, fontSize: 11, fontWeight: 700, border: 'none', background: bizStatusFilter === s ? theme.tealDeep : theme.bg, color: bizStatusFilter === s ? '#fff' : theme.textMid, textTransform: 'capitalize' }}>{s}</button>
                ))}
              </div>
              <button onClick={() => {
                const filtered = businesses.filter(b => {
                  const matchSearch = !bizSearch || b.name?.toLowerCase().includes(bizSearch.toLowerCase())
                  const matchType = bizTypeFilter === 'all' || b.business_type === bizTypeFilter
                  const matchState = !bizStateFilter || (b.state || b.city || '').toLowerCase().includes(bizStateFilter.toLowerCase())
                  const matchStatus = bizStatusFilter === 'all' || (bizStatusFilter === 'claimed' ? b.visible_on_carefind : !b.visible_on_carefind)
                  return matchSearch && matchType && matchState && matchStatus
                })
                exportCSV(filtered, 'filtered_companies.csv')
              }} style={{ width: '100%', padding: 8, background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 12 }}>Export Filtered CSV</button>
            </div>

            {selectedBiz && (
              <div style={{ border: `1px solid ${theme.tealBright}`, borderRadius: 14, padding: 14, background: theme.tealMist, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: theme.navy }}>{selectedBiz.name}</p>
                  <button onClick={() => { setSelectedBiz(null); setBizReviews([]); setBizProducts([]) }} style={{ background: 'none', border: 'none', color: theme.textLight, fontSize: 18 }}>✕</button>
                </div>
                <p style={{ margin: '0 0 8px 0', fontSize: 12, color: theme.textLight, textTransform: 'capitalize' }}>{selectedBiz.business_type} · {selectedBiz.city}, {selectedBiz.state}</p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1, background: '#fff', borderRadius: 10, padding: '8px 6px', textAlign: 'center' }}>
                    <p style={{ margin: '0 0 2px 0', fontSize: 18, fontWeight: 900, color: theme.navy }}>{bizReviews.length}</p>
                    <p style={{ margin: 0, fontSize: 10, color: theme.textLight, fontWeight: 700 }}>Reviews</p>
                  </div>
                  <div style={{ flex: 1, background: '#fff', borderRadius: 10, padding: '8px 6px', textAlign: 'center' }}>
                    <p style={{ margin: '0 0 2px 0', fontSize: 18, fontWeight: 900, color: theme.navy }}>{bizProducts.length}</p>
                    <p style={{ margin: 0, fontSize: 10, color: theme.textLight, fontWeight: 700 }}>Products</p>
                  </div>
                  <div style={{ flex: 1, background: '#fff', borderRadius: 10, padding: '8px 6px', textAlign: 'center' }}>
                    <p style={{ margin: '0 0 2px 0', fontSize: 18, fontWeight: 900, color: bizReviews.length ? theme.tealDeep : theme.textLight }}>
                      {bizReviews.length ? (bizReviews.reduce((s, r) => s + r.rating, 0) / bizReviews.length).toFixed(1) : 'N/A'}
                    </p>
                    <p style={{ margin: 0, fontSize: 10, color: theme.textLight, fontWeight: 700 }}>Avg Rating</p>
                  </div>
                </div>
                <button onClick={() => exportCSV([...bizReviews, ...bizProducts], `${selectedBiz.name}_data.csv`)} style={{ width: '100%', padding: 8, background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 12 }}>Export Company Data CSV</button>
                {bizReviews.map(r => (
                  <div key={r.id} style={{ marginTop: 8, padding: '8px 0', borderTop: `1px solid ${theme.border}` }}>
                    <p style={{ margin: '0 0 2px 0', color: '#f59e0b', fontSize: 12 }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</p>
                    {r.comment && <p style={{ margin: 0, fontSize: 12, color: theme.textMid }}>{r.comment}</p>}
                  </div>
                ))}
              </div>
            )}

            {(() => {
              const filtered = businesses.filter(b => {
                const matchSearch = !bizSearch || b.name?.toLowerCase().includes(bizSearch.toLowerCase())
                const matchType = bizTypeFilter === 'all' || b.business_type === bizTypeFilter
                const matchState = !bizStateFilter || (b.state || b.city || '').toLowerCase().includes(bizStateFilter.toLowerCase())
                const matchStatus = bizStatusFilter === 'all' || (bizStatusFilter === 'claimed' ? b.visible_on_carefind : !b.visible_on_carefind)
                return matchSearch && matchType && matchState && matchStatus
              })
              return (
                <div>
                  <p style={{ fontSize: 11, color: theme.textLight, margin: '0 0 8px 0' }}>{filtered.length} compan{filtered.length !== 1 ? 'ies' : 'y'} found</p>
                  {filtered.map(b => (
                    <div key={b.id} style={{ ...card, cursor: 'pointer' }} onClick={async () => {
                      setSelectedBiz(b)
                      const [revRes, prodRes] = await Promise.all([
                        supabase.from('reviews').select('*').eq('business_id', b.id),
                        supabase.from('products').select('*').eq('business_id', b.id),
                      ])
                      setBizReviews(revRes.data || [])
                      setBizProducts(prodRes.data || [])
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: '0 0 2px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>{b.name}</p>
                          <p style={{ margin: '0 0 4px 0', fontSize: 12, color: theme.textLight, textTransform: 'capitalize' }}>{b.business_type} · {b.city}, {b.state}</p>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                          <span style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 7px', borderRadius: 20, background: b.visible_on_carefind ? theme.tealMist : theme.amberBg, color: b.visible_on_carefind ? theme.success : theme.amberText }}>
                            {b.visible_on_carefind ? 'Claimed' : 'Unclaimed'}
                          </span>
                          <span style={{ fontSize: 10, color: theme.textLight }}>Tap to view</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        )}

        {tab === 'stories' && (
          <div>
            <div style={card}>
              <p style={{ margin: '0 0 10px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>📸 Post a Story</p>
              <p style={{ margin: '0 0 12px 0', fontSize: 11.5, color: theme.textLight }}>Stories appear at the top of the feed for all users and auto-expire after 24 hours.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input value={storyTitle} onChange={(e) => setStoryTitle(e.target.value)} placeholder="Story title (e.g. New Feature!)" style={input} />
                <textarea value={storyBody} onChange={(e) => setStoryBody(e.target.value)} placeholder="Story message..." rows={3} style={{ ...input, resize: 'none', fontFamily: 'inherit' }} />

                <div>
                  <p style={{ margin: '0 0 6px 0', fontSize: 11.5, fontWeight: 700, color: theme.textMid }}>Background color (for text stories)</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {['#0E6F5A', '#0B4A3E', '#7c3aed', '#be123c', '#c2410c', '#0369a1'].map(c => (
                      <button key={c} onClick={() => setStoryBg(c)} style={{
                        width: 34, height: 34, borderRadius: '50%', background: c, cursor: 'pointer',
                        border: storyBg === c ? '3px solid #000' : '2px solid #fff', boxShadow: '0 0 0 1px #ccc',
                      }} />
                    ))}
                  </div>
                </div>

                <label style={{ fontSize: 13, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer' }}>
                  📷 {storyImageFile ? storyImageFile.name : 'Add an image (optional)'}
                  <input type="file" accept="image/*" onChange={(e) => setStoryImageFile(e.target.files[0] || null)} style={{ display: 'none' }} />
                </label>

                {/* Preview */}
                <div style={{
                  borderRadius: 14, padding: 20, minHeight: 90, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: storyImageFile ? '#e5e7eb' : storyBg, textAlign: 'center',
                }}>
                  {storyImageFile ? (
                    <span style={{ fontSize: 12, color: theme.textMid }}>🖼️ Image selected: text shows over it</span>
                  ) : (
                    <div>
                      {storyTitle && <p style={{ margin: '0 0 6px 0', color: '#fff', fontWeight: 900, fontSize: 16 }}>{storyTitle}</p>}
                      {storyBody && <p style={{ margin: 0, color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>{storyBody}</p>}
                      {!storyTitle && !storyBody && <p style={{ margin: 0, color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>Preview</p>}
                    </div>
                  )}
                </div>

                <button onClick={createStory} disabled={savingStory} style={{ padding: 11, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 13 }}>
                  {savingStory ? 'Posting...' : 'Post Story'}
                </button>
              </div>
            </div>

            {/* Active stories */}
            {stories.length === 0 && <p style={{ color: theme.textLight, fontSize: 13 }}>No stories posted yet.</p>}
            {stories.map(s => {
              const expired = new Date(s.expires_at) < new Date()
              return (
                <div key={s.id} style={{ ...card, opacity: expired ? 0.5 : 1 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{
                      width: 46, height: 46, borderRadius: 10, flexShrink: 0,
                      background: s.image_url ? `url(${s.image_url})` : (s.bg_color || theme.tealDeep),
                      backgroundSize: 'cover', backgroundPosition: 'center',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900,
                    }}>
                      {!s.image_url && (s.title?.[0]?.toUpperCase() || '★')}
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: '0 0 2px 0', fontWeight: 800, fontSize: 13, color: theme.navy }}>{s.title || '(no title)'}</p>
                      {s.body && <p style={{ margin: '0 0 2px 0', fontSize: 12, color: theme.textMid }}>{s.body.slice(0, 60)}</p>}
                      <p style={{ margin: 0, fontSize: 11, color: expired ? theme.alert : theme.textLight }}>
                        {expired ? '⏰ Expired' : `Expires ${timeAgo(s.expires_at).replace(' ago', '')} from now`} · {timeAgo(s.created_at)}
                      </p>
                    </div>
                    <button onClick={() => deleteStory(s.id)} style={{ padding: '6px 10px', background: theme.dangerBg, color: theme.alert, border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>🗑️</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'news' && (
          <div>
            {newsItems.length === 0 && <p style={{ color: theme.textLight, fontSize: 13 }}>No news submissions yet.</p>}
            {newsItems.map(n => {
              const isEditing = editingNews && editingNews.id === n.id
              const phone = newsPhones[n.author_id]
              return (
                <div key={n.id} style={{ ...card, border: `1px solid ${n.status === 'pending' ? theme.alertLight : theme.border}` }}>
                  {/* Status + submitter */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 20, background: n.status === 'approved' ? theme.tealMist : n.status === 'rejected' ? theme.dangerBg : theme.amberBg, color: n.status === 'approved' ? theme.success : n.status === 'rejected' ? theme.alert : theme.amberText }}>{n.status}</span>
                      <p style={{ margin: '6px 0 0 0', fontSize: 11.5, color: theme.textLight }}>
                        Submitted by <strong style={{ color: theme.navy }}>{n.profiles?.full_name || n.profiles?.display_name || 'User'}</strong> · {timeAgo(n.created_at)}
                      </p>
                    </div>
                  </div>

                  {/* Contact submitter */}
                  {(n.contact_phone || n.contact_email || phone) && (
                    <div style={{ background: theme.tealMist, borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
                      <p style={{ margin: '0 0 6px 0', fontSize: 11, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase' }}>Contact submitter</p>
                      {(n.contact_phone || phone) && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 12.5, color: theme.textMid, fontWeight: 600, flex: 1 }}>📱 {n.contact_phone || phone}</span>
                          <a href={`tel:${n.contact_phone || phone}`} style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: theme.tealDeep, padding: '5px 12px', borderRadius: 16, textDecoration: 'none' }}>📞 Call</a>
                        </div>
                      )}
                      {n.contact_email && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 12.5, color: theme.textMid, fontWeight: 600, flex: 1 }}>✉️ {n.contact_email}</span>
                          <a href={`mailto:${n.contact_email}`} style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: theme.tealDeep, padding: '5px 12px', borderRadius: 16, textDecoration: 'none' }}>Email</a>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Hero */}
                  {n.hero_image_url && <div style={{ width: '100%', height: 120, borderRadius: 10, background: `url(${n.hero_image_url})`, backgroundSize: 'cover', backgroundPosition: 'center', marginBottom: 10 }} />}

                  {/* Editable fields */}
                  {isEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                      <input value={editingNews.headline} onChange={(e) => setEditingNews({ ...editingNews, headline: e.target.value })} placeholder="Headline" style={{ ...input, fontWeight: 700 }} />
                      <input value={editingNews.subtitle || ''} onChange={(e) => setEditingNews({ ...editingNews, subtitle: e.target.value })} placeholder="Subtitle" style={input} />
                      <textarea value={editingNews.body || ''} onChange={(e) => setEditingNews({ ...editingNews, body: e.target.value })} rows={6} placeholder="Body" style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} />
                      <p style={{ margin: 0, fontSize: 10.5, color: theme.textLight }}>Note: body is stored as rich blocks; heavy formatting is best done in-app. Light text edits here are fine.</p>
                    </div>
                  ) : (
                    <div style={{ marginBottom: 10 }}>
                      <p style={{ margin: '0 0 4px 0', fontWeight: 800, fontSize: 15, color: theme.navy }}>{n.headline}</p>
                      {n.subtitle && <p style={{ margin: '0 0 6px 0', fontSize: 13, color: theme.textMid, fontStyle: 'italic' }}>{n.subtitle}</p>}
                      <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>{(n.body || '').replace(/[{}\[\]"]/g, ' ').slice(0, 180)}…</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {!isEditing && n.status === 'pending' && (
                      <button onClick={() => setEditingNews({ id: n.id, headline: n.headline, subtitle: n.subtitle, body: n.body })} style={{ flex: 1, padding: 9, background: theme.bg, color: theme.navy, border: `1px solid ${theme.border}`, borderRadius: 10, fontWeight: 700, fontSize: 13 }}>✏️ Edit</button>
                    )}
                    {isEditing && (
                      <button onClick={() => setEditingNews(null)} style={{ padding: '9px 12px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 10, fontWeight: 700, fontSize: 13 }}>Cancel edit</button>
                    )}
                    {n.status !== 'approved' && (
                      <button onClick={() => approveNews(n)} disabled={savingNews} style={{ flex: 1, padding: 9, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13 }}>✓ {isEditing ? 'Save & Publish' : 'Approve & Publish'}</button>
                    )}
                    {n.status === 'pending' && (
                      <button onClick={() => rejectNews(n.id)} style={{ flex: 1, padding: 9, background: theme.dangerBg, color: theme.alert, border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13 }}>✕ Reject</button>
                    )}
                    <button onClick={() => deleteNews(n.id)} style={{ padding: '9px 12px', background: theme.dangerBg, color: theme.alert, border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13 }}>🗑️</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'promotions' && (
          <div>
            <div style={card}>
              <p style={{ margin: '0 0 6px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>🎯 Add a Promotion</p>
              <p style={{ margin: '0 0 12px 0', fontSize: 11.5, color: theme.textLight }}>Promotions appear in the moving featured strip on MedMarket. They auto-expire on the date you set.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input value={promoTitle} onChange={(e) => setPromoTitle(e.target.value)} placeholder="Promotion title (e.g. 50% off Vitamin C)" style={input} />
                <input value={promoLink} onChange={(e) => setPromoLink(e.target.value)} placeholder="Link (e.g. /business/xyz or product page)" style={input} />
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: theme.textMid, display: 'block', marginBottom: 4 }}>Runs for</label>
                  <select value={promoDays} onChange={(e) => setPromoDays(e.target.value)} style={{ ...input, background: '#fff' }}>
                    <option value="3">3 days</option>
                    <option value="7">7 days</option>
                    <option value="14">14 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                  </select>
                </div>
                <label style={{ fontSize: 13, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer' }}>
                  📷 {promoImage ? promoImage.name : 'Upload promotion image'}
                  <input type="file" accept="image/*" onChange={(e) => setPromoImage(e.target.files[0] || null)} style={{ display: 'none' }} />
                </label>
                <button onClick={createPromotion} disabled={savingPromo} style={{ padding: 11, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 13 }}>
                  {savingPromo ? 'Posting...' : 'Add Promotion'}
                </button>
              </div>
            </div>

            {promotions.length === 0 && <p style={{ color: theme.textLight, fontSize: 13 }}>No promotions yet.</p>}
            {promotions.map(p => {
              const expired = p.expires_at && new Date(p.expires_at) < new Date()
              return (
                <div key={p.id} style={{ ...card, opacity: expired ? 0.5 : 1 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ width: 60, height: 60, borderRadius: 10, flexShrink: 0, background: p.image_url ? `url(${p.image_url})` : theme.tealGradient, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800 }}>
                      {!p.image_url && '🎯'}
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: '0 0 2px 0', fontWeight: 800, fontSize: 13, color: theme.navy }}>{p.title}</p>
                      {p.link_url && <p style={{ margin: '0 0 2px 0', fontSize: 11, color: theme.tealDeep }}>{p.link_url}</p>}
                      <p style={{ margin: 0, fontSize: 11, color: expired ? theme.alert : theme.textLight }}>
                        {expired ? '⏰ Expired' : p.expires_at ? `Expires ${new Date(p.expires_at).toLocaleDateString()}` : 'No expiry'}
                      </p>
                    </div>
                    <button onClick={() => deletePromotion(p.id)} style={{ padding: '6px 10px', background: theme.dangerBg, color: theme.alert, border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>🗑️</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'searches' && (
          <div>
            {(() => {
              const typed = searchLogs.filter(s => s.query)
              const notFound = typed.filter(s => !s.found)
              // Tally most-searched terms
              const tally = {}
              typed.forEach(s => { const k = s.query.toLowerCase().trim(); tally[k] = (tally[k] || 0) + 1 })
              const topTerms = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 12)
              // Tally unmet demand (not found terms)
              const gapTally = {}
              notFound.forEach(s => { const k = s.query.toLowerCase().trim(); gapTally[k] = (gapTally[k] || 0) + 1 })
              const gaps = Object.entries(gapTally).sort((a, b) => b[1] - a[1]).slice(0, 15)
              return (
                <>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                    <div style={{ ...card, flex: 1, margin: 0, textAlign: 'center' }}>
                      <p style={{ margin: 0, fontSize: 22, fontWeight: 900, color: theme.navy }}>{typed.length}</p>
                      <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>Total searches</p>
                    </div>
                    <div style={{ ...card, flex: 1, margin: 0, textAlign: 'center' }}>
                      <p style={{ margin: 0, fontSize: 22, fontWeight: 900, color: theme.alert }}>{notFound.length}</p>
                      <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>Found nothing</p>
                    </div>
                  </div>

                  {/* Demand gaps — the gold */}
                  <div style={card}>
                    <p style={{ margin: '0 0 4px 0', fontWeight: 800, fontSize: 14, color: theme.alert }}>🎯 Demand gaps: searched but NOT found</p>
                    <p style={{ margin: '0 0 12px 0', fontSize: 11.5, color: theme.textLight }}>These are products/services people want that you don't have yet. Consider stocking or adding them.</p>
                    {gaps.length === 0 && <p style={{ fontSize: 13, color: theme.textLight }}>No unmet searches yet.</p>}
                    {gaps.map(([term, count]) => (
                      <div key={term} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: theme.dangerBg, borderRadius: 10, marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: theme.navy, textTransform: 'capitalize' }}>{term}</span>
                        <span style={{ fontSize: 11, fontWeight: 800, color: theme.alert, background: '#fff', padding: '3px 9px', borderRadius: 12 }}>{count}× wanted</span>
                      </div>
                    ))}
                  </div>

                  {/* Most searched overall */}
                  <div style={card}>
                    <p style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>🔥 Most searched terms</p>
                    {topTerms.length === 0 && <p style={{ fontSize: 13, color: theme.textLight }}>No searches yet.</p>}
                    {topTerms.map(([term, count]) => (
                      <div key={term} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${theme.border}` }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: theme.navy, textTransform: 'capitalize' }}>{term}</span>
                        <span style={{ fontSize: 12, fontWeight: 800, color: theme.tealDeep }}>{count}</span>
                      </div>
                    ))}
                  </div>

                  {/* Recent searches with user */}
                  <div style={card}>
                    <p style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>🕐 Recent searches</p>
                    {typed.slice(0, 40).map(s => (
                      <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${theme.border}` }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: theme.navy }}>{s.query}</span>
                          <span style={{ fontSize: 10.5, color: theme.textLight, marginLeft: 8 }}>{s.category} · {s.profiles?.full_name || s.profiles?.display_name || 'Guest'}</span>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: s.found ? theme.tealMist : theme.dangerBg, color: s.found ? theme.success : theme.alert }}>{s.found ? `${s.results_count} found` : 'none'}</span>
                      </div>
                    ))}
                  </div>
                </>
              )
            })()}
          </div>
        )}

        {tab === 'golive' && (
          <div>
            {/* Active shows */}
            {activeShows.length > 0 && (
              <div style={card}>
                <p style={{ margin: '0 0 10px 0', fontWeight: 800, fontSize: 14, color: '#dc2626' }}>🔴 Currently Live</p>
                {activeShows.map(s => (
                  <div key={s.id} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${theme.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: theme.navy }}>{s.title}</p>
                        <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>Started {new Date(s.started_at).toLocaleTimeString()}</p>
                      </div>
                      <a href={`/live-show/${s.id}`} style={{ fontSize: 11, fontWeight: 800, color: theme.tealDeep, background: theme.tealMist, padding: '6px 10px', borderRadius: 16, textDecoration: 'none' }}>👁 Audience</a>
                      <button onClick={() => endLiveShow(s.id)} style={{ fontSize: 11, fontWeight: 700, color: theme.alert, background: theme.dangerBg, border: 'none', padding: '6px 10px', borderRadius: 16 }}>End</button>
                    </div>

                    {/* Control room: post to this show */}
                    <button onClick={() => loadLiveControl(s.id)} style={{ width: '100%', padding: 8, background: theme.bg, color: theme.navy, border: `1px solid ${theme.border}`, borderRadius: 10, fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
                      🎛 Load Control Room
                    </button>

                    {/* Live engagement stats (host sees their numbers) */}
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', padding: '8px 0', marginBottom: 8, background: theme.navy, borderRadius: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>❤️ {liveStats.likes}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>👁 {liveStats.views}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>🔗 {liveStats.shares}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#fde68a' }}>🎁 {liveStats.gifts}</span>
                    </div>

                    <textarea value={liveDraft} onChange={(e) => setLiveDraft(e.target.value)} placeholder="Type something to broadcast live…" rows={2} style={{ ...input, resize: 'none', fontFamily: 'inherit', marginBottom: 6 }} />
                    <VoiceRecorder showId={s.id} onRecorded={(url) => postLiveVoice(s.id, url)} />
                    <SlideUploader showId={s.id} onPostSlide={(url, num, total) => postLiveSlide(s.id, url, num, total)} />
                    <VideoRecorder showId={s.id} onRecorded={(url) => postLiveVideo(s.id, url)} />
                    <VideoUploader showId={s.id} onUploaded={(url) => postLiveVideo(s.id, url)} />
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                      <label style={{ fontSize: 12, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer', flex: 1 }}>
                        📷 {liveImage ? liveImage.name.slice(0, 16) : 'Add image'}
                        <input type="file" accept="image/*" onChange={(e) => setLiveImage(e.target.files[0] || null)} style={{ display: 'none' }} />
                      </label>
                      <button onClick={() => postLiveItem(s.id)} disabled={postingLive} style={{ padding: '8px 18px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13 }}>
                        {postingLive ? 'Posting…' : '📡 Post Live'}
                      </button>
                    </div>

                    {/* Posted items */}
                    {liveItems.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <p style={{ margin: '0 0 6px 0', fontSize: 10.5, fontWeight: 800, color: theme.textLight, textTransform: 'uppercase' }}>Posted ({liveItems.length})</p>
                        {liveItems.map(it => (
                          <div key={it.id} style={{ background: theme.bg, borderRadius: 8, padding: it.kind === 'image' ? 4 : '6px 10px', marginBottom: 4 }}>
                            {it.kind === 'text' && <p style={{ margin: 0, fontSize: 12.5, color: theme.textDark }}>{it.content}</p>}
                            {it.kind === 'image' && <img src={it.content} alt="" style={{ maxWidth: 120, borderRadius: 6, display: 'block' }} />}
                            {it.kind === 'voice' && <audio controls src={it.content} style={{ height: 32, maxWidth: 180 }} />}
                            {it.kind === 'video' && <video controls playsInline src={it.content} style={{ maxWidth: 160, borderRadius: 6, display: 'block' }} />}
                            {it.kind === 'slide' && <div><span style={{ fontSize: 9, fontWeight: 800, color: theme.tealDeep }}>📑 Slide {(it.content||'').split('|||')[1]}</span><img src={(it.content||'').split('|||')[0]} alt="slide" style={{ maxWidth: 120, borderRadius: 6, display: 'block', marginTop: 2 }} /></div>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Audience comments to moderate */}
                    {liveComments.length > 0 && (
                      <div>
                        <p style={{ margin: '0 0 6px 0', fontSize: 10.5, fontWeight: 800, color: theme.textLight, textTransform: 'uppercase' }}>💬 Audience comments</p>
                        {liveComments.map(c => (
                          <div key={c.id} style={{ display: 'flex', gap: 6, marginBottom: 5, opacity: c.hidden ? 0.4 : 1 }}>
                            <span style={{ flex: 1, fontSize: 12, color: theme.textMid }}>
                              <strong style={{ color: theme.navy }}>{c.profiles?.full_name || c.profiles?.display_name || 'User'}:</strong> {c.content}
                            </span>
                            {!c.hidden && <button onClick={() => hideLiveComment(c.id, s.id)} style={{ background: 'none', border: 'none', color: theme.alert, fontSize: 10.5, fontWeight: 700 }}>Hide</button>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Scheduled / upcoming shows */}
            {scheduledShows.length > 0 && (
              <div style={card}>
                <p style={{ margin: '0 0 10px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>📅 Scheduled Shows</p>
                {scheduledShows.map(s => (
                  <div key={s.id} style={{ padding: '10px 0', borderBottom: `1px solid ${theme.border}` }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: theme.navy }}>{s.title}</p>
                    <p style={{ margin: '0 0 8px 0', fontSize: 11, color: theme.tealDeep, fontWeight: 700 }}>🕐 {new Date(s.scheduled_at).toLocaleString()}</p>
                    {s.trailer_url && <video src={s.trailer_url} controls playsInline style={{ maxWidth: 160, borderRadius: 8, display: 'block', marginBottom: 8 }} />}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => startScheduledShow(s.id)} style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: '#dc2626', border: 'none', padding: '8px 14px', borderRadius: 16 }}>📡 Start Now</button>
                      <a href={`/live-show/${s.id}`} style={{ fontSize: 12, fontWeight: 700, color: theme.tealDeep, background: theme.tealMist, padding: '8px 12px', borderRadius: 16, textDecoration: 'none' }}>👁 Preview</a>
                      <button onClick={() => cancelScheduledShow(s.id)} style={{ fontSize: 12, fontWeight: 700, color: theme.alert, background: theme.dangerBg, border: 'none', padding: '8px 12px', borderRadius: 16 }}>Cancel</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={card}>
              <p style={{ margin: '0 0 6px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>📡 Start a Live Show</p>
              <p style={{ margin: '0 0 12px 0', fontSize: 11.5, color: theme.textLight }}>Go live on CareFind. A red LIVE indicator shows in everyone's stories row. Invite guests to co-host. They'll get a notification.</p>
              <input value={liveTitle} onChange={(e) => setLiveTitle(e.target.value)} placeholder="Show title (e.g. Malaria Awareness Live)" style={{ ...input, marginBottom: 12 }} />

              <p style={{ margin: '0 0 6px 0', fontSize: 12, fontWeight: 700, color: theme.navy }}>Invite guests to co-host ({liveGuests.length} selected)</p>
              <input value={guestSearch} onChange={(e) => setGuestSearch(e.target.value)} placeholder="Search users by name…" style={{ ...input, marginBottom: 8 }} />
              <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 12 }}>
                {users.filter(u => {
                  const n = (u.full_name || u.display_name || '').toLowerCase()
                  return guestSearch.trim() ? n.includes(guestSearch.toLowerCase()) : true
                }).slice(0, 30).map(u => {
                  const selected = liveGuests.some(g => g.id === u.id)
                  return (
                    <div key={u.id} onClick={() => toggleGuest(u)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, marginBottom: 4, cursor: 'pointer', background: selected ? theme.tealMist : theme.bg, border: `1px solid ${selected ? theme.tealDeep : 'transparent'}` }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: theme.tealGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                        {(u.full_name?.[0] || u.display_name?.[0] || '?').toUpperCase()}
                      </div>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: theme.navy }}>{u.full_name || u.display_name || 'User'}</span>
                      {selected && <span style={{ fontSize: 12, fontWeight: 800, color: theme.tealDeep }}>✓</span>}
                    </div>
                  )
                })}
              </div>

              <button onClick={startLiveShow} disabled={creatingShow} style={{ width: '100%', padding: 13, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 14, marginBottom: 14 }}>
                {creatingShow ? 'Starting…' : '📡 Go Live Now'}
              </button>

              {/* Schedule for later */}
              <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 14 }}>
                <p style={{ margin: '0 0 6px 0', fontSize: 13, fontWeight: 800, color: theme.navy }}>📅 Or schedule for later</p>
                <p style={{ margin: '0 0 8px 0', fontSize: 11, color: theme.textLight }}>Set a time and an optional trailer. A countdown shows in the stories row so your audience knows a live is coming.</p>
                <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} style={{ ...input, marginBottom: 8 }} />
                <label style={{ display: 'block', fontSize: 12.5, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer', marginBottom: 10 }}>
                  🎬 {trailerFile ? trailerFile.name.slice(0, 24) : 'Add trailer video (optional)'}
                  <input type="file" accept="video/*" onChange={(e) => setTrailerFile(e.target.files[0] || null)} style={{ display: 'none' }} />
                </label>
                <button onClick={scheduleShow} disabled={creatingShow} style={{ width: '100%', padding: 12, background: theme.navy, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 13 }}>
                  {creatingShow ? 'Scheduling…' : '📅 Schedule Show'}
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'notifications' && (
          <div>
            {notifications.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px 10px' }}>
                <p style={{ fontSize: 30, margin: '0 0 10px 0' }}>🔔</p>
                <p style={{ color: theme.textLight, fontSize: 13 }}>All clear. No pending issues</p>
              </div>
            )}
            {notifications.map((n, i) => (
              <div key={i} onClick={() => setTab(n.tab)} style={{ ...card, cursor: 'pointer', borderLeft: `4px solid ${n.severity === 'urgent' ? theme.alert : n.severity === 'warning' ? '#f59e0b' : theme.tealDeep}` }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 20 }}>{n.icon}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: '0 0 2px 0', fontWeight: 700, fontSize: 13, color: theme.navy }}>{n.title}</p>
                    {n.subtitle && <p style={{ margin: '0 0 4px 0', fontSize: 12, color: theme.textMid }}>{n.subtitle}</p>}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: theme.textLight }}>{timeAgo(n.time)}</span>
                      <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 20, background: n.severity === 'urgent' ? theme.dangerBg : n.severity === 'warning' ? theme.amberBg : theme.tealMist, color: n.severity === 'urgent' ? theme.alert : n.severity === 'warning' ? theme.amberText : theme.tealDeep, textTransform: 'uppercase' }}>{n.severity}</span>
                    </div>
                  </div>
                  <span style={{ color: theme.textLight, fontSize: 14 }}>›</span>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
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
    </>
  )
}
