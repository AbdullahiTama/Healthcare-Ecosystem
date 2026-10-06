import {
  LayoutDashboard, Layers, Flag, UserCheck, Shield, FileText, Image, Newspaper, Radio, Target,
  Users, ClipboardList, Building2, Store, Upload, Pill, Search, ShoppingBag, ClipboardCheck,
  DollarSign, Landmark, UserPlus, Coins, ArrowLeftRight, UsersRound, ScrollText, AlertTriangle,
  Mail, SlidersHorizontal, Bell,
} from 'lucide-react'

// The single source of truth for the admin console: the sidebar, the route
// table, the command palette and the role editor all read from here.

export const ADMIN_ROOT = '/admin'
export const UNRESTRICTED_ROLE = 'super_admin'

export const GROUPS = [
  { id: 'home', label: null },
  { id: 'moderation', label: 'Moderation' },
  { id: 'content', label: 'Content' },
  { id: 'community', label: 'Community' },
  { id: 'directory', label: 'Directory' },
  { id: 'commerce', label: 'Commerce' },
  { id: 'finance', label: 'Finance' },
  { id: 'agents', label: 'Agents' },
  { id: 'platform', label: 'Platform' },
]

// `permission` defaults to `key`. `explicit` marks keys that did not exist
// before the console: they are denied to restricted roles unless granted.
const screen = (key, group, label, icon, path, extra = {}) => ({ key, group, label, icon, path, permission: key, ...extra })

export const SCREENS = [
  screen('overview', 'home', 'Home', LayoutDashboard, ''),

  screen('moderation', 'moderation', 'Queue', Layers, 'moderation/queue', { countKey: 'queue' }),
  screen('reports', 'moderation', 'Reports', Flag, 'moderation/reports', { countKey: 'reports' }),
  screen('verifications', 'moderation', 'Verifications', UserCheck, 'moderation/verifications', { countKey: 'verifications' }),
  screen('claims', 'moderation', 'Claims', Shield, 'moderation/claims', { countKey: 'claims' }),

  screen('posts', 'content', 'Posts', FileText, 'content/posts'),
  screen('stories', 'content', 'Stories', Image, 'content/stories'),
  screen('news', 'content', 'News', Newspaper, 'content/news', { countKey: 'news' }),
  screen('golive', 'content', 'Live', Radio, 'content/live'),
  screen('promotions', 'content', 'Promotions', Target, 'content/promotions'),

  screen('users', 'community', 'Users', Users, 'community/users'),
  screen('tasks', 'community', 'Tasks', ClipboardList, 'community/tasks'),

  screen('businesses', 'directory', 'Businesses', Building2, 'directory/businesses'),
  // Interim until the three business lists are merged (spec section 4).
  screen('businesses_hub', 'directory', 'Business hub', Store, 'directory/business-hub', { permission: 'businesses' }),
  screen('business_import', 'directory', 'Directory manager', Upload, 'directory/manager', { explicit: true }),
  screen('drugs', 'directory', 'Drug intel', Pill, 'directory/drugs'),
  screen('searches', 'directory', 'Search insights', Search, 'directory/searches'),

  screen('shop', 'commerce', 'Shop', ShoppingBag, 'commerce/shop'),
  screen('orders', 'commerce', 'Orders', ClipboardCheck, 'commerce/orders'),
  screen('revenue', 'commerce', 'Revenue', DollarSign, 'commerce/revenue'),

  screen('withdrawals', 'finance', 'Withdrawals', Landmark, 'finance/withdrawals', { countKey: 'withdrawals' }),

  screen('agent_applications', 'agents', 'Applications', UserPlus, 'agents/applications', { explicit: true }),
  screen('agent_earnings', 'agents', 'Earnings', Coins, 'agents/earnings', { explicit: true }),
  screen('agent_transfers', 'agents', 'Transfers', ArrowLeftRight, 'agents/transfers', { explicit: true }),

  screen('teams', 'platform', 'Team and roles', UsersRound, 'platform/team'),
  screen('audit_log', 'platform', 'Audit log', ScrollText, 'platform/audit-log'),
  screen('errors', 'platform', 'Errors', AlertTriangle, 'platform/errors'),
  screen('email_templates', 'platform', 'Email templates', Mail, 'platform/email-templates'),
  screen('feed_ranking', 'platform', 'Feed ranking', SlidersHorizontal, 'platform/feed-ranking', { permission: 'overview' }),
]

export const ALERTS = { key: 'notifications', label: 'Alerts', icon: Bell, path: 'alerts', permission: 'notifications' }

export const PERMISSION_ITEMS = (() => {
  const seen = new Set()
  const out = []
  for (const s of [...SCREENS, ALERTS]) {
    if (seen.has(s.permission)) continue
    seen.add(s.permission)
    out.push({ key: s.permission, label: s.label, icon: s.icon })
  }
  return out
})()

export function screenByKey(key) {
  return SCREENS.find(s => s.key === key)
}

export function pathFor(key) {
  if (key === ALERTS.key) return `${ADMIN_ROOT}/${ALERTS.path}`
  const s = screenByKey(key)
  if (!s || !s.path) return ADMIN_ROOT
  return `${ADMIN_ROOT}/${s.path}`
}

export function screenForPath(pathname) {
  const trimmed = (pathname || '').replace(/\/+$/, '')
  if (trimmed === ADMIN_ROOT) return screenByKey('overview')
  if (!trimmed.startsWith(`${ADMIN_ROOT}/`)) return undefined
  const rest = trimmed.slice(ADMIN_ROOT.length + 1)
  return SCREENS.find(s => s.path === rest)
}

export function canAccess(item, { adminUser, permissions } = {}) {
  if (!item || !adminUser) return false
  const granted = permissions?.[item.permission]
  if (item.explicit) return adminUser.role === UNRESTRICTED_ROLE || granted === true
  return granted !== false
}

export function visibleGroups(ctx) {
  return GROUPS
    .map(g => ({ ...g, screens: SCREENS.filter(s => s.group === g.id && canAccess(s, ctx)) }))
    .filter(g => g.screens.length > 0)
}

export function firstAccessiblePath(ctx) {
  const first = SCREENS.find(s => canAccess(s, ctx))
  return first ? pathFor(first.key) : null
}

export const LEGACY_REDIRECTS = [
  { from: '/admin-panel', to: pathFor('overview') },
  { from: '/admin/dashboard', to: pathFor('overview') },
  { from: '/admin/businesses', to: pathFor('businesses_hub') },
  { from: '/admin/agents', to: pathFor('agent_applications') },
  { from: '/admin/applications', to: pathFor('agent_applications') },
  { from: '/admin/earnings', to: pathFor('agent_earnings') },
  { from: '/admin/transfers', to: pathFor('agent_transfers') },
  { from: '/business-directory', to: pathFor('business_import') },
  { from: '/agents/approval', to: pathFor('agent_applications') },
  { from: '/agents/earnings', to: pathFor('agent_earnings') },
  { from: '/agents/transfer', to: pathFor('agent_transfers') },
]

export function isAdminPath(pathname) {
  const p = pathname || ''
  if (p === ADMIN_ROOT || p.startsWith(`${ADMIN_ROOT}/`)) return true
  return LEGACY_REDIRECTS.some(r => r.from === p.replace(/\/+$/, ''))
}
