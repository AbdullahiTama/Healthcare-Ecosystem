import { useEffect, useState } from 'react'
import { supabase } from '../../../config/supabaseClient'
import { commerceRepository } from '../repositories/commerceRepository'
import { liveRepository } from '../repositories/liveRepository'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../provider/AdminProvider.jsx'
import { ALL_TABS } from '../navigation'
import { useAdminData, useAdminSearchLogs, useAdminLiveShows, useAdminShopData, useAdminRoles } from '../../../hooks/queries'
import ShopTab from '../tabs/ShopTab.jsx'
import DrugsTab from '../tabs/DrugsTab.jsx'
import TasksTab from '../tabs/TasksTab.jsx'
import TeamsTab from '../tabs/TeamsTab.jsx'
import SearchesTab from '../tabs/SearchesTab.jsx'
import GoLiveTab from '../tabs/GoLiveTab.jsx'
import NotificationsTab from '../tabs/NotificationsTab.jsx'
import EmailTemplatesTab from '../tabs/EmailTemplatesTab.jsx'
import AuditLog from '../components/AuditLog.jsx'
import ErrorsTab from '../tabs/ErrorsTab.jsx'

// The screens that have not been redesigned yet. They still receive the state
// and handlers they were written against; each redesign phase moves a tab's
// state into its own section file and deletes its share of this file.
// Session, toasts, confirm and sign-out come from AdminProvider.

export default function LegacyTabHost({ tab, setTab }) {
  const { adminUser, permissions: adminPermissions, showToast, askConfirm, invalidateAdmin } = useAdmin()

  const [drugSearch, setDrugSearch] = useState('')
  const [drugReviews, setDrugReviews] = useState([])
  const [drugName, setDrugName] = useState('')
  const [drugRatingFilter, setDrugRatingFilter] = useState('all')
  const [drugDateFrom, setDrugDateFrom] = useState('')
  const [drugDateTo, setDrugDateTo] = useState('')
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
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
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
  const [newRoleName, setNewRoleName] = useState('')
  const [newRoleDesc, setNewRoleDesc] = useState('')
  const [newRoleTabs, setNewRoleTabs] = useState({})
  const [editingRoleId, setEditingRoleId] = useState(null)
  const [editingRoleTabs, setEditingRoleTabs] = useState({})
  const [savingRole, setSavingRole] = useState(false)

  const { data: adminData } = useAdminData(!!adminUser)
  const { data: searchLogs = [] } = useAdminSearchLogs(!!adminUser)
  const { data: liveShowsData } = useAdminLiveShows(!!adminUser)
  const { data: shopData } = useAdminShopData(!!adminUser)
  const { data: adminRoles = [] } = useAdminRoles(!!adminUser)

  const { users = [], tasks = [], teams = [], staff = [], notifications = [], notifCount = 0, roleNotifCount = 0, stats = {} } = adminData || {}
  const activeShows = liveShowsData?.active || []
  const scheduledShows = liveShowsData?.scheduled || []
  const ecomApps = shopData?.apps || []
  const ecomProductsAdmin = shopData?.products || []
  const shopOrdersAdmin = shopData?.orders || []

  async function updateEcomApp(id, status) {
    try {
      await callAdminAuth('update_ecommerce_application', {  id, status })
      showToast(`Application ${status}`, { type: 'success' }); invalidateAdmin()
    } catch (e) { showToast(e.message, { type: 'error' }) }
  }
  async function moderateProduct(id, patch) {
    try {
      await callAdminAuth('moderate_ecommerce_product', {  id, ...patch })
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
      await callAdminAuth('start_scheduled_show', {  showId })
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
      await callAdminAuth('cancel_scheduled_show', {  showId })
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
      await callAdminAuth('end_live_show', {  showId })
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
      await callAdminAuth('hide_live_comment', {  id: cid })
      loadLiveControl(showId)
    } catch (err) {
      showToast(`Couldn't hide the comment: ${err.message}`, { type: 'error' })
    }
  }

  async function postLiveVoice(showId, url) {
    await callAdminAuth('post_live_item', {  showId, kind: 'voice', content: url }).catch(err => showToast(`Couldn't post the voice note: ${err.message}`, { type: 'error' }))
    loadLiveControl(showId)
  }

  async function postLiveSlide(showId, url, num, total) {
    await callAdminAuth('post_live_item', {  showId, kind: 'slide', content: `${url}|||${num}|||${total}` }).catch(err => showToast(`Couldn't post the slide: ${err.message}`, { type: 'error' }))
    loadLiveControl(showId)
  }

  async function postLiveVideo(showId, url) {
    await callAdminAuth('post_live_item', {  showId, kind: 'video', content: url }).catch(err => showToast(`Couldn't post the video: ${err.message}`, { type: 'error' }))
    loadLiveControl(showId)
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
      await callAdminAuth('create_task', {  title: taskTitle, description: taskDesc, compensation: taskComp, specialty: taskSpec || null })
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
      await callAdminAuth('create_team', {  name: teamName })
      setTeamName(''); invalidateAdmin()
    } catch (err) {
      setStaffMsg('Error: ' + err.message)
    }
  }

  return (
    <div>
      {tab === 'audit_log' && <AuditLog />}
      {tab === 'errors' && <ErrorsTab showToast={showToast} />}
      {tab === 'drugs' && <DrugsTab drugSearch={drugSearch} setDrugSearch={setDrugSearch} drugReviews={drugReviews} drugName={drugName} setDrugName={setDrugName} drugRatingFilter={drugRatingFilter} setDrugRatingFilter={setDrugRatingFilter} drugDateFrom={drugDateFrom} setDrugDateFrom={setDrugDateFrom} drugDateTo={drugDateTo} setDrugDateTo={setDrugDateTo} searchDrugs={searchDrugs} />}
      {tab === 'tasks' && <TasksTab tasks={tasks} taskTitle={taskTitle} setTaskTitle={setTaskTitle} taskDesc={taskDesc} setTaskDesc={setTaskDesc} taskComp={taskComp} setTaskComp={setTaskComp} taskSpec={taskSpec} setTaskSpec={setTaskSpec} savingTask={savingTask} createTask={createTask} />}
      {tab === 'teams' && <TeamsTab teams={teams} staff={staff} teamName={teamName} setTeamName={setTeamName} createTeam={createTeam} staffName={staffName} setStaffName={setStaffName} staffEmail={staffEmail} setStaffEmail={setStaffEmail} staffPass={staffPass} setStaffPass={setStaffPass} staffRole={staffRole} setStaffRole={setStaffRole} staffTeam={staffTeam} setStaffTeam={setStaffTeam} savingStaff={savingStaff} staffMsg={staffMsg} setStaffMsg={setStaffMsg} createStaff={createStaff} adminUser={adminUser} adminRoles={adminRoles} newRoleName={newRoleName} setNewRoleName={setNewRoleName} newRoleDesc={newRoleDesc} setNewRoleDesc={setNewRoleDesc} newRoleTabs={newRoleTabs} setNewRoleTabs={setNewRoleTabs} editingRoleId={editingRoleId} setEditingRoleId={setEditingRoleId} editingRoleTabs={editingRoleTabs} setEditingRoleTabs={setEditingRoleTabs} savingRole={savingRole} loadAdminRoles={invalidateAdmin} showToast={showToast} ALL_TABS={ALL_TABS} />}
      {tab === 'searches' && <SearchesTab searchLogs={searchLogs} />}
      {tab === 'golive' && <GoLiveTab activeShows={activeShows} scheduledShows={scheduledShows} liveTitle={liveTitle} setLiveTitle={setLiveTitle} scheduledAt={scheduledAt} setScheduledAt={setScheduledAt} trailerFile={trailerFile} setTrailerFile={setTrailerFile} creatingShow={creatingShow} liveGuests={liveGuests} setLiveGuests={setLiveGuests} guestSearch={guestSearch} setGuestSearch={setGuestSearch} users={users} startLiveShow={startLiveShow} scheduleShow={scheduleShow} endLiveShow={endLiveShow} startScheduledShow={startScheduledShow} cancelScheduledShow={cancelScheduledShow} liveDraft={liveDraft} setLiveDraft={setLiveDraft} liveImage={liveImage} setLiveImage={setLiveImage} postingLive={postingLive} postLiveItem={postLiveItem} liveItems={liveItems} liveStats={liveStats} liveComments={liveComments} hideLiveComment={hideLiveComment} loadLiveControl={loadLiveControl} toggleGuest={toggleGuest} showToast={showToast} postLiveVoice={postLiveVoice} postLiveSlide={postLiveSlide} postLiveVideo={postLiveVideo} />}
      {tab === 'shop' && <ShopTab showToast={showToast} />}
      {tab === 'notifications' && <NotificationsTab notifications={notifications} setTab={setTab} />}
      {tab === 'email_templates' && <EmailTemplatesTab showToast={showToast} />}
    </div>
  )
}
