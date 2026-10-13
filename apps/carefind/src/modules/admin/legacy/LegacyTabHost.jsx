import { useEffect, useState } from 'react'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../provider/AdminProvider.jsx'
import { ALL_TABS } from '../navigation'
import { useAdminData, useAdminShopData, useAdminRoles } from '../../../hooks/queries'
import ShopTab from '../tabs/ShopTab.jsx'
import TasksTab from '../tabs/TasksTab.jsx'
import TeamsTab from '../tabs/TeamsTab.jsx'
import EmailTemplatesTab from '../tabs/EmailTemplatesTab.jsx'

// The screens that have not been redesigned yet. They still receive the state
// and handlers they were written against; each redesign phase moves a tab's
// state into its own section file and deletes its share of this file.
// Session, toasts, confirm and sign-out come from AdminProvider.

export default function LegacyTabHost({ tab, setTab }) {
  const { adminUser, permissions: adminPermissions, showToast, askConfirm, invalidateAdmin } = useAdmin()

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
  const [newRoleName, setNewRoleName] = useState('')
  const [newRoleDesc, setNewRoleDesc] = useState('')
  const [newRoleTabs, setNewRoleTabs] = useState({})
  const [editingRoleId, setEditingRoleId] = useState(null)
  const [editingRoleTabs, setEditingRoleTabs] = useState({})
  const [savingRole, setSavingRole] = useState(false)

  const { data: adminData } = useAdminData(!!adminUser)
  const { data: shopData } = useAdminShopData(!!adminUser)
  const { data: adminRoles = [] } = useAdminRoles(!!adminUser)

  const { tasks = [], teams = [], staff = [] } = adminData || {}
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
      {tab === 'tasks' && <TasksTab tasks={tasks} taskTitle={taskTitle} setTaskTitle={setTaskTitle} taskDesc={taskDesc} setTaskDesc={setTaskDesc} taskComp={taskComp} setTaskComp={setTaskComp} taskSpec={taskSpec} setTaskSpec={setTaskSpec} savingTask={savingTask} createTask={createTask} />}
      {tab === 'teams' && <TeamsTab teams={teams} staff={staff} teamName={teamName} setTeamName={setTeamName} createTeam={createTeam} staffName={staffName} setStaffName={setStaffName} staffEmail={staffEmail} setStaffEmail={setStaffEmail} staffPass={staffPass} setStaffPass={setStaffPass} staffRole={staffRole} setStaffRole={setStaffRole} staffTeam={staffTeam} setStaffTeam={setStaffTeam} savingStaff={savingStaff} staffMsg={staffMsg} setStaffMsg={setStaffMsg} createStaff={createStaff} adminUser={adminUser} adminRoles={adminRoles} newRoleName={newRoleName} setNewRoleName={setNewRoleName} newRoleDesc={newRoleDesc} setNewRoleDesc={setNewRoleDesc} newRoleTabs={newRoleTabs} setNewRoleTabs={setNewRoleTabs} editingRoleId={editingRoleId} setEditingRoleId={setEditingRoleId} editingRoleTabs={editingRoleTabs} setEditingRoleTabs={setEditingRoleTabs} savingRole={savingRole} loadAdminRoles={invalidateAdmin} showToast={showToast} ALL_TABS={ALL_TABS} />}
      {tab === 'shop' && <ShopTab showToast={showToast} />}
      {tab === 'email_templates' && <EmailTemplatesTab showToast={showToast} />}
    </div>
  )
}
