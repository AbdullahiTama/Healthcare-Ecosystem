// Cmd+K command definitions for CareFind admin.
// Navigation commands + dynamic per-tab actions.

export const BASE_COMMANDS = [
  // Nav
  { id: 'go-overview', label: 'Go to Dashboard', keywords: ['dashboard','home','overview'], section: 'Navigation', shortcut: 'G D', action: 'navigate', target: 'overview' },
  { id: 'go-users', label: 'Go to Users', keywords: ['users','people','accounts'], section: 'Navigation', shortcut: 'G U', action: 'navigate', target: 'users' },
  { id: 'go-verifications', label: 'Go to Verifications', keywords: ['verifications','verify','trust'], section: 'Navigation', shortcut: 'G V', action: 'navigate', target: 'verifications' },
  { id: 'go-reports', label: 'Go to Reports', keywords: ['reports','flags','complaints'], section: 'Navigation', shortcut: 'G R', action: 'navigate', target: 'reports' },
  { id: 'go-posts', label: 'Go to Posts', keywords: ['posts','content','feed'], section: 'Navigation', shortcut: 'G P', action: 'navigate', target: 'posts' },
  { id: 'go-moderation', label: 'Go to Moderation', keywords: ['moderation','queue','review'], section: 'Navigation', shortcut: 'G M', action: 'navigate', target: 'moderation' },
  { id: 'go-orders', label: 'Go to Orders', keywords: ['orders','transactions','finance'], section: 'Navigation', shortcut: 'G O', action: 'navigate', target: 'orders' },
  { id: 'go-withdrawals', label: 'Go to Withdrawals', keywords: ['withdrawals','payouts','pay'], section: 'Navigation', shortcut: 'G W', action: 'navigate', target: 'withdrawals' },
  { id: 'go-shop', label: 'Go to Shop', keywords: ['shop','products','ecommerce'], section: 'Navigation', shortcut: 'G S', action: 'navigate', target: 'shop' },
  { id: 'go-audit', label: 'Go to Audit Log', keywords: ['audit','log','history'], section: 'Navigation', shortcut: 'G A', action: 'navigate', target: 'audit_log' },
  { id: 'go-errors', label: 'Go to Error Inbox', keywords: ['errors','bugs','inbox'], section: 'Navigation', shortcut: 'G E', action: 'navigate', target: 'errors' },

  // Actions
  { id: 'action-refresh', label: 'Refresh data', keywords: ['refresh','reload','sync'], section: 'Actions', shortcut: 'R', action: 'refresh' },
  { id: 'action-toggle-theme', label: 'Toggle theme (light/dark)', keywords: ['theme','dark','light'], section: 'Actions', shortcut: 'T', action: 'toggleTheme' },
  { id: 'action-signout', label: 'Sign out', keywords: ['logout','sign out'], section: 'Actions', action: 'signout' },
]

export function buildCommandList({ currentTab = 'overview', recentIds = [] } = {}) {
  const list = [...BASE_COMMANDS]

  // Dynamic per-tab actions
  if (currentTab === 'users') {
    list.push({ id: 'action-export-users', label: 'Export users CSV', keywords: ['export','csv','download'], section: 'Actions', action: 'exportUsers' })
    list.push({ id: 'action-bulk-verify', label: 'Bulk verify selected users', keywords: ['bulk','verify','selected'], section: 'Actions', action: 'bulkVerify' })
  }
  if (currentTab === 'verifications') {
    list.push({ id: 'action-approve-all-verif', label: 'Approve all pending verifications', keywords: ['approve','all','pending'], section: 'Actions', action: 'approveAllVerifications' })
  }
  if (currentTab === 'reports') {
    list.push({ id: 'action-resolve-all-reports', label: 'Resolve all pending reports', keywords: ['resolve','all','pending'], section: 'Actions', action: 'resolveAllReports' })
  }
  if (currentTab === 'posts') {
    list.push({ id: 'action-export-posts', label: 'Export posts CSV', keywords: ['export','csv','download'], section: 'Actions', action: 'exportPosts' })
  }
  if (currentTab === 'orders') {
    list.push({ id: 'action-export-orders', label: 'Export orders CSV', keywords: ['export','csv','download'], section: 'Actions', action: 'exportOrders' })
  }

  // Recent boosting
  const seen = new Set()
  const deduped = list.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true })

  if (recentIds && recentIds.length) {
    deduped.sort((a, b) => {
      const ai = recentIds.indexOf(a.id)
      const bi = recentIds.indexOf(b.id)
      const aRecent = ai !== -1 ? ai : 999
      const bRecent = bi !== -1 ? bi : 999
      return aRecent - bRecent
    })
  }

  return deduped
}

export function scoreCommand(command, query) {
  if (!query) return 1
  const q = query.toLowerCase()
  const hay = [command.label, ...(command.keywords || [])].join(' ').toLowerCase()
  if (hay.includes(q)) return 2 + (1 / (command.label.length || 1))
  const words = command.label.toLowerCase().split(/\s+/)
  const initials = words.map(w => w[0]).join('')
  if (initials.includes(q.replace(/\s/g, ''))) return 1.2
  return 0
}
