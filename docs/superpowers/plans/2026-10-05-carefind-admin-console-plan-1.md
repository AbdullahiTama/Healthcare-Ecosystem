# CareFind Admin Console (Plan 1: foundation, building blocks, Moderation, Home) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tab-state `AdminPanel` with one routed, gated admin console at `/admin/*`, and rebuild the Moderation screens and Home on a table-plus-drawer pattern, with every other admin screen still working inside the new shell.

**Architecture:** `main.jsx` hands any admin path to a lazy `AdminApp` that sits outside CareFind's keyed (remounting) router. `AdminApp` = `AdminGate` (server `verify`) → `AdminFeedbackProvider` (toast, confirm, activity) → un-keyed `<Routes>` with one layout route (`AdminShell`, built on the shared `DashboardShell`) and one child route per screen from a single registry (`navigation.js`). Screens not yet rebuilt render through `legacy/LegacyScreens.jsx`, which is today's `AdminPanel` body with its layout, auth, toast and palette removed. Rebuilt screens fetch their own data with TanStack Query and keep filters and the open record in the URL.

**Tech Stack:** React 18, react-router-dom 6, @tanstack/react-query 5, lucide-react, `@care-ecosystem/design-system` (DashboardShell, DataTable, StatCard, MetricGrid, SectionCard, SearchBar, FilterBar, Modal, Pill, StatusBadge, Empty, ErrorState), Vitest 2 + Testing Library, jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-carefind-admin-console-design.md` (read it first; this plan implements its steps 1–4).

## Global Constraints

- All work is in `apps/carefind`. Run commands from `apps/carefind` unless a step says otherwise.
- Tests: `npm test -- <path>` (runs `vitest run <path>`). Build: `node_modules/.bin/vite build` (never `npx vite build`). Lint: `npm run lint`.
- Commit from the repo root, staging and committing in one command with explicit paths: `git add <paths> && git commit -m "<msg>" -- <paths>`. Never run a bare `git add` followed later by a commit; other work is in progress in this tree.
- One commit per task unless a task says otherwise. A behaviour fix is a separate commit from the move that revealed it.
- Do not change `api/`, any SQL, any RPC or any database policy.
- Existing permission keys keep today's rule: allowed unless explicitly `false`. The new keys `business_import`, `agent_applications`, `agent_earnings`, `agent_transfers` are allowed only when the admin's role is `super_admin` or the key is explicitly `true`.
- Colours and spacing come from `theme` (`src/styles/theme.js`). No hardcoded hex. No gradients. No emojis in new code; use lucide icons.
- Every status shown carries a text label (never colour alone). Every icon-only button has an `aria-label`.
- New screens must have loading, error (with retry) and empty states.
- Import design-system components from `@care-ecosystem/design-system/components/ui`. Import only `useToast`, `Toast`, `ConfirmDialog` and `Loading` from `src/components/ui` (the existing admin test mocks that module with exactly those).
- CareFind's ESLint has no React plugin: after moving or creating JSX, check by eye that every component used in JSX is imported.
- Each new screen is measured at 375, 768 and 1280px: `document.documentElement.scrollWidth` must equal `window.innerWidth`.

## Review Focus

1. **Deep link to a record that is not in the loaded list** (already handled, or beyond the API's 30-row report limit): the drawer must say the record could not be found, not open blank or crash. Pinned in Task 8.
2. **A restricted role without the `overview` permission opening `/admin`:** they must land on their first permitted screen, not on a dead-end no-access page. Pinned in Task 5.
3. **One queue's list call failing while the others succeed:** that queue's count is hidden, the others still show, and the sidebar says counts are incomplete. Pinned in Tasks 3 and 4.
4. **Double-clicking Approve or Reject:** exactly one request is sent. Pinned in Task 8.
5. **Rows with missing data** (no name, no date, a report whose post was deleted): the table and drawer render placeholders and do not throw. Pinned in Tasks 8 and 9.

## File Structure

```
src/modules/admin/
  navigation.js                     screen registry, permission rule, legacy redirects      (Task 1)
  AdminGate.jsx                     verify + AdminContext + session expiry                   (Task 2)
  adminApi.js                       + session-expired event                                  (Task 2)
  AdminFeedback.jsx                 toast / confirm / activity / audit hooks                 (Task 3)
  data/queues.js                    per-queue queries + pending counts                       (Task 3)
  shell/Sidebar.jsx                 grouped nav with counts                                  (Task 4)
  shell/TopBar.jsx                  menu button, search, alerts bell                         (Task 4)
  shell/AdminShell.jsx              DashboardShell + realtime + palette + copilot + Outlet   (Task 4)
  AdminApp.jsx                      routes, guards, redirects                                (Task 5)
  legacy/LegacyScreens.jsx          today's AdminPanel body, minus chrome                    (Task 5)
  ui/NoAccess.jsx                                                                            (Task 5)
  ui/useUrlFilters.js                                                                        (Task 6)
  ui/StatusPill.jsx, ui/tableHelpers.jsx, ui/DetailDrawer.jsx                                (Task 7)
  screens/moderation/VerificationsScreen.jsx                                                 (Task 8)
  screens/moderation/ReportsScreen.jsx                                                       (Task 9)
  screens/moderation/ClaimsScreen.jsx                                                        (Task 10)
  screens/moderation/QueueScreen.jsx                                                         (Task 11)
  screens/home/HomeScreen.jsx, screens/platform/FeedRankingScreen.jsx                        (Task 12)
  test/renderAdmin.jsx              shared test harness                                      (Task 3)
apps/carefind/docs/ADMIN_CONSOLE.md                                                          (Task 13)
```

Deleted in this plan: `AdminPanel.jsx` (moved), `AdminLayout.jsx`, `AdminSidebar.jsx`, `tabs/VerificationsTab.jsx`, `tabs/ReportsTab.jsx`, `tabs/ClaimsTab.jsx`, `tabs/ModerationQueue.jsx`, `tabs/DashboardTab.jsx`, `tabs/OverviewTab.jsx`, `stores/moderationStore.jsx`.

---

### Task 1: Navigation registry

**Files:**
- Create: `src/modules/admin/navigation.js`
- Test: `src/modules/admin/navigation.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `GROUPS: Array<{ id: string, label: string|null }>`
  - `SCREENS: Array<{ key, group, label, icon, path, permission, explicit?: true, countKey?: string }>` (`path` is relative to `/admin`; `''` is Home)
  - `ALERTS: { key: 'notifications', label: 'Alerts', path: 'alerts', permission: 'notifications' }`
  - `PERMISSION_ITEMS: Array<{ key, label, icon }>` (one per distinct permission key, for the role editor)
  - `pathFor(key: string): string` (absolute; unknown key → `/admin`)
  - `screenByKey(key): screen|undefined`, `screenForPath(pathname): screen|undefined`
  - `canAccess(screen, { adminUser, permissions }): boolean`
  - `visibleGroups({ adminUser, permissions }): Array<{ id, label, screens }>`
  - `firstAccessiblePath({ adminUser, permissions }): string|null`
  - `isAdminPath(pathname): boolean`
  - `LEGACY_REDIRECTS: Array<{ from: string, to: string }>`

- [ ] **Step 1: Write the failing test**

`src/modules/admin/navigation.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  SCREENS, GROUPS, PERMISSION_ITEMS, LEGACY_REDIRECTS,
  pathFor, screenByKey, screenForPath, canAccess, visibleGroups, firstAccessiblePath, isAdminPath,
} from './navigation'

const superAdmin = { adminUser: { role: 'super_admin' }, permissions: {} }
const moderator = { adminUser: { role: 'moderator' }, permissions: { users: false, reports: true } }

describe('navigation registry', () => {
  it('keeps every permission key the old sidebar had', () => {
    const old = ['overview', 'moderation', 'verifications', 'reports', 'posts', 'stories', 'news', 'golive',
      'shop', 'revenue', 'orders', 'withdrawals', 'businesses', 'users', 'claims', 'audit_log', 'errors',
      'teams', 'drugs', 'tasks', 'promotions', 'searches', 'email_templates']
    const keys = SCREENS.map(s => s.permission)
    old.forEach(k => expect(keys).toContain(k))
  })

  it('has unique keys and paths, and every screen belongs to a known group', () => {
    expect(new Set(SCREENS.map(s => s.key)).size).toBe(SCREENS.length)
    expect(new Set(SCREENS.map(s => s.path)).size).toBe(SCREENS.length)
    const groupIds = GROUPS.map(g => g.id)
    SCREENS.forEach(s => expect(groupIds).toContain(s.group))
  })

  it('builds absolute paths', () => {
    expect(pathFor('overview')).toBe('/admin')
    expect(pathFor('verifications')).toBe('/admin/moderation/verifications')
    expect(pathFor('notifications')).toBe('/admin/alerts')
    expect(pathFor('does-not-exist')).toBe('/admin')
  })

  it('finds a screen by key and by pathname', () => {
    expect(screenByKey('reports').path).toBe('moderation/reports')
    expect(screenForPath('/admin').key).toBe('overview')
    expect(screenForPath('/admin/').key).toBe('overview')
    expect(screenForPath('/admin/moderation/reports').key).toBe('reports')
    expect(screenForPath('/admin/nope')).toBeUndefined()
  })

  it('allows existing keys unless explicitly false', () => {
    expect(canAccess(screenByKey('reports'), moderator)).toBe(true)
    expect(canAccess(screenByKey('posts'), moderator)).toBe(true)
    expect(canAccess(screenByKey('users'), moderator)).toBe(false)
  })

  it('denies new keys to restricted roles unless explicitly granted', () => {
    const transfers = screenByKey('agent_transfers')
    expect(transfers.explicit).toBe(true)
    expect(canAccess(transfers, moderator)).toBe(false)
    expect(canAccess(transfers, { adminUser: { role: 'moderator' }, permissions: { agent_transfers: true } })).toBe(true)
    expect(canAccess(transfers, superAdmin)).toBe(true)
  })

  it('treats a missing screen or missing admin as no access', () => {
    expect(canAccess(undefined, superAdmin)).toBe(false)
    expect(canAccess(screenByKey('agent_transfers'), { adminUser: null, permissions: {} })).toBe(false)
  })

  it('hides groups with no permitted screens', () => {
    const ctx = { adminUser: { role: 'moderator' }, permissions: { withdrawals: false } }
    const ids = visibleGroups(ctx).map(g => g.id)
    expect(ids).not.toContain('finance')
    expect(ids).not.toContain('agents')
    expect(ids).toContain('moderation')
  })

  it('returns the first permitted path, or null when there is none', () => {
    expect(firstAccessiblePath(superAdmin)).toBe('/admin')
    expect(firstAccessiblePath({ adminUser: { role: 'moderator' }, permissions: { overview: false } }))
      .toBe('/admin/moderation/queue')
    const none = Object.fromEntries(SCREENS.map(s => [s.permission, false]))
    expect(firstAccessiblePath({ adminUser: { role: 'moderator' }, permissions: none })).toBeNull()
  })

  it('lists each permission key once for the role editor', () => {
    const keys = PERMISSION_ITEMS.map(i => i.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain('notifications')
    expect(keys).toContain('businesses')
    expect(keys).not.toContain('businesses_hub')
  })

  it('recognises admin paths, including the legacy ones', () => {
    ;['/admin', '/admin/', '/admin/moderation/queue', '/admin-panel', '/business-directory',
      '/agents/approval', '/agents/earnings', '/agents/transfer'].forEach(p => expect(isAdminPath(p)).toBe(true))
    ;['/', '/feed', '/administrator', '/agents/register', '/agent-login', '/business-discovery', '/login']
      .forEach(p => expect(isAdminPath(p)).toBe(false))
  })

  it('redirects every legacy address to a registered screen path', () => {
    const paths = SCREENS.map(s => pathFor(s.key))
    LEGACY_REDIRECTS.forEach(r => expect(paths).toContain(r.to))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/admin/navigation.test.js`
Expected: FAIL, cannot resolve `./navigation`.

- [ ] **Step 3: Write the implementation**

`src/modules/admin/navigation.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/modules/admin/navigation.test.js`
Expected: PASS, 12 tests. If an icon import fails to resolve (lucide renames icons between versions), replace only that icon with a nearby one that exists in `node_modules/lucide-react` and re-run.

- [ ] **Step 5: Commit**

```bash
git add apps/carefind/src/modules/admin/navigation.js apps/carefind/src/modules/admin/navigation.test.js && git commit -m "feat(carefind): admin console screen registry" -- apps/carefind/src/modules/admin/navigation.js apps/carefind/src/modules/admin/navigation.test.js
```

---

### Task 2: Access gate and session expiry

**Files:**
- Create: `src/modules/admin/AdminGate.jsx`
- Modify: `src/modules/admin/adminApi.js`
- Test: `src/modules/admin/AdminGate.test.jsx`, `src/modules/admin/adminApi.test.js` (add cases)

**Interfaces:**
- Consumes: `callAdminAuth(action, payload)` from `adminApi.js`; `supabase.auth.getSession()`, `supabase.auth.signOut()`.
- Produces:
  - `SESSION_EXPIRED_EVENT = 'admin:session-expired'` (exported from `adminApi.js`; dispatched on `window` when a call returns HTTP 401 or no session exists)
  - `AdminContext` (React context), `useAdmin(): { adminUser, permissions, signOut }`
  - `<AdminGate>{children}</AdminGate>`: renders children only after `verify` succeeds

- [ ] **Step 1: Write the failing tests**

Append to `src/modules/admin/adminApi.test.js` (keep the existing tests; reuse the file's existing mocks for `supabase` and `fetch`, and add these cases inside the top-level `describe`):

```js
  it('announces an expired session when the API answers 401', async () => {
    const heard = vi.fn()
    window.addEventListener('admin:session-expired', heard)
    supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Invalid or expired token' }) })
    await expect(callAdminAuth('list_reports')).rejects.toThrow('Invalid or expired token')
    expect(heard).toHaveBeenCalledTimes(1)
    window.removeEventListener('admin:session-expired', heard)
  })

  it('does not announce an expired session for other failures', async () => {
    const heard = vi.fn()
    window.addEventListener('admin:session-expired', heard)
    supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
    await expect(callAdminAuth('list_reports')).rejects.toThrow('boom')
    expect(heard).not.toHaveBeenCalled()
    window.removeEventListener('admin:session-expired', heard)
  })
```

Read the top of `adminApi.test.js` first: if its supabase mock is named differently from `supabase`, use that name.

`src/modules/admin/AdminGate.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const { supabase, callAdminAuth } = vi.hoisted(() => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn() } },
  callAdminAuth: vi.fn(),
}))
vi.mock('../../config/supabaseClient', () => ({ supabase }))
vi.mock('./adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))

import { AdminGate, useAdmin } from './AdminGate.jsx'

function Inside() {
  const { adminUser, permissions, signOut } = useAdmin()
  return (
    <div>
      <span>hello {adminUser.full_name}</span>
      <span>news:{String(permissions.news)}</span>
      <button onClick={signOut}>out</button>
    </div>
  )
}

function renderGate() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminGate><Inside /></AdminGate>} />
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
    supabase.auth.signOut.mockResolvedValue({ error: null })
    callAdminAuth.mockImplementation(async (action) => {
      if (action === 'verify') return { admin: { id: 'a1', full_name: 'Ada', role: 'moderator' }, permissions: { news: true } }
      return {}
    })
  })

  it('renders children with the verified admin and permissions', async () => {
    renderGate()
    expect(await screen.findByText('hello Ada')).toBeInTheDocument()
    expect(screen.getByText('news:true')).toBeInTheDocument()
    expect(callAdminAuth).toHaveBeenCalledWith('verify')
  })

  it('renders nothing protected while checking', () => {
    callAdminAuth.mockReturnValue(new Promise(() => {}))
    renderGate()
    expect(screen.queryByText(/hello/)).not.toBeInTheDocument()
  })

  it('goes to login without calling verify when there is no session', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    renderGate()
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
    expect(callAdminAuth).not.toHaveBeenCalledWith('verify')
  })

  it('signs out and goes to login when verify is rejected', async () => {
    callAdminAuth.mockRejectedValue(new Error('not an admin'))
    localStorage.setItem('admin_user', '{"id":"stale"}')
    renderGate()
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
    expect(supabase.auth.signOut).toHaveBeenCalled()
    expect(localStorage.getItem('admin_user')).toBeNull()
    expect(localStorage.getItem('admin_permissions')).toBeNull()
  })

  it('goes to login when verify returns no admin id', async () => {
    callAdminAuth.mockResolvedValue({ admin: {}, permissions: {} })
    renderGate()
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
  })

  it('goes to login when a later call reports an expired session', async () => {
    renderGate()
    await screen.findByText('hello Ada')
    act(() => { window.dispatchEvent(new CustomEvent('admin:session-expired')) })
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
  })

  it('signOut logs out on the server, clears the cache and goes to login', async () => {
    renderGate()
    ;(await screen.findByText('out')).click()
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
    await waitFor(() => expect(callAdminAuth).toHaveBeenCalledWith('logout'))
    expect(supabase.auth.signOut).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/modules/admin/AdminGate.test.jsx src/modules/admin/adminApi.test.js`
Expected: FAIL (`./AdminGate.jsx` not found; the two new adminApi cases fail because no event is dispatched).

- [ ] **Step 3: Implement**

In `src/modules/admin/adminApi.js`, add the export and dispatch (full new file):

```js
import { supabase } from '../../config/supabaseClient'

export const SESSION_EXPIRED_EVENT = 'admin:session-expired'

function announceSessionExpired() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
}

export async function getAdminAuthorizationHeader() {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session?.access_token) {
    announceSessionExpired()
    throw new Error('Your admin session has expired. Please sign in again.')
  }
  return { Authorization: `Bearer ${session.access_token}` }
}

export async function callAdminAuth(action, payload = {}) {
  try {
    const safePayload = { ...payload }
    delete safePayload.token
    const res = await fetch('/api/admin-auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...await getAdminAuthorizationHeader(),
      },
      body: JSON.stringify({ ...safePayload, action }),
    })
    const data = await res.json()
    if (!res.ok) {
      // `verify` and `logout` failing is the gate's own business; every other
      // 401 means the session died under a screen that was already open.
      if (res.status === 401 && action !== 'verify' && action !== 'logout') announceSessionExpired()
      throw new Error(data.error || `Request failed (${res.status})`)
    }
    return data
  } catch (err) {
    console.error(`[callAdminAuth] ${action} failed:`, err.message)
    throw new Error(err.message || 'Network error — check if the admin API is reachable')
  }
}
```

`src/modules/admin/AdminGate.jsx`:

```jsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { Loading } from '../../components/ui'
import { callAdminAuth, SESSION_EXPIRED_EVENT } from './adminApi'

export const AdminContext = createContext(null)

export function useAdmin() {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error('useAdmin must be used inside AdminGate')
  return ctx
}

function clearAdminCache() {
  localStorage.removeItem('admin_user')
  localStorage.removeItem('admin_permissions')
}

// The client gate exists for a sensible experience only. The admin API and
// the database policies remain the authority on what an admin may do.
export function AdminGate({ children }) {
  const navigate = useNavigate()
  const [state, setState] = useState({ status: 'checking', adminUser: null, permissions: {} })
  const leaving = useRef(false)

  const leave = useCallback(async ({ serverLogout = false } = {}) => {
    if (leaving.current) return
    leaving.current = true
    if (serverLogout) {
      try { await callAdminAuth('logout') } catch { /* best-effort */ }
    }
    try { await supabase.auth.signOut() } catch { /* access is denied either way */ }
    clearAdminCache()
    setState({ status: 'denied', adminUser: null, permissions: {} })
    navigate('/login', { replace: true })
  }, [navigate])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error || !session) {
          clearAdminCache()
          if (alive) { setState({ status: 'denied', adminUser: null, permissions: {} }); navigate('/login', { replace: true }) }
          return
        }
        const verified = await callAdminAuth('verify')
        if (!verified?.admin?.id) throw new Error('Could not verify admin access.')
        localStorage.setItem('admin_user', JSON.stringify(verified.admin))
        localStorage.setItem('admin_permissions', JSON.stringify(verified.permissions || {}))
        if (alive) setState({ status: 'ready', adminUser: verified.admin, permissions: verified.permissions || {} })
      } catch {
        if (alive) leave()
      }
    })()
    return () => { alive = false }
  }, [navigate, leave])

  useEffect(() => {
    const onExpired = () => leave()
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [leave])

  const signOut = useCallback(() => leave({ serverLogout: true }), [leave])

  const value = useMemo(
    () => ({ adminUser: state.adminUser, permissions: state.permissions, signOut }),
    [state.adminUser, state.permissions, signOut],
  )

  if (state.status === 'checking') return <Loading fullScreen />
  if (state.status !== 'ready') return null
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/modules/admin/AdminGate.test.jsx src/modules/admin/adminApi.test.js`
Expected: PASS (7 gate tests; all adminApi tests including the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/carefind/src/modules/admin/AdminGate.jsx apps/carefind/src/modules/admin/AdminGate.test.jsx apps/carefind/src/modules/admin/adminApi.js apps/carefind/src/modules/admin/adminApi.test.js && git commit -m "feat(carefind): admin access gate and session-expiry signal" -- apps/carefind/src/modules/admin/AdminGate.jsx apps/carefind/src/modules/admin/AdminGate.test.jsx apps/carefind/src/modules/admin/adminApi.js apps/carefind/src/modules/admin/adminApi.test.js
```

---

### Task 3: Feedback provider, queue data and the test harness

**Files:**
- Create: `src/modules/admin/AdminFeedback.jsx`, `src/modules/admin/data/queues.js`, `src/modules/admin/test/renderAdmin.jsx`
- Test: `src/modules/admin/data/queues.test.jsx`, `src/modules/admin/AdminFeedback.test.jsx`

**Interfaces:**
- Consumes: `useAdmin()` and `AdminContext` (Task 2); `canAccess` (Task 1); `callAdminAuth`.
- Produces:
  - `<AdminFeedbackProvider>`; `useAdminToast(): (message, { type }) => void`; `useAdminConfirm(): ({ title, consequence, confirmLabel?, action }) => void`; `useAdminActivity(): { recentActions, recordAction(entry) }`; `useAuditLog(): (auditAction, targetType, targetId, metadata?) => Promise<void>`
  - `QUEUES` (object keyed `verifications | claims | reports | news | withdrawals`, each `{ action, permission, isPending(row) }`)
  - `queueKey(name): ['admin', 'queue', name]`
  - `useQueue(name, { enabled? }): UseQueryResult<row[]>`
  - `usePendingCounts(): { counts: { verifications, claims, reports, news, withdrawals, queue }, total: number, failed: boolean }` (a count is `null` when unknown or not permitted)
  - `renderAdmin(ui, { route?, admin?, permissions? })` test helper returning the Testing Library result plus `queryClient`

- [ ] **Step 1: Write the test harness**

`src/modules/admin/test/renderAdmin.jsx`:

```jsx
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { renderWithQueryClient } from '../../../test/renderWithQueryClient.jsx'
import { AdminContext } from '../AdminGate.jsx'
import { AdminFeedbackProvider } from '../AdminFeedback.jsx'

export const SUPER_ADMIN = { id: 'admin-1', full_name: 'Admin', role: 'super_admin' }

// Renders admin UI the way AdminApp does, minus the gate's network call.
export function renderAdmin(ui, { route = '/admin', admin = SUPER_ADMIN, permissions = {} } = {}) {
  const value = { adminUser: admin, permissions, signOut: vi.fn() }
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[route]}>
      <AdminContext.Provider value={value}>
        <AdminFeedbackProvider>{ui}</AdminFeedbackProvider>
      </AdminContext.Provider>
    </MemoryRouter>,
  )
}
```

- [ ] **Step 2: Write the failing tests**

`src/modules/admin/AdminFeedback.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'

const { callAdminAuth } = vi.hoisted(() => ({ callAdminAuth: vi.fn() }))
vi.mock('./adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))

import { renderAdmin } from './test/renderAdmin.jsx'
import { useAdminToast, useAdminConfirm, useAdminActivity, useAuditLog } from './AdminFeedback.jsx'

function Probe({ action }) {
  const toast = useAdminToast()
  const confirm = useAdminConfirm()
  const { recentActions, recordAction } = useAdminActivity()
  const audit = useAuditLog()
  return (
    <div>
      <button onClick={() => toast('Saved it', { type: 'success' })}>toast</button>
      <button onClick={() => confirm({ title: 'Delete this post?', consequence: 'It cannot be undone.', action })}>ask</button>
      <button onClick={() => recordAction({ action: 'approve', target: 'report', id: 'r1' })}>record</button>
      <button onClick={() => audit('approve', 'report', 'r1', { a: 1 })}>audit</button>
      <span>actions:{recentActions.length}</span>
    </div>
  )
}

describe('AdminFeedbackProvider', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows a toast', async () => {
    renderAdmin(<Probe />)
    fireEvent.click(screen.getByText('toast'))
    expect(await screen.findByText('Saved it')).toBeInTheDocument()
  })

  it('runs the action only after the admin confirms, and states the consequence', async () => {
    const action = vi.fn()
    renderAdmin(<Probe action={action} />)
    fireEvent.click(screen.getByText('ask'))
    expect(await screen.findByText('Delete this post?')).toBeInTheDocument()
    expect(screen.getByText('It cannot be undone.')).toBeInTheDocument()
    expect(action).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('does not run the action when the admin cancels', async () => {
    const action = vi.fn()
    renderAdmin(<Probe action={action} />)
    fireEvent.click(screen.getByText('ask'))
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }))
    expect(action).not.toHaveBeenCalled()
  })

  it('records recent actions with a timestamp', () => {
    renderAdmin(<Probe />)
    fireEvent.click(screen.getByText('record'))
    expect(screen.getByText('actions:1')).toBeInTheDocument()
  })

  it('writes an audit entry and never throws when the audit call fails', async () => {
    callAdminAuth.mockRejectedValue(new Error('audit down'))
    renderAdmin(<Probe />)
    fireEvent.click(screen.getByText('audit'))
    await waitFor(() => expect(callAdminAuth).toHaveBeenCalledWith('log_audit_action', {
      auditAction: 'approve', targetType: 'report', targetId: 'r1', metadata: { a: 1 },
    }))
  })
})
```

`src/modules/admin/data/queues.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

const { callAdminAuth } = vi.hoisted(() => ({ callAdminAuth: vi.fn() }))
vi.mock('../adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))

import { renderAdmin } from '../test/renderAdmin.jsx'
import { usePendingCounts, useQueue, QUEUES } from './queues'

function Counts() {
  const { counts, total, failed } = usePendingCounts()
  return <pre data-testid="out">{JSON.stringify({ counts, total, failed })}</pre>
}
function List({ name }) {
  const { data = [], isError } = useQueue(name)
  return <div>{isError ? 'ERR' : `rows:${data.length}`}</div>
}
const read = () => JSON.parse(screen.getByTestId('out').textContent)

const lists = {
  list_verification_requests: [{ id: 'v1', status: 'pending' }, { id: 'v2', status: 'approved' }],
  list_business_claims: [{ id: 'c1', status: 'pending' }],
  list_reports: [{ id: 'r1', status: 'pending' }, { id: 'r2', status: 'pending' }],
  list_news: [{ id: 'n1', status: 'rejected' }],
  list_withdrawal_requests: [{ id: 'w1', status: 'reserved' }, { id: 'w2', status: 'processing' }, { id: 'w3', status: 'completed' }],
}

describe('queues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    callAdminAuth.mockImplementation(async (action) => ({ data: lists[action] || [] }))
  })

  it('counts pending items per queue, with withdrawals pending while reserved or processing', async () => {
    renderAdmin(<Counts />)
    await waitFor(() => expect(read().counts.withdrawals).toBe(2))
    expect(read()).toEqual({
      counts: { verifications: 1, claims: 1, reports: 2, news: 0, withdrawals: 2, queue: 3 },
      total: 6,
      failed: false,
    })
  })

  it('hides only the failed queue and flags the counts as incomplete', async () => {
    callAdminAuth.mockImplementation(async (action) => {
      if (action === 'list_reports') throw new Error('boom')
      return { data: lists[action] || [] }
    })
    renderAdmin(<Counts />)
    await waitFor(() => expect(read().failed).toBe(true))
    expect(read().counts.reports).toBeNull()
    expect(read().counts.queue).toBeNull()
    expect(read().counts.verifications).toBe(1)
    expect(read().total).toBe(4)
  })

  it('does not fetch queues the admin may not see', async () => {
    renderAdmin(<Counts />, { admin: { id: 'm', role: 'moderator' }, permissions: { withdrawals: false, claims: false } })
    await waitFor(() => expect(read().counts.reports).toBe(2))
    expect(callAdminAuth).not.toHaveBeenCalledWith('list_withdrawal_requests', expect.anything())
    expect(callAdminAuth).not.toHaveBeenCalledWith('list_business_claims', expect.anything())
    expect(read().counts.withdrawals).toBeNull()
  })

  it('shares one request between a list and the counts', async () => {
    renderAdmin(<><Counts /><List name="reports" /></>)
    expect(await screen.findByText('rows:2')).toBeInTheDocument()
    expect(callAdminAuth.mock.calls.filter(c => c[0] === 'list_reports')).toHaveLength(1)
  })

  it('surfaces a list failure as an error, not an empty list', async () => {
    callAdminAuth.mockRejectedValue(new Error('down'))
    renderAdmin(<List name="claims" />)
    expect(await screen.findByText('ERR')).toBeInTheDocument()
  })

  it('treats a missing data field as an empty list', async () => {
    callAdminAuth.mockResolvedValue({})
    renderAdmin(<List name="claims" />)
    expect(await screen.findByText('rows:0')).toBeInTheDocument()
  })

  it('declares a permission for every queue', () => {
    Object.values(QUEUES).forEach(q => expect(typeof q.permission).toBe('string'))
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- src/modules/admin/AdminFeedback.test.jsx src/modules/admin/data/queues.test.jsx`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`src/modules/admin/AdminFeedback.jsx`:

```jsx
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { ConfirmDialog, Toast, useToast } from '../../components/ui'
import { callAdminAuth } from './adminApi'

const FeedbackContext = createContext(null)

// One toast, one confirm dialog and one activity trail for the whole console,
// so screens do not each carry their own.
export function AdminFeedbackProvider({ children }) {
  const { msg, type, actionLabel, onAction, show } = useToast()
  const [confirmState, setConfirmState] = useState(null)
  const [recentActions, setRecentActions] = useState([])

  // Never a bare "Are you sure?": callers state the consequence.
  const askConfirm = useCallback(({ title, consequence, confirmLabel = 'Delete', action }) => {
    setConfirmState({ title, consequence, confirmLabel, action })
  }, [])

  const recordAction = useCallback((entry) => {
    setRecentActions(prev => [...prev.slice(-49), { timestamp: new Date().toISOString(), ...entry }])
  }, [])

  const value = useMemo(
    () => ({ showToast: show, askConfirm, recordAction, recentActions }),
    [show, askConfirm, recordAction, recentActions],
  )

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <ConfirmDialog
        show={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { const action = confirmState?.action; setConfirmState(null); if (action) action() }}
        title={confirmState?.title}
        consequence={confirmState?.consequence}
        confirmLabel={confirmState?.confirmLabel || 'Delete'}
      />
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </FeedbackContext.Provider>
  )
}

function useFeedback() {
  const ctx = useContext(FeedbackContext)
  if (!ctx) throw new Error('Admin feedback hooks must be used inside AdminFeedbackProvider')
  return ctx
}

export function useAdminToast() { return useFeedback().showToast }
export function useAdminConfirm() { return useFeedback().askConfirm }
export function useAdminActivity() {
  const { recentActions, recordAction } = useFeedback()
  return { recentActions, recordAction }
}

export function useAuditLog() {
  return useCallback(async (auditAction, targetType, targetId, metadata = {}) => {
    try {
      await callAdminAuth('log_audit_action', { auditAction, targetType, targetId, metadata })
    } catch { /* non-blocking: an audit failure must not block moderation */ }
  }, [])
}
```

`src/modules/admin/data/queues.js`:

```js
import { useQueries, useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../AdminGate.jsx'

// The work queues. Each is one admin-API list; "pending" is decided here so
// the sidebar, Home and the screens agree on what still needs attention.
export const QUEUES = {
  verifications: { action: 'list_verification_requests', permission: 'verifications', isPending: r => r.status === 'pending' },
  claims: { action: 'list_business_claims', permission: 'claims', isPending: r => r.status === 'pending' },
  reports: { action: 'list_reports', permission: 'reports', isPending: r => r.status === 'pending' },
  news: { action: 'list_news', permission: 'news', isPending: r => r.status === 'pending' },
  // The withdrawal engine has no "pending" status: a request awaits action
  // while it is reserved or processing.
  withdrawals: { action: 'list_withdrawal_requests', permission: 'withdrawals', isPending: r => r.status === 'reserved' || r.status === 'processing' },
}

const NAMES = Object.keys(QUEUES)
const STALE_MS = 15000

// Under the ['admin'] prefix on purpose: the existing
// invalidateQueries({ queryKey: ['admin'] }) calls refresh these too.
export const queueKey = (name) => ['admin', 'queue', name]

async function fetchQueue(name) {
  const res = await callAdminAuth(QUEUES[name].action, {})
  return res?.data || []
}

const queryFor = (name, enabled) => ({
  queryKey: queueKey(name),
  queryFn: () => fetchQueue(name),
  enabled,
  staleTime: STALE_MS,
})

// Queue permissions are all pre-existing keys: allowed unless explicitly false.
const allowed = (permissions, name) => permissions?.[QUEUES[name].permission] !== false

export function useQueue(name, { enabled = true } = {}) {
  const { permissions } = useAdmin()
  return useQuery(queryFor(name, enabled && allowed(permissions, name)))
}

export function usePendingCounts() {
  const { permissions } = useAdmin()
  const results = useQueries({ queries: NAMES.map(n => queryFor(n, allowed(permissions, n))) })

  const counts = {}
  let failed = false
  let total = 0
  NAMES.forEach((name, i) => {
    const r = results[i]
    if (r.isError) { failed = true; counts[name] = null; return }
    if (!r.data) { counts[name] = null; return }
    counts[name] = r.data.filter(QUEUES[name].isPending).length
    total += counts[name]
  })
  // The moderation queue lists reports and pending verifications together.
  counts.queue = counts.reports == null || counts.verifications == null ? null : counts.reports + counts.verifications

  return { counts, total, failed }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/modules/admin/AdminFeedback.test.jsx src/modules/admin/data/queues.test.jsx`
Expected: PASS (5 + 7).

- [ ] **Step 6: Commit**

```bash
git add apps/carefind/src/modules/admin/AdminFeedback.jsx apps/carefind/src/modules/admin/AdminFeedback.test.jsx apps/carefind/src/modules/admin/data apps/carefind/src/modules/admin/test && git commit -m "feat(carefind): admin feedback provider and per-queue data hooks" -- apps/carefind/src/modules/admin/AdminFeedback.jsx apps/carefind/src/modules/admin/AdminFeedback.test.jsx apps/carefind/src/modules/admin/data apps/carefind/src/modules/admin/test
```

---

### Task 4: Shell (sidebar, top bar, layout)

**Files:**
- Create: `src/modules/admin/shell/Sidebar.jsx`, `src/modules/admin/shell/TopBar.jsx`, `src/modules/admin/shell/AdminShell.jsx`
- Modify: `src/modules/admin/CommandPalette.jsx:1-12,39,60-62`, `src/modules/admin/__tests__/CommandPalette.test.jsx` (the `vi.mock('../AdminSidebar', …)` block), `src/styles/global.css` (append)
- Test: `src/modules/admin/shell/Sidebar.test.jsx`, `src/modules/admin/shell/TopBar.test.jsx`

**Interfaces:**
- Consumes: `visibleGroups`, `pathFor`, `canAccess`, `ALERTS`, `screenForPath`, `SCREENS`, `GROUPS` (Task 1); `useAdmin` (Task 2); `usePendingCounts`, `useAdminActivity` (Task 3); `DashboardShell`, `useBreakpoint` from the design system; existing `CommandPalette`, `useCommandPalette`, `AdminAiCopilot`, `useRealtimeChannel`.
- Produces:
  - `<Sidebar collapsed onToggleCollapse counts countsFailed isMobile mobileOpen onCloseMobile />`
  - `<TopBar isMobile onOpenMenu onOpenSearch alertsCount />`
  - `<AdminShell />` (layout route element; renders `<Outlet />`)
  - `CommandPalette` now takes `adminUser` in addition to `permissions`

- [ ] **Step 1: Write the failing tests**

`src/modules/admin/shell/Sidebar.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'

vi.mock('../adminApi', () => ({ callAdminAuth: vi.fn(), SESSION_EXPIRED_EVENT: 'admin:session-expired' }))
vi.mock('../../social-feed/Logo', () => ({ default: () => <span>logo</span> }))

import { renderAdmin } from '../test/renderAdmin.jsx'
import Sidebar from './Sidebar.jsx'

const base = { collapsed: false, onToggleCollapse: () => {}, counts: {}, countsFailed: false, isMobile: false, mobileOpen: false, onCloseMobile: () => {} }

describe('Sidebar', () => {
  it('shows every group to a super admin and marks the current screen', () => {
    renderAdmin(<Sidebar {...base} />, { route: '/admin/moderation/reports' })
    ;['Moderation', 'Content', 'Community', 'Directory', 'Commerce', 'Finance', 'Agents', 'Platform']
      .forEach(label => expect(screen.getByText(label)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /Reports/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Home/ })).not.toHaveAttribute('aria-current')
  })

  it('hides screens and whole groups a restricted role may not see', () => {
    renderAdmin(<Sidebar {...base} />, { admin: { id: 'm', role: 'moderator' }, permissions: { withdrawals: false, users: false } })
    expect(screen.queryByText('Agents')).not.toBeInTheDocument()
    expect(screen.queryByText('Finance')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Users/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Directory manager/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Tasks/ })).toBeInTheDocument()
  })

  it('shows a pending count in the link name and omits zero or unknown counts', () => {
    renderAdmin(<Sidebar {...base} counts={{ verifications: 12, reports: 0, claims: null, queue: 120 }} />)
    expect(screen.getByRole('link', { name: 'Verifications, 12 pending' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Queue, 120 pending' })).toHaveTextContent('99+')
    expect(screen.getByRole('link', { name: 'Reports' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Claims' })).toBeInTheDocument()
  })

  it('says when counts are incomplete', () => {
    renderAdmin(<Sidebar {...base} countsFailed />)
    expect(screen.getByText('Some counts could not be loaded')).toBeInTheDocument()
  })

  it('keeps links named when collapsed', () => {
    renderAdmin(<Sidebar {...base} collapsed counts={{ verifications: 3 }} />)
    expect(screen.getByRole('link', { name: 'Verifications, 3 pending' })).toBeInTheDocument()
    expect(screen.queryByText('Moderation')).not.toBeInTheDocument()
  })

  it('renders nothing on mobile until opened, then closes on navigation', () => {
    const onCloseMobile = vi.fn()
    const closed = renderAdmin(<Sidebar {...base} isMobile />)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    closed.unmount()
    renderAdmin(<Sidebar {...base} isMobile mobileOpen onCloseMobile={onCloseMobile} />)
    fireEvent.click(screen.getByRole('link', { name: /Posts/ }))
    expect(onCloseMobile).toHaveBeenCalled()
  })

  it('signs out from the account block', () => {
    const { container } = renderAdmin(<Sidebar {...base} />)
    expect(container).toHaveTextContent('Admin')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})
```

`src/modules/admin/shell/TopBar.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'

vi.mock('../adminApi', () => ({ callAdminAuth: vi.fn(), SESSION_EXPIRED_EVENT: 'admin:session-expired' }))

import { renderAdmin } from '../test/renderAdmin.jsx'
import TopBar from './TopBar.jsx'

describe('TopBar', () => {
  it('opens search and links to alerts with the pending total', () => {
    const onOpenSearch = vi.fn()
    renderAdmin(<TopBar isMobile={false} onOpenMenu={() => {}} onOpenSearch={onOpenSearch} alertsCount={2} />)
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(onOpenSearch).toHaveBeenCalled()
    const bell = screen.getByRole('link', { name: 'Alerts, 2 pending' })
    expect(bell).toHaveAttribute('href', '/admin/alerts')
    expect(bell).toHaveTextContent('2')
    expect(screen.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument()
  })

  it('shows the menu button on mobile and no badge at zero', () => {
    const onOpenMenu = vi.fn()
    renderAdmin(<TopBar isMobile onOpenMenu={onOpenMenu} onOpenSearch={() => {}} alertsCount={0} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(onOpenMenu).toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Alerts' })).toBeInTheDocument()
  })

  it('hides the bell from a role without the alerts permission', () => {
    renderAdmin(<TopBar isMobile={false} onOpenMenu={() => {}} onOpenSearch={() => {}} alertsCount={5} />,
      { admin: { id: 'm', role: 'moderator' }, permissions: { notifications: false } })
    expect(screen.queryByRole('link', { name: /Alerts/ })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/modules/admin/shell`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the sidebar**

`src/modules/admin/shell/Sidebar.jsx`:

```jsx
import { NavLink } from 'react-router-dom'
import { PanelLeftClose, PanelLeftOpen, LogOut, AlertTriangle, X } from 'lucide-react'
import Logo from '../../social-feed/Logo'
import { theme } from '../../../styles/theme'
import { useAdmin } from '../AdminGate.jsx'
import { visibleGroups, pathFor } from '../navigation'

export const NAV_WIDTH = 256
export const NAV_COLLAPSED_WIDTH = 64

const iconButton = {
  width: 32, height: 32, borderRadius: theme.radius.md, border: `1px solid ${theme.border}`,
  background: theme.cardBg, cursor: 'pointer', display: 'flex', alignItems: 'center',
  justifyContent: 'center', color: theme.textMid, flexShrink: 0,
}

function NavItem({ item, count, collapsed, onNavigate }) {
  const Icon = item.icon
  const hasCount = count != null && count > 0
  const name = hasCount ? `${item.label}, ${count} pending` : item.label
  return (
    <NavLink
      to={pathFor(item.key)}
      end={item.path === ''}
      aria-label={name}
      title={collapsed ? name : undefined}
      onClick={onNavigate}
      className="cf-admin-nav-item"
      style={({ isActive }) => ({
        position: 'relative', display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 10,
        justifyContent: collapsed ? 'center' : 'flex-start',
        padding: collapsed ? '10px 0' : '8px 12px', marginBottom: 2,
        borderRadius: theme.radius.md, textDecoration: 'none', fontSize: 13, fontWeight: 600,
        background: isActive ? theme.tealMist : 'transparent',
        color: isActive ? theme.tealDeep : theme.textMid,
      })}
    >
      <Icon size={16} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0 }} />
      {!collapsed && <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>}
      {hasCount && !collapsed && (
        <span aria-hidden="true" style={{ minWidth: 20, padding: '1px 7px', borderRadius: theme.radius.full, background: theme.warningBg, color: theme.warning, fontSize: 11, fontWeight: 800, textAlign: 'center' }}>
          {count > 99 ? '99+' : count}
        </span>
      )}
      {hasCount && collapsed && (
        <span aria-hidden="true" style={{ position: 'absolute', top: 5, right: 12, width: 8, height: 8, borderRadius: '50%', background: theme.warning }} />
      )}
    </NavLink>
  )
}

export default function Sidebar({ collapsed, onToggleCollapse, counts = {}, countsFailed = false, isMobile, mobileOpen, onCloseMobile }) {
  const admin = useAdmin()
  const { adminUser, signOut } = admin
  const groups = visibleGroups(admin)
  const isCollapsed = !isMobile && collapsed

  if (isMobile && !mobileOpen) return null

  const panel = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: isMobile ? NAV_WIDTH : '100%', maxWidth: '86vw', background: theme.cardBg, borderRight: `1px solid ${theme.border}`, boxSizing: 'border-box' }}>
      <div style={{ padding: isCollapsed ? '14px 8px' : '14px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'space-between', gap: 8 }}>
        {!isCollapsed && <Logo size={26} />}
        {isMobile ? (
          <button onClick={onCloseMobile} aria-label="Close menu" style={iconButton}><X size={16} aria-hidden="true" /></button>
        ) : (
          <button onClick={onToggleCollapse} aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} style={iconButton}>
            {isCollapsed ? <PanelLeftOpen size={15} aria-hidden="true" /> : <PanelLeftClose size={15} aria-hidden="true" />}
          </button>
        )}
      </div>

      <nav aria-label="Admin" style={{ flex: 1, overflowY: 'auto', padding: isCollapsed ? '8px 6px' : '8px 10px' }}>
        {groups.map((group, gi) => (
          <div key={group.id} style={{ marginBottom: 4 }}>
            {!isCollapsed && group.label && (
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: theme.textLight, padding: '12px 12px 4px' }}>
                {group.label}
              </div>
            )}
            {isCollapsed && gi > 0 && <div style={{ height: 1, background: theme.border, margin: '6px 0' }} />}
            {group.screens.map(item => (
              <NavItem key={item.key} item={item} collapsed={isCollapsed} count={item.countKey ? counts[item.countKey] : null} onNavigate={isMobile ? onCloseMobile : undefined} />
            ))}
          </div>
        ))}
      </nav>

      {countsFailed && !isCollapsed && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 11, color: theme.warning, borderTop: `1px solid ${theme.border}` }}>
          <AlertTriangle size={13} aria-hidden="true" /> Some counts could not be loaded
        </div>
      )}

      <div style={{ padding: isCollapsed ? '10px 6px' : '10px 12px', borderTop: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', gap: 8, justifyContent: isCollapsed ? 'center' : 'flex-start' }}>
        {!isCollapsed && (
          <>
            <div aria-hidden="true" style={{ width: 34, height: 34, borderRadius: '50%', background: theme.tealMist, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, color: theme.tealDeep, flexShrink: 0 }}>
              {(adminUser?.full_name || 'A')[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: theme.textDark, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{adminUser?.full_name || 'Admin'}</div>
              <div style={{ fontSize: 10.5, color: theme.textLight }}>{adminUser?.role?.replace(/_/g, ' ') || 'admin'}</div>
            </div>
          </>
        )}
        <button onClick={signOut} aria-label="Sign out" style={{ ...iconButton, border: 'none', background: 'none' }}><LogOut size={16} aria-hidden="true" /></button>
      </div>
    </div>
  )

  if (!isMobile) return panel

  return (
    <>
      <div onClick={onCloseMobile} style={{ position: 'fixed', inset: 0, background: theme.overlay, zIndex: 200 }} />
      <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 201 }}>{panel}</div>
    </>
  )
}
```

- [ ] **Step 4: Implement the top bar**

`src/modules/admin/shell/TopBar.jsx`:

```jsx
import { Link } from 'react-router-dom'
import { Menu, Search, Bell } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { useAdmin } from '../AdminGate.jsx'
import { ALERTS, canAccess, pathFor } from '../navigation'

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent)

const square = {
  width: 40, height: 40, borderRadius: theme.radius.md, border: `1px solid ${theme.border}`,
  background: theme.cardBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: theme.textMid, cursor: 'pointer', flexShrink: 0, position: 'relative', textDecoration: 'none',
}

export default function TopBar({ isMobile, onOpenMenu, onOpenSearch, alertsCount = 0 }) {
  const admin = useAdmin()
  const showBell = canAccess(ALERTS, admin)
  return (
    <div style={{ height: 56, display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '0 12px' : '0 20px', background: theme.cardBg, borderBottom: `1px solid ${theme.border}`, boxSizing: 'border-box' }}>
      {isMobile && (
        <button onClick={onOpenMenu} aria-label="Open menu" style={square}><Menu size={18} aria-hidden="true" /></button>
      )}
      <button
        onClick={onOpenSearch}
        aria-label="Search the admin console"
        style={{ flex: 1, maxWidth: 420, height: 40, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderRadius: theme.radius.md, border: `1px solid ${theme.border}`, background: theme.bg, color: theme.textLight, fontSize: 13, cursor: 'pointer', fontFamily: theme.fontFamily, textAlign: 'left' }}
      >
        <Search size={15} aria-hidden="true" />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Search screens and actions…</span>
        {!isMobile && (
          <span aria-hidden="true" style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 6px', borderRadius: theme.radius.sm, border: `1px solid ${theme.border}`, background: theme.cardBg }}>
            {isMac ? '⌘K' : 'Ctrl K'}
          </span>
        )}
      </button>
      <div style={{ flex: 1 }} />
      {showBell && (
        <Link to={pathFor(ALERTS.key)} aria-label={alertsCount > 0 ? `Alerts, ${alertsCount} pending` : 'Alerts'} style={square}>
          <Bell size={17} aria-hidden="true" />
          {alertsCount > 0 && (
            <span aria-hidden="true" style={{ position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: theme.danger, color: 'white', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
              {alertsCount > 99 ? '99+' : alertsCount}
            </span>
          )}
        </Link>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Point the command palette at the registry**

In `src/modules/admin/CommandPalette.jsx`, replace the `NAV_GROUPS` import and `ALL_TABS` (lines 8–12):

```jsx
import { GROUPS, SCREENS, canAccess } from './navigation'

const ALL_TABS = SCREENS.map(s => ({
  ...s,
  group: GROUPS.find(g => g.id === s.group)?.label || 'Home',
  type: 'tab',
}))
```

Change the signature (line 39) to `export default function CommandPalette({ open, onClose, onNavigate, onSignOut, onRefresh, permissions, adminUser }) {` and the filter (line 61) to:

```jsx
    const tabs = ALL_TABS.filter(t => canAccess(t, { adminUser: adminUser || { role: '' }, permissions }))
```

and add `adminUser` to that `useMemo`'s dependency array (`[query, permissions, adminUser]`). Remove any lucide icon imports at the top of the file that are no longer referenced (the tab icons now come from the registry); keep `LogOut`, `RotateCcw`, `Clock`, `Search` if still used further down.

In `src/modules/admin/__tests__/CommandPalette.test.jsx`, replace the whole `vi.mock('../AdminSidebar', () => ({ NAV_GROUPS: [ … ] }))` block with the following, moving the existing `NAV_GROUPS` array literal unchanged into the factory:

```jsx
vi.mock('../navigation', () => {
  const NAV_GROUPS = [
    // paste the existing NAV_GROUPS array elements here, exactly as they were
  ]
  return {
    GROUPS: NAV_GROUPS.map(g => ({ id: g.id, label: g.label })),
    SCREENS: NAV_GROUPS.flatMap(g => g.items.map(i => ({ ...i, group: g.id, permission: i.key, path: i.key }))),
    canAccess: (item, { permissions } = {}) => permissions?.[item.permission] !== false,
  }
})
```

Run: `npm test -- src/modules/admin/__tests__/CommandPalette.test.jsx`
Expected: PASS with no assertion changes.

- [ ] **Step 6: Implement the shell**

`src/modules/admin/shell/AdminShell.jsx`:

```jsx
import { Suspense, useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { DashboardShell, useBreakpoint } from '@care-ecosystem/design-system/components/ui'
import { Loading } from '../../../components/ui'
import { theme } from '../../../styles/theme'
import { useAdmin } from '../AdminGate.jsx'
import { useAdminActivity } from '../AdminFeedback.jsx'
import { usePendingCounts } from '../data/queues'
import { useRealtimeChannel } from '../hooks/useRealtimeChannel'
import { pathFor, screenForPath } from '../navigation'
import CommandPalette from '../CommandPalette.jsx'
import useCommandPalette from '../useCommandPalette.js'
import AdminAiCopilot from '../AdminAiCopilot.jsx'
import Sidebar, { NAV_WIDTH, NAV_COLLAPSED_WIDTH } from './Sidebar.jsx'
import TopBar from './TopBar.jsx'

const COLLAPSE_KEY = 'carefind_sidebar_collapsed'
const POLL_MS = 30000

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === 'true' } catch { return false }
}

export default function AdminShell() {
  const { adminUser, permissions, signOut } = useAdmin()
  const { isMobile, isMobileOrTablet } = useBreakpoint()
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { counts, total, failed } = usePendingCounts()
  const { recentActions, recordAction } = useAdminActivity()
  const { open: cmdOpen, setOpen: setCmdOpen, addToRecent } = useCommandPalette()

  const [userCollapsed, setUserCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [copilotOpen, setCopilotOpen] = useState(false)

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, String(userCollapsed)) } catch { /* private mode */ }
  }, [userCollapsed])

  // Tablet has no room for the expanded rail, so it is collapsed there
  // regardless of the saved preference.
  const collapsed = !isMobile && (isMobileOrTablet || userCollapsed)

  const refresh = useCallback(() => { qc.invalidateQueries({ queryKey: ['admin'] }) }, [qc])

  useRealtimeChannel({ channelName: 'admin-notifications', subscription: { schema: 'public', table: 'verification_requests' }, onInsert: refresh, onUpdate: refresh, pollInterval: POLL_MS, pollFn: refresh })
  useRealtimeChannel({ channelName: 'admin-posts', subscription: { schema: 'public', table: 'posts' }, onInsert: refresh, pollInterval: POLL_MS, pollFn: refresh })
  useRealtimeChannel({ channelName: 'admin-reports', subscription: { schema: 'public', table: 'reports' }, onInsert: refresh, onUpdate: refresh, pollInterval: POLL_MS, pollFn: refresh })
  useRealtimeChannel({ channelName: 'admin-news', subscription: { schema: 'public', table: 'news', filter: 'status=eq.pending' }, onInsert: refresh, onUpdate: refresh, pollInterval: POLL_MS, pollFn: refresh })

  const goTo = useCallback((key) => {
    navigate(pathFor(key))
    addToRecent(key)
    setCmdOpen(false)
  }, [navigate, addToRecent, setCmdOpen])

  const currentKey = screenForPath(location.pathname)?.key || 'overview'

  return (
    <>
      <DashboardShell
        collapsed={collapsed}
        navWidth={NAV_WIDTH}
        navCollapsedWidth={NAV_COLLAPSED_WIDTH}
        contentMaxWidth={1280}
        nav={(
          <Sidebar
            collapsed={collapsed}
            onToggleCollapse={() => setUserCollapsed(v => !v)}
            counts={counts}
            countsFailed={failed}
            isMobile={isMobile}
            mobileOpen={mobileOpen}
            onCloseMobile={() => setMobileOpen(false)}
          />
        )}
        topbar={(
          <TopBar isMobile={isMobile} onOpenMenu={() => setMobileOpen(true)} onOpenSearch={() => setCmdOpen(true)} alertsCount={total} />
        )}
      >
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </DashboardShell>

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onNavigate={goTo}
        onSignOut={signOut}
        onRefresh={refresh}
        permissions={permissions}
        adminUser={adminUser}
      />

      <button
        onClick={() => setCopilotOpen(true)}
        aria-label="Open the AI copilot"
        style={{ position: 'fixed', bottom: 20, right: 20, width: 52, height: 52, borderRadius: '50%', background: theme.tealDeep, border: 'none', boxShadow: theme.elevation[2], cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 150 }}
      >
        <Sparkles size={22} color="white" aria-hidden="true" />
      </button>
      <AdminAiCopilot
        isOpen={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        currentTab={currentKey}
        recentActions={recentActions}
        onFeedback={(suggestionId, accepted) => recordAction({ action: accepted ? 'copilot_accept' : 'copilot_reject', target: suggestionId })}
      />
    </>
  )
}
```

Append to `src/styles/global.css`:

```css
/* Admin console sidebar: hover cannot be expressed in inline styles. */
.cf-admin-nav-item:hover { background: var(--hairline); }
.cf-admin-nav-item[aria-current="page"]:hover { background: var(--teal-mist); }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- src/modules/admin/shell src/modules/admin/__tests__/CommandPalette.test.jsx`
Expected: PASS (7 sidebar + 3 top bar + the existing palette tests). `AdminShell` itself is exercised through `AdminApp` in Task 5.

- [ ] **Step 8: Commit**

```bash
git add apps/carefind/src/modules/admin/shell apps/carefind/src/modules/admin/CommandPalette.jsx apps/carefind/src/modules/admin/__tests__/CommandPalette.test.jsx apps/carefind/src/styles/global.css && git commit -m "feat(carefind): admin console shell with grouped sidebar and top bar" -- apps/carefind/src/modules/admin/shell apps/carefind/src/modules/admin/CommandPalette.jsx apps/carefind/src/modules/admin/__tests__/CommandPalette.test.jsx apps/carefind/src/styles/global.css
```

Note: `AdminSidebar.jsx` still exists and still exports `NAV_GROUPS` for `AdminPanel.jsx`; both go in Task 5.

---

### Task 5: Route the console and retire `AdminPanel`

This is the cut-over. After it, `/admin` is the admin and every existing screen works inside the new shell.

**Files:**
- Create: `src/modules/admin/AdminApp.jsx`, `src/modules/admin/ui/NoAccess.jsx`
- Move: `src/modules/admin/AdminPanel.jsx` → `src/modules/admin/legacy/LegacyScreens.jsx`; `src/modules/admin/AdminPanel.news.test.jsx` → `src/modules/admin/AdminApp.news.test.jsx`
- Delete: `src/modules/admin/AdminLayout.jsx`, `src/modules/admin/AdminSidebar.jsx`
- Modify: `src/main.jsx`, `src/modules/admin/ui/index.js`, `src/modules/admin/AdminLogin.jsx:53`, `src/modules/admin/AdminLogin.test.jsx:57`, `src/modules/account/Login.jsx:101`, `src/modules/account/Login.test.jsx:109`
- Test: `src/modules/admin/AdminApp.test.jsx`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces:
  - `<AdminApp />` default export (rendered by `main.jsx` for any `isAdminPath`)
  - `<NoAccess />`
  - `<LegacyScreens tab="<permission key>" />` default export
  - `SCREEN_COMPONENTS` inside `AdminApp.jsx`: a map from screen key to a lazy component; later tasks add entries to it

- [ ] **Step 1: Write the failing test**

`src/modules/admin/AdminApp.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { renderWithQueryClient } from '../../test/renderWithQueryClient.jsx'

const { supabase, callAdminAuth } = vi.hoisted(() => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn() } },
  callAdminAuth: vi.fn(),
}))
vi.mock('../../config/supabaseClient', () => ({ supabase }))
vi.mock('./adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))
vi.mock('./hooks/useRealtimeChannel', () => ({ useRealtimeChannel: () => {} }))
vi.mock('./AdminAiCopilot.jsx', () => ({ default: () => null }))
vi.mock('../social-feed/Logo', () => ({ default: () => <span>logo</span> }))
vi.mock('./legacy/LegacyScreens.jsx', () => ({ default: ({ tab }) => <div>legacy:{tab}</div> }))
vi.mock('../agents-hub/AgentApproval.jsx', () => ({ default: () => <div>agent approval page</div> }))
vi.mock('../agents-hub/AgentEarnings.jsx', () => ({ default: () => <div>agent earnings page</div> }))
vi.mock('../agents-hub/AgentTransfer.jsx', () => ({ default: () => <div>agent transfer page</div> }))
vi.mock('../businesses-hub/BusinessesHub.jsx', () => ({ default: () => <div>business hub page</div> }))
vi.mock('../business-directory/BusinessDirectoryPage', () => ({ default: () => <div>directory manager page</div> }))

import AdminApp from './AdminApp.jsx'
import { isAdminPath } from './navigation'

// Mirrors main.jsx: admin paths go to AdminApp, everything else is "outside".
function Root() {
  const location = useLocation()
  return isAdminPath(location.pathname) ? <AdminApp /> : <div>outside:{location.pathname}</div>
}
const renderAt = (route) => renderWithQueryClient(<MemoryRouter initialEntries={[route]}><Root /></MemoryRouter>)

function signInAs(admin, permissions = {}) {
  callAdminAuth.mockImplementation(async (action) => {
    if (action === 'verify') return { admin, permissions }
    return { data: [] }
  })
}

describe('AdminApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    // Desktop width: the sidebar's collapse control only exists above tablet.
    window.innerWidth = 1440
    supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
    supabase.auth.signOut.mockResolvedValue({ error: null })
    signInAs({ id: 'a1', full_name: 'Ada', role: 'super_admin' })
  })

  it('sends a signed-out visitor to login', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    renderAt('/admin/moderation/reports')
    expect(await screen.findByText('outside:/login')).toBeInTheDocument()
  })

  it('renders an unmigrated screen through the legacy adapter', async () => {
    renderAt('/admin/content/news')
    expect(await screen.findByText('legacy:news')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument()
  })

  it.each([
    ['/admin-panel', 'legacy:overview'],
    ['/admin/dashboard', 'legacy:overview'],
    ['/admin/businesses', 'business hub page'],
    ['/admin/agents', 'agent approval page'],
    ['/admin/applications', 'agent approval page'],
    ['/admin/earnings', 'agent earnings page'],
    ['/admin/transfers', 'agent transfer page'],
    ['/business-directory', 'directory manager page'],
    ['/agents/approval', 'agent approval page'],
    ['/agents/earnings', 'agent earnings page'],
    ['/agents/transfer', 'agent transfer page'],
  ])('redirects the legacy address %s', async (from, text) => {
    renderAt(from)
    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it('keeps the query string when redirecting a legacy address', async () => {
    function Where() { const l = useLocation(); return <span>at:{l.pathname}{l.search}</span> }
    renderWithQueryClient(<MemoryRouter initialEntries={['/admin/businesses?id=b7']}><Root /><Where /></MemoryRouter>)
    expect(await screen.findByText('at:/admin/directory/business-hub?id=b7')).toBeInTheDocument()
  })

  it('shows the alerts page from the bell address', async () => {
    renderAt('/admin/alerts')
    expect(await screen.findByText('legacy:notifications')).toBeInTheDocument()
  })

  it('shows no-access for a screen the role may not open, and never renders it', async () => {
    signInAs({ id: 'm', full_name: 'Mo', role: 'moderator' }, { users: false })
    renderAt('/admin/community/users')
    expect(await screen.findByText("You don't have access to this screen")).toBeInTheDocument()
    expect(screen.queryByText('legacy:users')).not.toBeInTheDocument()
  })

  it('denies the new agent screens to a restricted role by default', async () => {
    signInAs({ id: 'm', full_name: 'Mo', role: 'moderator' }, {})
    renderAt('/admin/agents/transfers')
    expect(await screen.findByText("You don't have access to this screen")).toBeInTheDocument()
    expect(screen.queryByText('agent transfer page')).not.toBeInTheDocument()
  })

  it('sends a role without the overview permission to its first permitted screen', async () => {
    // The Moderation screens leave the legacy adapter later in this plan, so
    // this role is denied them too and its first permitted screen is Posts.
    signInAs({ id: 'm', full_name: 'Mo', role: 'moderator' },
      { overview: false, moderation: false, reports: false, verifications: false, claims: false })
    renderAt('/admin')
    expect(await screen.findByText('legacy:posts')).toBeInTheDocument()
  })

  it('shows a not-found state for an unknown admin address', async () => {
    renderAt('/admin/nope/nothing')
    expect(await screen.findByText('This admin page does not exist')).toBeInTheDocument()
  })

  it('does not re-verify or remount the shell when moving between screens', async () => {
    renderAt('/admin/content/news')
    await screen.findByText('legacy:news')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Posts' }))
    expect(await screen.findByText('legacy:posts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    expect(callAdminAuth.mock.calls.filter(c => c[0] === 'verify')).toHaveLength(1)
  })

  it('returns to login when the session expires on an open screen', async () => {
    renderAt('/admin/content/news')
    await screen.findByText('legacy:news')
    window.dispatchEvent(new CustomEvent('admin:session-expired'))
    await waitFor(() => expect(screen.getByText('outside:/login')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/admin/AdminApp.test.jsx`
Expected: FAIL, `./AdminApp.jsx` not found.

- [ ] **Step 3: Create `NoAccess`**

`src/modules/admin/ui/NoAccess.jsx`:

```jsx
import { Lock, SearchX } from 'lucide-react'
import { Empty } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../styles/theme'

export function NoAccess() {
  return (
    <Empty
      icon={<Lock size={40} strokeWidth={1.5} color={theme.gray300} />}
      title="You don't have access to this screen"
      message="Ask a super admin to grant this screen to your role."
    />
  )
}

export function AdminNotFound() {
  return (
    <Empty
      icon={<SearchX size={40} strokeWidth={1.5} color={theme.gray300} />}
      title="This admin page does not exist"
      message="Pick a screen from the sidebar."
    />
  )
}
```

Add to `src/modules/admin/ui/index.js`:

```js
export { NoAccess, AdminNotFound } from './NoAccess.jsx'
```

Open `packages/design-system/src/components/ui/State.jsx` and confirm how `Empty` renders `title` and `message`. If `title` is not rendered as visible text, put the heading text in `message` and the hint in `description` so the two strings asserted by the test are on screen.

- [ ] **Step 4: Move `AdminPanel` to the legacy adapter**

From the repo root:

```bash
mkdir -p apps/carefind/src/modules/admin/legacy
git mv apps/carefind/src/modules/admin/AdminPanel.jsx apps/carefind/src/modules/admin/legacy/LegacyScreens.jsx
git mv apps/carefind/src/modules/admin/AdminPanel.news.test.jsx apps/carefind/src/modules/admin/AdminApp.news.test.jsx
```

Edit `legacy/LegacyScreens.jsx`:

(a) Replace everything from the first line down to and including `const ALL_TABS = NAV_GROUPS.flatMap(g => g.items)` with:

```jsx
import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../config/supabaseClient'
import { usersRepository } from '../repositories/usersRepository'
import { commerceRepository } from '../repositories/commerceRepository'
import { liveRepository } from '../repositories/liveRepository'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../AdminGate.jsx'
import { useAdminToast, useAdminConfirm, useAdminActivity } from '../AdminFeedback.jsx'
import { pathFor, PERMISSION_ITEMS } from '../navigation'
import HealthPulse from '../HealthPulse.jsx'
import ShopTab from '../tabs/ShopTab.jsx'
import { useAdminData, useAdminStories, useAdminNews, useAdminPromotions, useAdminSearchLogs, useAdminLiveShows, useAdminShopData, useAdminRoles } from '../../../hooks/queries'
import { useQueryClient } from '@tanstack/react-query'

import OverviewTab from '../tabs/OverviewTab.jsx'
import VerificationsTab from '../tabs/VerificationsTab.jsx'
import ClaimsTab from '../tabs/ClaimsTab.jsx'
import ReportsTab from '../tabs/ReportsTab.jsx'
import UsersTab from '../tabs/UsersTab.jsx'
import PostsTab from '../tabs/PostsTab.jsx'
import RevenueTab from '../tabs/RevenueTab.jsx'
import DrugsTab from '../tabs/DrugsTab.jsx'
import TasksTab from '../tabs/TasksTab.jsx'
import TeamsTab from '../tabs/TeamsTab.jsx'
import WithdrawalsTab from '../tabs/WithdrawalsTab.jsx'
import BusinessesTab from '../tabs/BusinessesTab.jsx'
import StoriesTab from '../tabs/StoriesTab.jsx'
import NewsTab from '../tabs/NewsTab.jsx'
import PromotionsTab from '../tabs/PromotionsTab.jsx'
import SearchesTab from '../tabs/SearchesTab.jsx'
import GoLiveTab from '../tabs/GoLiveTab.jsx'
import NotificationsTab from '../tabs/NotificationsTab.jsx'
import EmailTemplatesTab from '../tabs/EmailTemplatesTab.jsx'
import ModerationQueue from '../tabs/ModerationQueue.jsx'
import AuditLog from '../components/AuditLog.jsx'
import OrdersTab from '../tabs/OrdersTab.jsx'
import DashboardTab from '../tabs/DashboardTab.jsx'
import ErrorsTab from '../tabs/ErrorsTab.jsx'
import { ModerationProvider } from '../stores/moderationStore'

// Migration adapter (spec section 5.7): the body of the old AdminPanel with
// its layout, auth check, toast, confirm dialog and palette removed. Each
// screen leaves this file when it is rebuilt; the file is deleted in Plan 2.
```

(b) Delete the `clearAdminCache` function.

(c) Change `export default function AdminPanel() {` to `export default function LegacyScreens({ tab }) {`.

(d) Replace these four lines at the top of the function body:

```jsx
  const [adminUser, setAdminUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')
  const [adminPermissions, setAdminPermissions] = useState({})
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()
```

with:

```jsx
  const { adminUser } = useAdmin()
  const showToast = useAdminToast()
  const askConfirm = useAdminConfirm()
  const { recordAction } = useAdminActivity()
  const setTab = useCallback((key) => navigate(pathFor(key)), [navigate])
```

(e) Delete `const [aiCopilotOpen, setAiCopilotOpen] = useState(false)` and `const [adminActionHistory, setAdminActionHistory] = useState([])`.

(f) Delete the block from `const [confirmState, setConfirmState] = useState(null)` through the end of `handleCmdNavigate` (the `askConfirm` function, the `useCommandPalette()` line and `handleCmdNavigate`). Keep the `logAuditAction` function above it.

(g) Delete all four `useRealtimeChannel({ … })` calls, the whole `useEffect(() => { const verifySession = async () => { … } verifySession() }, [])` block, and the `useEffect(() => { if (adminUser) invalidateAdmin() }, [adminUser])` block.

(h) From the repo root, rewrite the activity calls in one pass, then confirm none remain:

```bash
sed -i -E 's/setAdminActionHistory\(prev => \[\.\.\.prev\.slice\(-49\), (\{.*\})\]\)/recordAction(\1)/' apps/carefind/src/modules/admin/legacy/LegacyScreens.jsx
grep -n "setAdminActionHistory\|adminActionHistory" apps/carefind/src/modules/admin/legacy/LegacyScreens.jsx
```

Expected: the `grep` prints nothing.

(i) Delete `if (loading) return <Loading … />`, the unused `card` and `input` constants, `let adminLoggingOut = false` and the whole `handleSignOut` function.

(j) Replace the `return ( … )` at the end of the component with the following. Keep the 26 `{tab === '…' && <…Tab … />}` lines exactly as they are today (they are elided here only because they are long and unchanged), with one edit: in the `teams` line change `ALL_TABS={ALL_TABS}` to `ALL_TABS={PERMISSION_ITEMS}`.

```jsx
  return (
    <ModerationProvider>
      <div aria-live="polite">
        {/* the existing {tab === '…' && …} lines, unchanged apart from ALL_TABS */}
      </div>
    </ModerationProvider>
  )
}
```

(k) Check nothing removed is still referenced:

```bash
grep -nE "useToast|ConfirmDialog|<Toast|CommandPalette|AdminAiCopilot|AdminLayout|useRealtimeChannel|Sparkles|NAV_GROUPS|ALL_TABS=\{ALL_TABS\}|adminPermissions|setLoading|setAdminUser|confirmState|toastMsg|\btheme\b|\btimeAgo\b|contentRepository" apps/carefind/src/modules/admin/legacy/LegacyScreens.jsx
```

Expected: no output. If a name is still used (for example `contentRepository`), re-add only that import with its `../` path.

- [ ] **Step 5: Create `AdminApp`**

`src/modules/admin/AdminApp.jsx`:

```jsx
import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import '../../styles/tokens.css'
import { Loading } from '../../components/ui'
import { AdminGate, useAdmin } from './AdminGate.jsx'
import { AdminFeedbackProvider } from './AdminFeedback.jsx'
import AdminShell from './shell/AdminShell.jsx'
import { ADMIN_ROOT, ALERTS, LEGACY_REDIRECTS, SCREENS, canAccess, firstAccessiblePath, screenByKey } from './navigation'
import { NoAccess, AdminNotFound } from './ui/NoAccess.jsx'

const LegacyScreens = lazy(() => import('./legacy/LegacyScreens.jsx'))

// Screens that have their own component. Every other screen renders through
// the legacy adapter with its permission key as the tab.
const SCREEN_COMPONENTS = {
  businesses_hub: lazy(() => import('../businesses-hub/BusinessesHub.jsx')),
  business_import: lazy(() => import('../business-directory/BusinessDirectoryPage')),
  agent_applications: lazy(() => import('../agents-hub/AgentApproval.jsx')),
  agent_earnings: lazy(() => import('../agents-hub/AgentEarnings.jsx')),
  agent_transfers: lazy(() => import('../agents-hub/AgentTransfer.jsx')),
}

function ScreenElement({ item }) {
  const Component = SCREEN_COMPONENTS[item.key]
  return Component ? <Component /> : <LegacyScreens tab={item.permission} />
}

function Guard({ item, children }) {
  const admin = useAdmin()
  return canAccess(item, admin) ? children : <NoAccess />
}

// Home is the landing address. A role without it is sent to its first
// permitted screen instead of meeting a dead end.
function HomeRoute() {
  const admin = useAdmin()
  const home = screenByKey('overview')
  if (canAccess(home, admin)) return <ScreenElement item={home} />
  const first = firstAccessiblePath(admin)
  return first ? <Navigate to={first} replace /> : <NoAccess />
}

function LegacyRedirect({ to }) {
  const { search } = useLocation()
  return <Navigate to={`${to}${search}`} replace />
}

export default function AdminApp() {
  return (
    <AdminGate>
      <AdminFeedbackProvider>
        <Suspense fallback={<Loading fullScreen />}>
          <Routes>
            {LEGACY_REDIRECTS.map(r => (
              <Route key={r.from} path={r.from} element={<LegacyRedirect to={r.to} />} />
            ))}
            <Route path={ADMIN_ROOT} element={<AdminShell />}>
              <Route index element={<HomeRoute />} />
              {SCREENS.filter(s => s.path).map(item => (
                <Route key={item.key} path={item.path} element={<Guard item={item}><ScreenElement item={item} /></Guard>} />
              ))}
              <Route path={ALERTS.path} element={<Guard item={ALERTS}><LegacyScreens tab={ALERTS.key} /></Guard>} />
              <Route path="*" element={<AdminNotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </AdminFeedbackProvider>
    </AdminGate>
  )
}
```

- [ ] **Step 6: Wire `main.jsx` and the login targets**

In `src/main.jsx`:

1. Remove the lazy imports for `AdminPanel`, `BusinessesHub`, `DashboardHub`, `AgentApproval`, `AgentEarnings`, `AgentTransfer` and `BusinessDirectoryPage`. Keep `AgentRegistration`, `AgentLogin` and `BusinessDiscoveryPage`.
2. Add next to the other lazy imports:

```jsx
const AdminApp = lazy(() => import('./modules/admin/AdminApp.jsx'))
```

and with the top-of-file imports:

```jsx
import { isAdminPath } from './modules/admin/navigation'
```

3. In `RoutesWithKey`, immediately after `const location = useLocation()`:

```jsx
  // The admin console keeps its own, un-keyed router: its shell, filters and
  // any open record must survive navigation, which the keyed <Routes> below
  // deliberately does not allow.
  if (isAdminPath(location.pathname)) return <SuspenseWrapper><AdminApp /></SuspenseWrapper>
```

4. Delete the route lines for `/admin-panel`, `/admin/businesses`, `/admin/dashboard`, `/admin/agents`, `/admin/applications`, `/admin/earnings`, `/admin/transfers`, `/business-directory`, `/agents/approval`, `/agents/earnings`, `/agents/transfer` and the now-empty `{/* Admin — … */}` comment. Keep `/business-discovery`, `/agents/register` and `/agent-login`.

In `src/modules/admin/AdminLogin.jsx:53` and `src/modules/account/Login.jsx:101` change `navigate('/admin-panel')` to `navigate('/admin')`. In `src/modules/admin/AdminLogin.test.jsx:57` and `src/modules/account/Login.test.jsx:109` change the expected argument to `'/admin'`.

Delete the two dead files (from the repo root):

```bash
git rm apps/carefind/src/modules/admin/AdminLayout.jsx apps/carefind/src/modules/admin/AdminSidebar.jsx
```

- [ ] **Step 7: Port the news suite to the new entry point**

In `src/modules/admin/AdminApp.news.test.jsx`:

1. Change `import AdminPanel from './AdminPanel.jsx'` to `import AdminApp from './AdminApp.jsx'`.
2. Replace every occurrence of

```jsx
      <MemoryRouter>
        <AdminPanel />
      </MemoryRouter>
```

with

```jsx
      <MemoryRouter initialEntries={['/admin/content/news']}>
        <AdminApp />
      </MemoryRouter>
```

3. Add `supa.auth.signOut = vi.fn(() => Promise.resolve({ error: null }))` next to the existing `ctrl.auth = { getSession: … }` definition (as a second property of that object).
4. Rename the `describe`/`it` titles that say `AdminPanel` to say `Admin console`. Do not change any assertion.

- [ ] **Step 8: Run the tests**

Run: `npm test -- src/modules/admin src/modules/account/Login.test.jsx src/mainSourceOrder.test.js`
Expected: PASS for everything, including the 21 `AdminApp` tests and the unchanged assertions of the news suite. In particular the news suite's bell assertion (`getByText('2')`) now reads the top-bar alerts badge.

If `mainSourceOrder.test.js` fails, it is asserting import order in `main.jsx`: keep the `./modules/account/verifyEmailParams` import first and place the new `isAdminPath` import after the existing local imports.

- [ ] **Step 9: Build, lint and look at it**

Run: `node_modules/.bin/vite build` — expected: build succeeds.
Run: `npm run lint` — expected: no new errors in `src/modules/admin` or `src/main.jsx`.

Start the dev server and, signed out, open `/admin`, `/admin-panel` and `/business-directory`: each must end at `/login`. (Signed-in checks are done by the owner; see Task 13.)

- [ ] **Step 10: Commit**

```bash
git add apps/carefind/src/main.jsx apps/carefind/src/modules/admin apps/carefind/src/modules/account/Login.jsx apps/carefind/src/modules/account/Login.test.jsx && git commit -m "feat(carefind): route the admin console at /admin behind one gate

Every admin screen, including the agent, business hub and directory
manager pages that had no client-side check, now renders inside one
shell behind the server verify call. AdminPanel becomes a legacy
adapter driven by the URL; old addresses redirect." -- apps/carefind/src/main.jsx apps/carefind/src/modules/admin apps/carefind/src/modules/account/Login.jsx apps/carefind/src/modules/account/Login.test.jsx
```

---

### Task 6: `useUrlFilters`

**Files:**
- Create: `src/modules/admin/ui/useUrlFilters.js`
- Modify: `src/modules/admin/ui/index.js`
- Test: `src/modules/admin/ui/useUrlFilters.test.jsx`

**Interfaces:**
- Consumes: `useSearchParams` from `react-router-dom`.
- Produces: `useUrlFilters(defaults): [values, set]` where `defaults` is a **module-level constant** object of strings, `values` has the same keys (URL value or default), and `set(patch, { replace = true }?)` writes keys to the query string, removing any key whose value is `''`, `null`, `undefined` or equal to its default. Keys not in `defaults` are left untouched in the URL.

- [ ] **Step 1: Write the failing test**

`src/modules/admin/ui/useUrlFilters.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useUrlFilters } from './useUrlFilters'

const DEFAULTS = { status: 'pending', q: '', id: '' }

function Probe() {
  const [f, set] = useUrlFilters(DEFAULTS)
  const location = useLocation()
  return (
    <div>
      <span data-testid="values">{JSON.stringify(f)}</span>
      <span data-testid="url">{location.pathname}{location.search}</span>
      <button onClick={() => set({ status: 'approved' })}>approved</button>
      <button onClick={() => set({ status: 'pending' })}>pending</button>
      <button onClick={() => set({ q: 'a b&c' })}>search</button>
      <button onClick={() => set({ q: '' })}>clear</button>
      <button onClick={() => set({ id: 'r1' }, { replace: false })}>open</button>
      <button onClick={() => set({ id: null })}>close</button>
    </div>
  )
}
const renderAt = (route) => render(<MemoryRouter initialEntries={[route]}><Probe /></MemoryRouter>)
const values = () => JSON.parse(screen.getByTestId('values').textContent)
const url = () => screen.getByTestId('url').textContent

describe('useUrlFilters', () => {
  it('returns defaults when the URL has no parameters', () => {
    renderAt('/admin/x')
    expect(values()).toEqual({ status: 'pending', q: '', id: '' })
  })

  it('reads values from the URL', () => {
    renderAt('/admin/x?status=approved&q=ada&id=v9')
    expect(values()).toEqual({ status: 'approved', q: 'ada', id: 'v9' })
  })

  it('writes a value and removes it again when set back to the default', () => {
    renderAt('/admin/x')
    fireEvent.click(screen.getByText('approved'))
    expect(url()).toBe('/admin/x?status=approved')
    fireEvent.click(screen.getByText('pending'))
    expect(url()).toBe('/admin/x')
  })

  it('encodes search text and removes the key when cleared', () => {
    renderAt('/admin/x')
    fireEvent.click(screen.getByText('search'))
    expect(values().q).toBe('a b&c')
    fireEvent.click(screen.getByText('clear'))
    expect(url()).toBe('/admin/x')
  })

  it('keeps parameters it does not own', () => {
    renderAt('/admin/x?utm=1')
    fireEvent.click(screen.getByText('open'))
    expect(url()).toBe('/admin/x?utm=1&id=r1')
    fireEvent.click(screen.getByText('close'))
    expect(url()).toBe('/admin/x?utm=1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/admin/ui/useUrlFilters.test.jsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/modules/admin/ui/useUrlFilters.js`:

```js
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

// Keeps a screen's filters and open record in the query string so a view
// survives a refresh and can be shared. `defaults` must be a module-level
// constant: it is a dependency of both memoised values.
//
// Safe to use setSearchParams here because the admin console has its own,
// un-keyed router. Do not copy this into pages under the keyed public router.
export function useUrlFilters(defaults) {
  const [params, setParams] = useSearchParams()

  const values = useMemo(() => {
    const out = {}
    for (const key of Object.keys(defaults)) out[key] = params.get(key) ?? defaults[key]
    return out
  }, [params, defaults])

  const set = useCallback((patch, { replace = true } = {}) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === '' || value === defaults[key]) next.delete(key)
        else next.set(key, String(value))
      }
      return next
    }, { replace })
  }, [setParams, defaults])

  return [values, set]
}
```

Add to `src/modules/admin/ui/index.js`:

```js
export { useUrlFilters } from './useUrlFilters.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/modules/admin/ui/useUrlFilters.test.jsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/carefind/src/modules/admin/ui/useUrlFilters.js apps/carefind/src/modules/admin/ui/useUrlFilters.test.jsx apps/carefind/src/modules/admin/ui/index.js && git commit -m "feat(carefind): URL-backed filter state for admin screens" -- apps/carefind/src/modules/admin/ui/useUrlFilters.js apps/carefind/src/modules/admin/ui/useUrlFilters.test.jsx apps/carefind/src/modules/admin/ui/index.js
```

---

### Task 7: Status pill, table helpers and the detail drawer

**Files:**
- Create: `src/modules/admin/ui/StatusPill.jsx`, `src/modules/admin/ui/tableHelpers.jsx`, `src/modules/admin/ui/DetailDrawer.jsx`
- Modify: `src/modules/admin/ui/AdminPageHeader.jsx`, `src/modules/admin/ui/index.js`
- Test: `src/modules/admin/ui/blocks.test.jsx`

**Interfaces:**
- Consumes: `Pill`, `StatusBadge`, `Modal`, `DataTable` from the design system.
- Produces:
  - `<StatusPill status />`
  - `primaryCell({ title, sub, onOpen, openLabel })` → a React node: a real `<button>` showing `title` (bold) and `sub` (muted), calling `onOpen` on click
  - `selectionColumn({ rows, selectedIds: Set, onToggle(id), onToggleAll(), rowLabel(row) })` → a `DataTable` column definition
  - `<DetailDrawer open onClose title footer>{children}</DetailDrawer>`
  - `<DetailField label>{children}</DetailField>` (a label/value row for drawers)
  - `AdminPageHeader` renders its title as an `<h1>`

- [ ] **Step 1: Write the failing test**

`src/modules/admin/ui/blocks.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DataTable } from '@care-ecosystem/design-system/components/ui'
import { StatusPill } from './StatusPill.jsx'
import { primaryCell, selectionColumn } from './tableHelpers.jsx'
import { DetailDrawer, DetailField } from './DetailDrawer.jsx'
import AdminPageHeader from './AdminPageHeader.jsx'

describe('StatusPill', () => {
  it.each([
    ['approved', 'Approved'], ['rejected', 'Rejected'], ['resolved', 'Resolved'],
    ['flagged', 'Flagged'], ['pending', 'Pending'], ['reserved', 'Reserved'],
  ])('labels %s as %s', (status, label) => {
    render(<StatusPill status={status} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('falls back to the raw status, or a dash when there is none', () => {
    const { rerender } = render(<StatusPill status="weird_state" />)
    expect(screen.getByText('weird_state')).toBeInTheDocument()
    rerender(<StatusPill status={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('table helpers', () => {
  const rows = [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bayo' }]

  function Table({ onOpen }) {
    const [selected, setSelected] = useState(new Set())
    const toggle = (id) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
    const toggleAll = () => setSelected(prev => (prev.size === rows.length ? new Set() : new Set(rows.map(r => r.id))))
    const columns = [
      selectionColumn({ rows, selectedIds: selected, onToggle: toggle, onToggleAll: toggleAll, rowLabel: r => r.name }),
      { key: 'name', label: 'Name', render: r => primaryCell({ title: r.name, sub: `id ${r.id}`, onOpen: () => onOpen(r), openLabel: `Open ${r.name}` }) },
    ]
    return <><span>selected:{selected.size}</span><DataTable rows={rows} columns={columns} /></>
  }

  it('opens a record from a real button, reachable by keyboard', () => {
    const onOpen = vi.fn()
    render(<Table onOpen={onOpen} />)
    const open = screen.getByRole('button', { name: 'Open Ada' })
    expect(open.tagName).toBe('BUTTON')
    fireEvent.click(open)
    expect(onOpen).toHaveBeenCalledWith(rows[0])
    expect(screen.getByText('id a')).toBeInTheDocument()
  })

  it('selects one row, all rows, and none', () => {
    render(<Table onOpen={() => {}} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ada' }))
    expect(screen.getByText('selected:1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(screen.getByText('selected:2')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Bayo' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(screen.getByText('selected:0')).toBeInTheDocument()
  })

  it('selecting a row does not open it', () => {
    const onRowClick = vi.fn()
    const columns = [selectionColumn({ rows, selectedIds: new Set(), onToggle: () => {}, onToggleAll: () => {}, rowLabel: r => r.name })]
    render(<DataTable rows={rows} columns={columns} onRowClick={onRowClick} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ada' }))
    expect(onRowClick).not.toHaveBeenCalled()
  })
})

describe('DetailDrawer', () => {
  function Host() {
    const [open, setOpen] = useState(false)
    return (
      <div>
        <button onClick={() => setOpen(true)}>opener</button>
        <DetailDrawer open={open} onClose={() => setOpen(false)} title="Dr. Amina Bello" footer={<button>Approve</button>}>
          <DetailField label="Profession">Pharmacist</DetailField>
          <DetailField label="Workplace">{null}</DetailField>
        </DetailDrawer>
      </div>
    )
  }

  it('is closed until opened, then shows the title, fields and footer', () => {
    render(<Host />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('opener'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Dr. Amina Bello')).toBeInTheDocument()
    expect(within(dialog).getByText('Profession')).toBeInTheDocument()
    expect(within(dialog).getByText('Pharmacist')).toBeInTheDocument()
    expect(within(dialog).getByText('—')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the control that opened it', () => {
    render(<Host />)
    const opener = screen.getByText('opener')
    opener.focus()
    fireEvent.click(opener)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(opener)
  })

  it('closes from its close button', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('opener'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('AdminPageHeader', () => {
  it('renders the title as the page heading', () => {
    render(<AdminPageHeader title="Verifications" subtitle="12 pending" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Verifications' })).toBeInTheDocument()
    expect(screen.getByText('12 pending')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/admin/ui/blocks.test.jsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/modules/admin/ui/StatusPill.jsx`:

```jsx
import { Pill, StatusBadge } from '@care-ecosystem/design-system/components/ui'

// Admin statuses the shared registry does not cover. Anything else falls
// through to the shared StatusBadge, which prints the raw status or a dash.
const ADMIN_STATUS = {
  approved: { label: 'Approved', type: 'teal' },
  verified: { label: 'Verified', type: 'teal' },
  rejected: { label: 'Rejected', type: 'red' },
  resolved: { label: 'Resolved', type: 'green' },
  dismissed: { label: 'Dismissed', type: 'gray' },
  flagged: { label: 'Flagged', type: 'red' },
}

export function StatusPill({ status }) {
  const known = ADMIN_STATUS[status]
  return known ? <Pill label={known.label} type={known.type} /> : <StatusBadge status={status} />
}

export default StatusPill
```

`src/modules/admin/ui/tableHelpers.jsx`:

```jsx
import { theme } from '../../../styles/theme'

// The shared DataTable opens rows on mouse click only. Rendering the primary
// cell as a real button makes "open this record" reachable by keyboard and
// by screen readers without changing the shared component.
export function primaryCell({ title, sub, onOpen, openLabel }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen() }}
      aria-label={openLabel}
      style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: theme.fontFamily }}
    >
      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: theme.textDark }}>{title}</span>
      {sub && <span style={{ display: 'block', fontSize: 11.5, color: theme.textLight, marginTop: 2 }}>{sub}</span>}
    </button>
  )
}

const box = { width: 16, height: 16, cursor: 'pointer', accentColor: theme.tealDeep }

export function selectionColumn({ rows, selectedIds, onToggle, onToggleAll, rowLabel }) {
  const allSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.id))
  return {
    key: '__select',
    label: (
      <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={onToggleAll} onClick={(e) => e.stopPropagation()} style={box} />
    ),
    render: (row) => (
      <input
        type="checkbox"
        aria-label={`Select ${rowLabel(row)}`}
        checked={selectedIds.has(row.id)}
        onChange={() => onToggle(row.id)}
        onClick={(e) => e.stopPropagation()}
        style={box}
      />
    ),
  }
}
```

`src/modules/admin/ui/DetailDrawer.jsx`:

```jsx
import { Modal } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../styles/theme'

// One record, slid over the list. The shared Modal's drawer variant supplies
// the focus trap, Escape-to-close and focus return; it is full-width on a
// phone because it is capped at a max width, not given a fixed one.
export function DetailDrawer({ open, onClose, title, footer, children }) {
  return (
    <Modal show={open} onClose={onClose} title={title} variant="drawer" size="lg" footer={footer}>
      {children}
    </Modal>
  )
}

export function DetailField({ label, children }) {
  const empty = children == null || children === ''
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '9px 0', borderBottom: `1px solid ${theme.gray100}` }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: theme.textLight, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: theme.textDark, textAlign: 'right', overflowWrap: 'anywhere' }}>{empty ? '—' : children}</span>
    </div>
  )
}

export default DetailDrawer
```

In `src/modules/admin/ui/AdminPageHeader.jsx`, change the title element from a `<div>` to an `<h1>` (same styles plus `margin: 0`):

```jsx
        <h1 style={{ margin: 0, fontSize: theme.type.h1.size, fontWeight: theme.type.h1.weight, color: theme.textDark, lineHeight: theme.type.h1.lineHeight }}>{title}</h1>
```

Add to `src/modules/admin/ui/index.js`:

```js
export { StatusPill } from './StatusPill.jsx'
export { primaryCell, selectionColumn } from './tableHelpers.jsx'
export { DetailDrawer, DetailField } from './DetailDrawer.jsx'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/modules/admin/ui`
Expected: PASS. If the `selectionColumn` header test fails because the shared `DataTable` stringifies a non-string `label` somewhere, change nothing in the shared package: give the column `label: 'Select'` and render the select-all checkbox in the screen's filter bar instead, then update the test's "Select all" lookup accordingly and record the change in the commit message.

- [ ] **Step 5: Commit**

```bash
git add apps/carefind/src/modules/admin/ui && git commit -m "feat(carefind): admin status pill, table helpers and detail drawer" -- apps/carefind/src/modules/admin/ui
```

---

### Task 8: Verifications screen

**Files:**
- Create: `src/modules/admin/screens/moderation/VerificationsScreen.jsx`
- Modify: `src/modules/admin/AdminApp.jsx` (`SCREEN_COMPONENTS`), `src/modules/admin/legacy/LegacyScreens.jsx`
- Delete: `src/modules/admin/tabs/VerificationsTab.jsx`
- Test: `src/modules/admin/screens/moderation/VerificationsScreen.test.jsx`

**Interfaces:**
- Consumes: `useQueue('verifications')` (rows: `{ id, user_id, full_name, profession, workplace, phone, status, credential_url, created_at }`); `callAdminAuth('approve_verification', { id, userId, profession })`, `callAdminAuth('reject_verification', { id })`, `callAdminAuth('credential_url', { requestId })` → `{ url }`; Tasks 3, 6, 7.
- Produces: default export `VerificationsScreen` (no props).

- [ ] **Step 1: Write the failing test**

`src/modules/admin/screens/moderation/VerificationsScreen.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'

const { callAdminAuth } = vi.hoisted(() => ({ callAdminAuth: vi.fn() }))
vi.mock('../../adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))

import { renderAdmin } from '../../test/renderAdmin.jsx'
import VerificationsScreen from './VerificationsScreen.jsx'

const now = Date.now()
const rows = [
  { id: 'v1', user_id: 'u1', full_name: 'Amina Bello', profession: 'Pharmacist', workplace: 'MedPlus', phone: '0801', status: 'pending', credential_url: 'creds/v1.pdf', created_at: new Date(now - 2 * 86400000).toISOString() },
  { id: 'v2', user_id: 'u2', full_name: 'Tunde Afolabi', profession: 'Doctor', workplace: null, phone: null, status: 'pending', credential_url: null, created_at: new Date(now - 3600000).toISOString() },
  { id: 'v3', user_id: 'u3', full_name: 'Ngozi Eze', profession: 'Nurse', status: 'approved', created_at: new Date(now - 9 * 86400000).toISOString() },
  { id: 'v4', user_id: 'u4', full_name: null, profession: null, status: 'pending', created_at: null },
]

function mockApi(overrides = {}) {
  callAdminAuth.mockImplementation(async (action, payload) => {
    if (overrides[action]) return overrides[action](payload)
    if (action === 'list_verification_requests') return { data: rows }
    return {}
  })
}
const calls = (action) => callAdminAuth.mock.calls.filter(c => c[0] === action)
const at = (route) => renderAdmin(<VerificationsScreen />, { route })

describe('VerificationsScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); mockApi() })

  it('lists pending requests by default and shows the counts', async () => {
    at('/admin/moderation/verifications')
    expect(await screen.findByRole('button', { name: 'Open Amina Bello' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Tunde Afolabi' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Ngozi Eze' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Verifications' })).toBeInTheDocument()
    expect(screen.getByText('3 pending · 4 total')).toBeInTheDocument()
  })

  it('renders a row with no name, profession or date without failing', async () => {
    at('/admin/moderation/verifications')
    expect(await screen.findByRole('button', { name: 'Open Unnamed applicant' })).toBeInTheDocument()
  })

  it('filters by status from the URL and by search text', async () => {
    at('/admin/moderation/verifications?status=approved')
    expect(await screen.findByRole('button', { name: 'Open Ngozi Eze' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Amina Bello' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^All/ }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'doctor' } })
    expect(await screen.findByRole('button', { name: 'Open Tunde Afolabi' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Ngozi Eze' })).not.toBeInTheDocument()
  })

  it('says so when nothing matches', async () => {
    at('/admin/moderation/verifications?q=zzzz')
    expect(await screen.findByText('No verification requests match these filters')).toBeInTheDocument()
  })

  it('shows an error with retry when the list fails, not an empty list', async () => {
    let fail = true
    mockApi({ list_verification_requests: async () => { if (fail) throw new Error('down'); return { data: rows } } })
    at('/admin/moderation/verifications')
    const retry = await screen.findByRole('button', { name: /try again|retry/i })
    expect(screen.queryByText('No verification requests match these filters')).not.toBeInTheDocument()
    fail = false
    fireEvent.click(retry)
    expect(await screen.findByRole('button', { name: 'Open Amina Bello' })).toBeInTheDocument()
  })

  it('opens a record in the drawer from the list and from a link', async () => {
    at('/admin/moderation/verifications?id=v2')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Tunde Afolabi')).toBeInTheDocument()
    expect(within(dialog).getByText('Doctor')).toBeInTheDocument()
  })

  it('says the record could not be found when a linked id is not in the list', async () => {
    at('/admin/moderation/verifications?id=gone')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('This request could not be found. It may already have been handled.')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('approves once even on a double click, logs it, and closes the drawer', async () => {
    let release
    mockApi({ approve_verification: () => new Promise(r => { release = () => r({}) }) })
    at('/admin/moderation/verifications?id=v1')
    const approve = await screen.findByRole('button', { name: 'Approve' })
    fireEvent.click(approve)
    fireEvent.click(approve)
    await waitFor(() => expect(calls('approve_verification')).toHaveLength(1))
    expect(calls('approve_verification')[0][1]).toEqual({ id: 'v1', userId: 'u1', profession: 'Pharmacist' })
    release()
    expect(await screen.findByText('Verification approved')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls('log_audit_action')[0][1]).toMatchObject({ auditAction: 'approve', targetType: 'verification', targetId: 'v1' })
  })

  it('rejects a request', async () => {
    at('/admin/moderation/verifications?id=v2')
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(calls('reject_verification')[0][1]).toEqual({ id: 'v2' }))
    expect(await screen.findByText('Verification rejected')).toBeInTheDocument()
  })

  it('keeps the drawer open and explains when an action fails', async () => {
    mockApi({ approve_verification: async () => { throw new Error('server said no') } })
    at('/admin/moderation/verifications?id=v1')
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByText("Couldn't approve the verification: server said no")).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('offers no actions on a request that is already decided', async () => {
    at('/admin/moderation/verifications?status=approved&id=v3')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(within(dialog).getByText('Approved')).toBeInTheDocument()
  })

  it('opens the credential in a tab opened during the click', async () => {
    const tab = { location: '', close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab)
    mockApi({ credential_url: async () => ({ url: 'https://signed.example/doc' }) })
    at('/admin/moderation/verifications?id=v1')
    fireEvent.click(await screen.findByRole('button', { name: /View credential/ }))
    expect(open).toHaveBeenCalledWith('', '_blank', 'noopener,noreferrer')
    await waitFor(() => expect(tab.location).toBe('https://signed.example/doc'))
    expect(calls('credential_url')[0][1]).toEqual({ requestId: 'v1' })
    open.mockRestore()
  })

  it('explains when the browser blocks the credential window', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    mockApi({ credential_url: async () => ({ url: 'https://signed.example/doc' }) })
    at('/admin/moderation/verifications?id=v1')
    fireEvent.click(await screen.findByRole('button', { name: /View credential/ }))
    expect(await screen.findByText(/blocked the document window/)).toBeInTheDocument()
    open.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/admin/screens/moderation/VerificationsScreen.test.jsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the screen**

`src/modules/admin/screens/moderation/VerificationsScreen.jsx`:

```jsx
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, XCircle, FileText, ExternalLink, UserCheck } from 'lucide-react'
import { Button, DataTable, Empty, FilterBar, SearchBar } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../../styles/theme'
import { callAdminAuth } from '../../adminApi'
import { useQueue } from '../../data/queues'
import { useAdminToast, useAdminActivity, useAuditLog } from '../../AdminFeedback.jsx'
import AdminPageHeader from '../../ui/AdminPageHeader.jsx'
import { FilterPills } from '../../ui/FilterPills.jsx'
import { timeAgo } from '../../ui/adminHelpers.js'
import { useUrlFilters } from '../../ui/useUrlFilters.js'
import { DetailDrawer, DetailField } from '../../ui/DetailDrawer.jsx'
import { StatusPill } from '../../ui/StatusPill.jsx'
import { primaryCell } from '../../ui/tableHelpers.jsx'

const DEFAULTS = { status: 'pending', q: '', id: '' }
const nameOf = (v) => v.full_name || 'Unnamed applicant'

export default function VerificationsScreen() {
  const { data: rows = [], isLoading, error, refetch } = useQueue('verifications')
  const [f, setF] = useUrlFilters(DEFAULTS)
  const qc = useQueryClient()
  const showToast = useAdminToast()
  const { recordAction } = useAdminActivity()
  const audit = useAuditLog()
  const [busy, setBusy] = useState(null) // 'approve' | 'reject' | 'credential' | null
  const [credentialError, setCredentialError] = useState('')

  const counts = useMemo(() => ({
    all: rows.length,
    pending: rows.filter(r => r.status === 'pending').length,
    approved: rows.filter(r => r.status === 'approved').length,
    rejected: rows.filter(r => r.status === 'rejected').length,
  }), [rows])

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    return rows.filter(r => {
      if (f.status !== 'all' && r.status !== f.status) return false
      if (!q) return true
      return [r.full_name, r.profession, r.workplace, r.phone].some(v => (v || '').toLowerCase().includes(q))
    })
  }, [rows, f.status, f.q])

  const selected = f.id ? rows.find(r => String(r.id) === f.id) : null
  const open = (row) => { setCredentialError(''); setF({ id: row.id }, { replace: false }) }
  const close = () => { setCredentialError(''); setF({ id: null }) }

  async function decide(kind) {
    if (busy || !selected) return
    setBusy(kind)
    const verb = kind === 'approve' ? 'approve' : 'reject'
    try {
      if (kind === 'approve') {
        await callAdminAuth('approve_verification', { id: selected.id, userId: selected.user_id, profession: selected.profession })
        audit('approve', 'verification', selected.id, { userId: selected.user_id, profession: selected.profession })
      } else {
        await callAdminAuth('reject_verification', { id: selected.id })
        audit('reject', 'verification', selected.id, {})
      }
      recordAction({ action: verb, target: 'verification', id: selected.id })
      showToast(kind === 'approve' ? 'Verification approved' : 'Verification rejected', { type: 'success' })
      close()
      qc.invalidateQueries({ queryKey: ['admin'] })
    } catch (err) {
      showToast(`Couldn't ${verb} the verification: ${err.message}`, { type: 'error' })
    } finally {
      setBusy(null)
    }
  }

  // The tab is opened synchronously, inside the click's user-activation
  // window, and pointed at the signed URL once it arrives. Calling
  // window.open() after the await is blocked by Chrome and Safari.
  async function openCredential() {
    if (busy || !selected) return
    setBusy('credential')
    setCredentialError('')
    const tab = window.open('', '_blank', 'noopener,noreferrer')
    try {
      const { url } = await callAdminAuth('credential_url', { requestId: selected.id })
      if (tab) tab.location = url
      else setCredentialError('Your browser blocked the document window. Allow popups for this site and try again.')
    } catch (err) {
      if (tab) tab.close()
      setCredentialError(`Could not open the document: ${err.message}`)
    } finally {
      setBusy(null)
    }
  }

  const columns = [
    { key: 'full_name', label: 'Applicant', sortable: true, sortValue: r => nameOf(r).toLowerCase(), render: r => primaryCell({ title: nameOf(r), sub: r.phone, onOpen: () => open(r), openLabel: `Open ${nameOf(r)}` }) },
    { key: 'profession', label: 'Profession', sortable: true, render: r => r.profession || '—' },
    { key: 'workplace', label: 'Workplace', render: r => r.workplace || '—' },
    { key: 'created_at', label: 'Submitted', sortable: true, sortValue: r => r.created_at || '', render: r => (r.created_at ? timeAgo(r.created_at) : '—') },
    { key: 'status', label: 'Status', render: r => <StatusPill status={r.status} /> },
  ]

  return (
    <div>
      <AdminPageHeader title="Verifications" subtitle={`${counts.pending} pending · ${counts.all} total`} />

      <FilterBar label="Verification filters" style={{ marginBottom: theme.space[8] }}>
        <SearchBar label="Search verifications" value={f.q} onChange={(q) => setF({ q })} placeholder="Search name, profession, workplace…" />
        <FilterPills
          value={f.status}
          onChange={(status) => setF({ status })}
          options={[
            { value: 'pending', label: `Pending ${counts.pending}` },
            { value: 'approved', label: `Approved ${counts.approved}` },
            { value: 'rejected', label: `Rejected ${counts.rejected}` },
            { value: 'all', label: `All ${counts.all}` },
          ]}
        />
      </FilterBar>

      <DataTable
        rows={filtered}
        columns={columns}
        onRowClick={open}
        loading={isLoading}
        error={error ? 'The verification requests could not be loaded.' : null}
        onRetry={refetch}
        empty={<Empty icon={<UserCheck size={40} strokeWidth={1.5} color={theme.gray300} />} message="No verification requests match these filters" />}
      />

      <DetailDrawer
        open={!!f.id && !isLoading}
        onClose={close}
        title={selected ? nameOf(selected) : 'Verification request'}
        footer={selected?.status === 'pending' ? (
          <>
            <Button variant="danger" fullWidth leftIcon={<XCircle size={14} />} onClick={() => decide('reject')} disabled={!!busy} loading={busy === 'reject'}>Reject</Button>
            <Button variant="primary" fullWidth leftIcon={<CheckCircle size={14} />} onClick={() => decide('approve')} disabled={!!busy} loading={busy === 'approve'}>Approve</Button>
          </>
        ) : null}
      >
        {!selected ? (
          <p style={{ margin: 0, fontSize: 13, color: theme.textMid }}>This request could not be found. It may already have been handled.</p>
        ) : (
          <div>
            <DetailField label="Status"><StatusPill status={selected.status} /></DetailField>
            <DetailField label="Profession">{selected.profession}</DetailField>
            <DetailField label="Workplace">{selected.workplace}</DetailField>
            <DetailField label="Phone">{selected.phone}</DetailField>
            <DetailField label="Submitted">{selected.created_at ? new Date(selected.created_at).toLocaleString() : null}</DetailField>
            <div style={{ marginTop: theme.space[8] }}>
              {selected.credential_url ? (
                <Button variant="ghost" size="sm" leftIcon={<FileText size={14} />} rightIcon={<ExternalLink size={12} />} onClick={openCredential} disabled={!!busy} loading={busy === 'credential'} loadingText="Opening…">
                  View credential
                </Button>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>No credential document was uploaded.</p>
              )}
              {credentialError && (
                <p role="alert" style={{ margin: `${theme.space[4]}px 0 0`, padding: theme.space[4], background: theme.dangerBg, color: theme.danger, borderRadius: theme.radius.sm, fontSize: 12 }}>
                  {credentialError}
                </p>
              )}
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  )
}
```

Check two shared-component facts before running the tests, and adjust only the screen if they differ:
- `Button` in `packages/design-system/src/components/ui/Button.jsx`: confirm it accepts `disabled`, `loading`, `loadingText`, `leftIcon`, `rightIcon`, `fullWidth`. `VerificationsTab.jsx` (deleted below) already used all but `disabled`.
- `theme.space[n]` is used elsewhere both as a number and inside template strings; if it is a string with units, drop the `px` in the `margin` template above.

- [ ] **Step 4: Route it and remove the legacy tab**

In `src/modules/admin/AdminApp.jsx`, add to `SCREEN_COMPONENTS`:

```jsx
  verifications: lazy(() => import('./screens/moderation/VerificationsScreen.jsx')),
```

In `src/modules/admin/legacy/LegacyScreens.jsx` delete: the `VerificationsTab` import; the `{tab === 'verifications' && …}` line; the functions `openCredential`, `approveVerif`, `rejectVerif`; and the state `credentialLoadingId`, `credentialError` with its comment. Keep the `verifications` value read from `adminData` (the legacy queue and dashboard tabs still use it).

```bash
git rm apps/carefind/src/modules/admin/tabs/VerificationsTab.jsx
grep -n "VerificationsTab\|approveVerif\|rejectVerif\|openCredential\|credentialError\|credentialLoadingId" -r apps/carefind/src
```

Expected: the `grep` prints nothing.

- [ ] **Step 5: Run tests**

Run: `npm test -- src/modules/admin`
Expected: PASS, including 13 new tests. Then `node_modules/.bin/vite build` succeeds.

- [ ] **Step 6: Measure the layout**

With the dev server running and the screen open, record at widths 375, 768 and 1280 that `document.documentElement.scrollWidth === window.innerWidth`, with and without the drawer open. This needs a signed-in admin session, which the implementer does not have and must not create (no temporary unguarded route, no entering credentials). If no signed-in session is available, state in the commit message that layout verification for this screen is pending the owner's walkthrough.

- [ ] **Step 7: Commit**

```bash
git add apps/carefind/src/modules/admin && git commit -m "feat(carefind): verifications as a table with a review drawer" -- apps/carefind/src/modules/admin
```

---

### Task 9: Reports screen

**Files:**
- Create: `src/modules/admin/screens/moderation/ReportsScreen.jsx`
- Modify: `src/modules/admin/AdminApp.jsx`, `src/modules/admin/legacy/LegacyScreens.jsx`
- Delete: `src/modules/admin/tabs/ReportsTab.jsx`
- Test: `src/modules/admin/screens/moderation/ReportsScreen.test.jsx`

**Interfaces:**
- Consumes: `useQueue('reports')` (rows: `{ id, post_id, reason, status, created_at, posts: { content } | null }`; the API returns at most the 30 newest); `callAdminAuth('resolve_report', { id })`, `callAdminAuth('delete_post', { id: post_id })`; `useAdminConfirm`.
- Produces: default export `ReportsScreen`.

- [ ] **Step 1: Write the failing test**

`src/modules/admin/screens/moderation/ReportsScreen.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'

const { callAdminAuth } = vi.hoisted(() => ({ callAdminAuth: vi.fn() }))
vi.mock('../../adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))

import { renderAdmin } from '../../test/renderAdmin.jsx'
import ReportsScreen from './ReportsScreen.jsx'

const long = 'x'.repeat(300)
const rows = [
  { id: 'r1', post_id: 'p1', reason: 'Misinformation', status: 'pending', created_at: new Date().toISOString(), posts: { content: 'Garlic cures malaria' } },
  { id: 'r2', post_id: 'p2', reason: 'Spam', status: 'pending', created_at: new Date().toISOString(), posts: null },
  { id: 'r3', post_id: 'p3', reason: 'Abuse', status: 'resolved', created_at: new Date().toISOString(), posts: { content: long } },
  { id: 'r4', post_id: null, reason: null, status: 'pending', created_at: null, posts: null },
]

function mockApi(overrides = {}) {
  callAdminAuth.mockImplementation(async (action, payload) => {
    if (overrides[action]) return overrides[action](payload)
    if (action === 'list_reports') return { data: rows }
    return {}
  })
}
const calls = (action) => callAdminAuth.mock.calls.filter(c => c[0] === action)
const at = (route) => renderAdmin(<ReportsScreen />, { route })

describe('ReportsScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); mockApi() })

  it('lists pending reports by default with the post excerpt', async () => {
    at('/admin/moderation/reports')
    expect(await screen.findByRole('button', { name: 'Open report: Misinformation' })).toBeInTheDocument()
    expect(screen.getByText('Garlic cures malaria')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open report: Abuse' })).not.toBeInTheDocument()
    expect(screen.getByText('3 pending · 4 loaded')).toBeInTheDocument()
  })

  it('renders reports whose post was deleted or that have no reason', async () => {
    at('/admin/moderation/reports')
    expect(await screen.findByRole('button', { name: 'Open report: Spam' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open report: No reason given' })).toBeInTheDocument()
    expect(screen.getAllByText('Post no longer available').length).toBeGreaterThan(0)
  })

  it('shows the whole post in the drawer', async () => {
    at('/admin/moderation/reports?status=resolved&id=r3')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(long)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Dismiss report' })).not.toBeInTheDocument()
  })

  it('dismisses a report', async () => {
    at('/admin/moderation/reports?id=r1')
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss report' }))
    await waitFor(() => expect(calls('resolve_report')[0][1]).toEqual({ id: 'r1' }))
    expect(await screen.findByText('Report dismissed')).toBeInTheDocument()
    expect(calls('log_audit_action')[0][1]).toMatchObject({ auditAction: 'resolve', targetType: 'report', targetId: 'r1' })
    await waitFor(() => expect(screen.queryByText('Garlic cures malaria', { selector: 'p' })).not.toBeInTheDocument())
  })

  it('deletes the post only after the consequence is confirmed', async () => {
    at('/admin/moderation/reports?id=r1')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete post' }))
    expect(await screen.findByText('Delete this post?')).toBeInTheDocument()
    expect(screen.getByText('This permanently deletes the post along with its likes and comments. This cannot be undone.')).toBeInTheDocument()
    expect(calls('delete_post')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls('delete_post')[0][1]).toEqual({ id: 'p1' }))
    expect(await screen.findByText('Post deleted')).toBeInTheDocument()
  })

  it('does not offer to delete a post that no longer exists', async () => {
    at('/admin/moderation/reports?id=r4')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Delete post' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Dismiss report' })).toBeInTheDocument()
  })

  it('explains a failed action and leaves the drawer open', async () => {
    mockApi({ resolve_report: async () => { throw new Error('nope') } })
    at('/admin/moderation/reports?id=r1')
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss report' }))
    expect(await screen.findByText("Couldn't dismiss the report: nope")).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows an error with retry when the list fails', async () => {
    mockApi({ list_reports: async () => { throw new Error('down') } })
    at('/admin/moderation/reports')
    expect(await screen.findByRole('button', { name: /try again|retry/i })).toBeInTheDocument()
  })

  it('says the report could not be found for an unknown id', async () => {
    at('/admin/moderation/reports?id=zzz')
    expect(await screen.findByText('This report could not be found. It may already have been handled, or it is older than the 30 most recent reports.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/admin/screens/moderation/ReportsScreen.test.jsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the screen**

`src/modules/admin/screens/moderation/ReportsScreen.jsx`:

```jsx
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Flag, Trash2 } from 'lucide-react'
import { Button, DataTable, Empty, FilterBar, SearchBar } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../../styles/theme'
import { callAdminAuth } from '../../adminApi'
import { useQueue } from '../../data/queues'
import { useAdminToast, useAdminConfirm, useAdminActivity, useAuditLog } from '../../AdminFeedback.jsx'
import AdminPageHeader from '../../ui/AdminPageHeader.jsx'
import { FilterPills } from '../../ui/FilterPills.jsx'
import { timeAgo } from '../../ui/adminHelpers.js'
import { useUrlFilters } from '../../ui/useUrlFilters.js'
import { DetailDrawer, DetailField } from '../../ui/DetailDrawer.jsx'
import { StatusPill } from '../../ui/StatusPill.jsx'
import { primaryCell } from '../../ui/tableHelpers.jsx'

const DEFAULTS = { status: 'pending', q: '', id: '' }
const reasonOf = (r) => r.reason || 'No reason given'
const NO_POST = 'Post no longer available'
const excerpt = (r) => {
  const text = r.posts?.content
  if (!text) return NO_POST
  return text.length > 90 ? `${text.slice(0, 90)}…` : text
}

export default function ReportsScreen() {
  const { data: rows = [], isLoading, error, refetch } = useQueue('reports')
  const [f, setF] = useUrlFilters(DEFAULTS)
  const qc = useQueryClient()
  const showToast = useAdminToast()
  const askConfirm = useAdminConfirm()
  const { recordAction } = useAdminActivity()
  const audit = useAuditLog()
  const [busy, setBusy] = useState(null) // 'dismiss' | 'delete' | null

  const counts = useMemo(() => ({
    all: rows.length,
    pending: rows.filter(r => r.status === 'pending').length,
    resolved: rows.filter(r => r.status !== 'pending').length,
  }), [rows])

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    return rows.filter(r => {
      if (f.status === 'pending' && r.status !== 'pending') return false
      if (f.status === 'resolved' && r.status === 'pending') return false
      if (!q) return true
      return [r.reason, r.posts?.content].some(v => (v || '').toLowerCase().includes(q))
    })
  }, [rows, f.status, f.q])

  const selected = f.id ? rows.find(r => String(r.id) === f.id) : null
  const open = (row) => setF({ id: row.id }, { replace: false })
  const close = () => setF({ id: null })
  const done = () => { close(); qc.invalidateQueries({ queryKey: ['admin'] }) }

  async function dismiss() {
    if (busy || !selected) return
    setBusy('dismiss')
    try {
      await callAdminAuth('resolve_report', { id: selected.id })
      audit('resolve', 'report', selected.id, {})
      recordAction({ action: 'approve', target: 'report', id: selected.id })
      showToast('Report dismissed', { type: 'success' })
      done()
    } catch (err) {
      showToast(`Couldn't dismiss the report: ${err.message}`, { type: 'error' })
    } finally {
      setBusy(null)
    }
  }

  function deletePost() {
    if (busy || !selected?.post_id) return
    const report = selected
    askConfirm({
      title: 'Delete this post?',
      consequence: 'This permanently deletes the post along with its likes and comments. This cannot be undone.',
      confirmLabel: 'Delete',
      action: async () => {
        setBusy('delete')
        try {
          await callAdminAuth('delete_post', { id: report.post_id })
          audit('delete', 'post', report.post_id, { reportId: report.id })
          recordAction({ action: 'reject', target: 'post', id: report.post_id })
          showToast('Post deleted', { type: 'success' })
          done()
        } catch (err) {
          showToast(`Couldn't delete the post: ${err.message}`, { type: 'error' })
        } finally {
          setBusy(null)
        }
      },
    })
  }

  const columns = [
    { key: 'reason', label: 'Reason', sortable: true, sortValue: r => reasonOf(r).toLowerCase(), render: r => primaryCell({ title: reasonOf(r), onOpen: () => open(r), openLabel: `Open report: ${reasonOf(r)}` }) },
    { key: 'post', label: 'Reported post', render: r => <span style={{ fontSize: 13, color: r.posts?.content ? theme.textMid : theme.textLight }}>{excerpt(r)}</span> },
    { key: 'created_at', label: 'Reported', sortable: true, sortValue: r => r.created_at || '', render: r => (r.created_at ? timeAgo(r.created_at) : '—') },
    { key: 'status', label: 'Status', render: r => <StatusPill status={r.status} /> },
  ]

  const pending = selected?.status === 'pending'

  return (
    <div>
      <AdminPageHeader title="Reports" subtitle={`${counts.pending} pending · ${counts.all} loaded`} />

      <FilterBar label="Report filters" style={{ marginBottom: theme.space[8] }}>
        <SearchBar label="Search reports" value={f.q} onChange={(q) => setF({ q })} placeholder="Search reason or post text…" />
        <FilterPills
          value={f.status}
          onChange={(status) => setF({ status })}
          options={[
            { value: 'pending', label: `Pending ${counts.pending}` },
            { value: 'resolved', label: `Handled ${counts.resolved}` },
            { value: 'all', label: `All ${counts.all}` },
          ]}
        />
      </FilterBar>

      <DataTable
        rows={filtered}
        columns={columns}
        onRowClick={open}
        loading={isLoading}
        error={error ? 'The reports could not be loaded.' : null}
        onRetry={refetch}
        empty={<Empty icon={<Flag size={40} strokeWidth={1.5} color={theme.gray300} />} message="No reports match these filters" />}
      />

      <DetailDrawer
        open={!!f.id && !isLoading}
        onClose={close}
        title={selected ? reasonOf(selected) : 'Report'}
        footer={pending ? (
          <>
            {selected.post_id && (
              <Button variant="danger" fullWidth leftIcon={<Trash2 size={14} />} onClick={deletePost} disabled={!!busy} loading={busy === 'delete'}>Delete post</Button>
            )}
            <Button variant="ghost" fullWidth leftIcon={<CheckCircle size={14} />} onClick={dismiss} disabled={!!busy} loading={busy === 'dismiss'}>Dismiss report</Button>
          </>
        ) : null}
      >
        {!selected ? (
          <p style={{ margin: 0, fontSize: 13, color: theme.textMid }}>This report could not be found. It may already have been handled, or it is older than the 30 most recent reports.</p>
        ) : (
          <div>
            <DetailField label="Status"><StatusPill status={selected.status} /></DetailField>
            <DetailField label="Reported">{selected.created_at ? new Date(selected.created_at).toLocaleString() : null}</DetailField>
            <div style={{ marginTop: theme.space[8], fontSize: 12, fontWeight: 700, color: theme.textLight }}>Reported post</div>
            <p style={{ margin: `${theme.space[3]}px 0 0`, padding: theme.space[6], background: theme.bg, borderRadius: theme.radius.md, fontSize: 13.5, lineHeight: 1.55, color: selected.posts?.content ? theme.textDark : theme.textLight, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {selected.posts?.content || NO_POST}
            </p>
          </div>
        )}
      </DetailDrawer>
    </div>
  )
}
```

- [ ] **Step 4: Route it and remove the legacy tab**

Add to `SCREEN_COMPONENTS` in `AdminApp.jsx`:

```jsx
  reports: lazy(() => import('./screens/moderation/ReportsScreen.jsx')),
```

In `legacy/LegacyScreens.jsx` delete: the `ReportsTab` import, the `{tab === 'reports' && …}` line, the `resolveReport` function, and the unused `reportStatusFilter` state. Keep `deletePost`/`reallyDeletePost` (the legacy Posts tab uses them).

```bash
git rm apps/carefind/src/modules/admin/tabs/ReportsTab.jsx
grep -n "ReportsTab\|resolveReport\|reportStatusFilter" -r apps/carefind/src
```

Expected: no output.

- [ ] **Step 5: Run tests and build**

Run: `npm test -- src/modules/admin` — expected: PASS, 9 new tests.
Run: `node_modules/.bin/vite build` — expected: success.
Measure at 375, 768 and 1280px as in Task 8 Step 6.

- [ ] **Step 6: Commit**

```bash
git add apps/carefind/src/modules/admin && git commit -m "feat(carefind): reports as a table with a review drawer" -- apps/carefind/src/modules/admin
```

---

### Task 10: Claims screen

**Files:**
- Create: `src/modules/admin/screens/moderation/ClaimsScreen.jsx`
- Modify: `src/modules/admin/AdminApp.jsx`, `src/modules/admin/legacy/LegacyScreens.jsx`
- Delete: `src/modules/admin/tabs/ClaimsTab.jsx`
- Test: `src/modules/admin/screens/moderation/ClaimsScreen.test.jsx`

**Interfaces:**
- Consumes: `useQueue('claims')` (rows are `business_claims.*` plus `businesses: { name } | null`; fields this screen relies on: `id`, `business_id`, `status`, `created_at`); `callAdminAuth('approve_claim', { claimId, businessId })`, `callAdminAuth('reject_claim', { claimId })`.
- Produces: default export `ClaimsScreen`.

- [ ] **Step 1: Write the failing test**

`src/modules/admin/screens/moderation/ClaimsScreen.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'

const { callAdminAuth } = vi.hoisted(() => ({ callAdminAuth: vi.fn() }))
vi.mock('../../adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))

import { renderAdmin } from '../../test/renderAdmin.jsx'
import ClaimsScreen from './ClaimsScreen.jsx'

const rows = [
  { id: 'c1', business_id: 'b1', status: 'pending', created_at: new Date().toISOString(), businesses: { name: 'MedPlus Ikeja' }, claimant_name: 'Chidi Okafor', role_at_business: 'Owner' },
  { id: 'c2', business_id: 'b2', status: 'approved', created_at: new Date().toISOString(), businesses: { name: 'HealthPlus Lekki' } },
  { id: 'c3', business_id: 'b3', status: 'pending', created_at: null, businesses: null },
]

function mockApi(overrides = {}) {
  callAdminAuth.mockImplementation(async (action, payload) => {
    if (overrides[action]) return overrides[action](payload)
    if (action === 'list_business_claims') return { data: rows }
    return {}
  })
}
const calls = (action) => callAdminAuth.mock.calls.filter(c => c[0] === action)
const at = (route) => renderAdmin(<ClaimsScreen />, { route })

describe('ClaimsScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); mockApi() })

  it('lists pending claims by default, including one whose business is missing', async () => {
    at('/admin/moderation/claims')
    expect(await screen.findByRole('button', { name: 'Open claim for MedPlus Ikeja' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open claim for Unknown business' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open claim for HealthPlus Lekki' })).not.toBeInTheDocument()
    expect(screen.getByText('2 pending · 3 total')).toBeInTheDocument()
  })

  it('shows every other field the claim carries in the drawer', async () => {
    at('/admin/moderation/claims?id=c1')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Claimant name')).toBeInTheDocument()
    expect(within(dialog).getByText('Chidi Okafor')).toBeInTheDocument()
    expect(within(dialog).getByText('Role at business')).toBeInTheDocument()
    expect(within(dialog).queryByText('Business id')).not.toBeInTheDocument()
  })

  it('approves a claim once and closes the drawer', async () => {
    at('/admin/moderation/claims?id=c1')
    const approve = await screen.findByRole('button', { name: 'Approve' })
    fireEvent.click(approve)
    fireEvent.click(approve)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls('approve_claim')).toHaveLength(1)
    expect(calls('approve_claim')[0][1]).toEqual({ claimId: 'c1', businessId: 'b1' })
    expect(await screen.findByText('Claim approved')).toBeInTheDocument()
    expect(calls('log_audit_action')[0][1]).toMatchObject({ auditAction: 'approve', targetType: 'claim', targetId: 'c1' })
  })

  it('rejects a claim', async () => {
    at('/admin/moderation/claims?id=c3')
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(calls('reject_claim')[0][1]).toEqual({ claimId: 'c3' }))
    expect(await screen.findByText('Claim rejected')).toBeInTheDocument()
  })

  it('explains a failed action and leaves the drawer open', async () => {
    mockApi({ approve_claim: async () => { throw new Error('already owned') } })
    at('/admin/moderation/claims?id=c1')
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByText("Couldn't approve the claim: already owned")).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('offers no actions on a decided claim, and handles an unknown id', async () => {
    at('/admin/moderation/claims?status=all&id=c2')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('shows an error with retry when the list fails, and a clear empty state', async () => {
    mockApi({ list_business_claims: async () => { throw new Error('down') } })
    at('/admin/moderation/claims')
    expect(await screen.findByRole('button', { name: /try again|retry/i })).toBeInTheDocument()
  })

  it('says the claim could not be found for an unknown id', async () => {
    at('/admin/moderation/claims?id=zzz')
    expect(await screen.findByText('This claim could not be found. It may already have been handled.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/admin/screens/moderation/ClaimsScreen.test.jsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the screen**

`src/modules/admin/screens/moderation/ClaimsScreen.jsx`:

```jsx
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, XCircle, Shield } from 'lucide-react'
import { Button, DataTable, Empty, FilterBar, SearchBar } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../../styles/theme'
import { callAdminAuth } from '../../adminApi'
import { useQueue } from '../../data/queues'
import { useAdminToast, useAdminActivity, useAuditLog } from '../../AdminFeedback.jsx'
import AdminPageHeader from '../../ui/AdminPageHeader.jsx'
import { FilterPills } from '../../ui/FilterPills.jsx'
import { timeAgo } from '../../ui/adminHelpers.js'
import { useUrlFilters } from '../../ui/useUrlFilters.js'
import { DetailDrawer, DetailField } from '../../ui/DetailDrawer.jsx'
import { StatusPill } from '../../ui/StatusPill.jsx'
import { primaryCell } from '../../ui/tableHelpers.jsx'

const DEFAULTS = { status: 'pending', q: '', id: '' }
const businessOf = (c) => c.businesses?.name || 'Unknown business'

// The claim row is `business_claims.*`; its columns beyond these are shown
// generically so the reviewer sees whatever evidence the claimant supplied.
const HIDDEN = new Set(['id', 'business_id', 'user_id', 'status', 'created_at', 'updated_at', 'businesses'])
const labelFor = (key) => { const s = key.replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1) }
const extraFields = (claim) => Object.entries(claim)
  .filter(([key, value]) => !HIDDEN.has(key) && value != null && value !== '' && typeof value !== 'object')
  .map(([key, value]) => ({ key, label: labelFor(key), value: String(value) }))

export default function ClaimsScreen() {
  const { data: rows = [], isLoading, error, refetch } = useQueue('claims')
  const [f, setF] = useUrlFilters(DEFAULTS)
  const qc = useQueryClient()
  const showToast = useAdminToast()
  const { recordAction } = useAdminActivity()
  const audit = useAuditLog()
  const [busy, setBusy] = useState(null)

  const counts = useMemo(() => ({
    all: rows.length,
    pending: rows.filter(r => r.status === 'pending').length,
    approved: rows.filter(r => r.status === 'approved').length,
    rejected: rows.filter(r => r.status === 'rejected').length,
  }), [rows])

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    return rows.filter(r => {
      if (f.status !== 'all' && r.status !== f.status) return false
      return !q || businessOf(r).toLowerCase().includes(q)
    })
  }, [rows, f.status, f.q])

  const selected = f.id ? rows.find(r => String(r.id) === f.id) : null
  const open = (row) => setF({ id: row.id }, { replace: false })
  const close = () => setF({ id: null })

  async function decide(kind) {
    if (busy || !selected) return
    setBusy(kind)
    const verb = kind === 'approve' ? 'approve' : 'reject'
    try {
      if (kind === 'approve') {
        await callAdminAuth('approve_claim', { claimId: selected.id, businessId: selected.business_id })
        audit('approve', 'claim', selected.id, { businessId: selected.business_id })
      } else {
        await callAdminAuth('reject_claim', { claimId: selected.id })
        audit('reject', 'claim', selected.id, {})
      }
      recordAction({ action: verb, target: 'claim', id: selected.id })
      showToast(kind === 'approve' ? 'Claim approved' : 'Claim rejected', { type: 'success' })
      close()
      qc.invalidateQueries({ queryKey: ['admin'] })
    } catch (err) {
      showToast(`Couldn't ${verb} the claim: ${err.message}`, { type: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const columns = [
    { key: 'business', label: 'Business', sortable: true, sortValue: r => businessOf(r).toLowerCase(), render: r => primaryCell({ title: businessOf(r), onOpen: () => open(r), openLabel: `Open claim for ${businessOf(r)}` }) },
    { key: 'created_at', label: 'Submitted', sortable: true, sortValue: r => r.created_at || '', render: r => (r.created_at ? timeAgo(r.created_at) : '—') },
    { key: 'status', label: 'Status', render: r => <StatusPill status={r.status} /> },
  ]

  return (
    <div>
      <AdminPageHeader title="Claims" subtitle={`${counts.pending} pending · ${counts.all} total`} />

      <FilterBar label="Claim filters" style={{ marginBottom: theme.space[8] }}>
        <SearchBar label="Search claims" value={f.q} onChange={(q) => setF({ q })} placeholder="Search business name…" />
        <FilterPills
          value={f.status}
          onChange={(status) => setF({ status })}
          options={[
            { value: 'pending', label: `Pending ${counts.pending}` },
            { value: 'approved', label: `Approved ${counts.approved}` },
            { value: 'rejected', label: `Rejected ${counts.rejected}` },
            { value: 'all', label: `All ${counts.all}` },
          ]}
        />
      </FilterBar>

      <DataTable
        rows={filtered}
        columns={columns}
        onRowClick={open}
        loading={isLoading}
        error={error ? 'The business claims could not be loaded.' : null}
        onRetry={refetch}
        empty={<Empty icon={<Shield size={40} strokeWidth={1.5} color={theme.gray300} />} message="No business claims match these filters" />}
      />

      <DetailDrawer
        open={!!f.id && !isLoading}
        onClose={close}
        title={selected ? businessOf(selected) : 'Business claim'}
        footer={selected?.status === 'pending' ? (
          <>
            <Button variant="danger" fullWidth leftIcon={<XCircle size={14} />} onClick={() => decide('reject')} disabled={!!busy} loading={busy === 'reject'}>Reject</Button>
            <Button variant="primary" fullWidth leftIcon={<CheckCircle size={14} />} onClick={() => decide('approve')} disabled={!!busy} loading={busy === 'approve'}>Approve</Button>
          </>
        ) : null}
      >
        {!selected ? (
          <p style={{ margin: 0, fontSize: 13, color: theme.textMid }}>This claim could not be found. It may already have been handled.</p>
        ) : (
          <div>
            <DetailField label="Status"><StatusPill status={selected.status} /></DetailField>
            <DetailField label="Submitted">{selected.created_at ? new Date(selected.created_at).toLocaleString() : null}</DetailField>
            {extraFields(selected).map(field => (
              <DetailField key={field.key} label={field.label}>{field.value}</DetailField>
            ))}
          </div>
        )}
      </DetailDrawer>
    </div>
  )
}
```

- [ ] **Step 4: Route it and remove the legacy tab**

Add to `SCREEN_COMPONENTS` in `AdminApp.jsx`:

```jsx
  claims: lazy(() => import('./screens/moderation/ClaimsScreen.jsx')),
```

In `legacy/LegacyScreens.jsx` delete the `ClaimsTab` import, the `{tab === 'claims' && …}` line, and the `approveClaim` and `rejectClaim` functions.

```bash
git rm apps/carefind/src/modules/admin/tabs/ClaimsTab.jsx
grep -n "ClaimsTab\|approveClaim\|rejectClaim" -r apps/carefind/src
```

Expected: no output.

- [ ] **Step 5: Run tests and build**

Run: `npm test -- src/modules/admin` — expected: PASS, 8 new tests.
Run: `node_modules/.bin/vite build` — expected: success.
Measure at 375, 768 and 1280px as in Task 8 Step 6.

- [ ] **Step 6: Commit**

```bash
git add apps/carefind/src/modules/admin && git commit -m "feat(carefind): business claims as a table with a review drawer" -- apps/carefind/src/modules/admin
```

---

### Task 11: Moderation queue screen

The legacy queue renders `<BulkActionBar>` without its `selectedCount` prop, so the bar returns `null` and bulk actions never appear. That is fixed first, as its own commit, then the screen is rebuilt.

**Files:**
- Modify (fix commit): `src/modules/admin/tabs/ModerationQueue.jsx` (the `<BulkActionBar … />` element)
- Create: `src/modules/admin/screens/moderation/QueueScreen.jsx`
- Modify: `src/modules/admin/AdminApp.jsx`, `src/modules/admin/legacy/LegacyScreens.jsx`
- Delete: `src/modules/admin/tabs/ModerationQueue.jsx`, `src/modules/admin/stores/moderationStore.jsx`
- Test: `src/modules/admin/screens/moderation/QueueScreen.test.jsx`

**Interfaces:**
- Consumes: `useQueue('reports')`, `useQueue('verifications')`; `contentRepository.getPosts({ limit: 50 })`; `getModerationItems({ reports, posts, verifications })` from `lib/priorityScoring` (items: `{ id, source: 'report'|'post'|'verification', target_id, title, description, status, created_at, score, priority, raw }`); `PriorityBadge`, `BulkActionBar`; `selectionColumn`, `primaryCell`; `pathFor`.
- Produces: default export `QueueScreen`.

- [ ] **Step 1: Fix the hidden bulk bar (separate commit)**

In `src/modules/admin/tabs/ModerationQueue.jsx`, change the `<BulkActionBar>` element at the bottom to:

```jsx
      <BulkActionBar
        selectedCount={selectedIds.size}
        onApprove={handleBulkApprove}
        onReject={handleBulkReject}
        onDelete={handleBulkDelete}
        onClear={clearSelection}
      />
```

Run: `npm test -- src/modules/admin` — expected: PASS.

```bash
git add apps/carefind/src/modules/admin/tabs/ModerationQueue.jsx && git commit -m "fix(carefind): moderation queue bulk actions were never shown

BulkActionBar returns null without selectedCount, which the queue
never passed, so selecting items offered no approve, reject or delete." -- apps/carefind/src/modules/admin/tabs/ModerationQueue.jsx
```

- [ ] **Step 2: Write the failing test**

`src/modules/admin/screens/moderation/QueueScreen.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { useLocation } from 'react-router-dom'

const { callAdminAuth, getPosts } = vi.hoisted(() => ({ callAdminAuth: vi.fn(), getPosts: vi.fn() }))
vi.mock('../../adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))
vi.mock('../../repositories/contentRepository', () => ({ contentRepository: { getPosts } }))

import { renderAdmin } from '../../test/renderAdmin.jsx'
import QueueScreen from './QueueScreen.jsx'

const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600000).toISOString()
const reports = [
  { id: 'r1', post_id: 'p1', reason: 'Misinformation', status: 'pending', created_at: iso(5), posts: { content: 'Garlic cures malaria' } },
]
const verifications = [
  { id: 'v1', user_id: 'u1', full_name: 'Amina Bello', profession: 'Pharmacist', workplace: 'MedPlus', status: 'pending', created_at: iso(48) },
  { id: 'v2', user_id: 'u2', full_name: 'Done Already', profession: 'Nurse', status: 'approved', created_at: iso(90) },
]
const posts = [
  { id: 'p9', content: 'Flagged thing', post_type: 'text', status: 'flagged', report_count: 2, created_at: iso(1) },
  { id: 'p8', content: 'Fine post', post_type: 'text', status: 'active', report_count: 0, created_at: iso(1) },
]

function mockApi(overrides = {}) {
  callAdminAuth.mockImplementation(async (action, payload) => {
    if (overrides[action]) return overrides[action](payload)
    if (action === 'list_reports') return { data: reports }
    if (action === 'list_verification_requests') return { data: verifications }
    return {}
  })
}
const calls = (action) => callAdminAuth.mock.calls.filter(c => c[0] === action)
function Where() { const l = useLocation(); return <span data-testid="where">{l.pathname}{l.search}</span> }
const at = (route, opts = {}) => renderAdmin(<><QueueScreen /><Where /></>, { route, ...opts })

describe('QueueScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); mockApi(); getPosts.mockResolvedValue(posts) })

  it('merges reports, flagged posts and pending verifications', async () => {
    at('/admin/moderation/queue')
    expect(await screen.findByRole('button', { name: 'Open Misinformation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Verification: Amina Bello' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Flagged thing' })).toBeInTheDocument()
    expect(screen.queryByText(/Done Already/)).not.toBeInTheDocument()
    expect(screen.queryByText('Fine post')).not.toBeInTheDocument()
    expect(screen.getByText('3 items need review')).toBeInTheDocument()
  })

  it('filters by source from the URL', async () => {
    at('/admin/moderation/queue?source=verification')
    expect(await screen.findByRole('button', { name: 'Open Verification: Amina Bello' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Misinformation' })).not.toBeInTheDocument()
  })

  it('opens a verification or a report on its own screen', async () => {
    at('/admin/moderation/queue')
    fireEvent.click(await screen.findByRole('button', { name: 'Open Verification: Amina Bello' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/moderation/verifications?id=v1')
  })

  it('shows the bulk bar only when something is selected, and clears it', async () => {
    at('/admin/moderation/queue')
    await screen.findByRole('button', { name: 'Open Misinformation' })
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Misinformation' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
  })

  it('bulk approves verifications and resolves reports, and reports what it skipped', async () => {
    at('/admin/moderation/queue')
    await screen.findByRole('button', { name: 'Open Misinformation' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }))
    expect(await screen.findByText('Approved 2, skipped 1')).toBeInTheDocument()
    expect(calls('approve_verification')[0][1]).toEqual({ id: 'v1', userId: 'u1', profession: 'Pharmacist' })
    expect(calls('resolve_report')[0][1]).toEqual({ id: 'r1' })
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument()
  })

  it('counts an item that fails as skipped and carries on', async () => {
    mockApi({ approve_verification: async () => { throw new Error('nope') } })
    at('/admin/moderation/queue?source=verification')
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Verification: Amina Bello' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }))
    expect(await screen.findByText('Approved 0, skipped 1')).toBeInTheDocument()
  })

  it('bulk deletes posts only after the consequence is confirmed', async () => {
    at('/admin/moderation/queue')
    await screen.findByRole('button', { name: 'Open Flagged thing' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Flagged thing' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Misinformation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))
    expect(await screen.findByText('Delete 2 posts?')).toBeInTheDocument()
    expect(calls('delete_post')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Deleted 2 posts')).toBeInTheDocument()
    expect(calls('delete_post').map(c => c[1].id).sort()).toEqual(['p1', 'p9'])
  })

  it('still lists reports and verifications when flagged posts cannot be loaded', async () => {
    getPosts.mockRejectedValue(new Error('rls'))
    at('/admin/moderation/queue')
    expect(await screen.findByRole('button', { name: 'Open Misinformation' })).toBeInTheDocument()
    expect(screen.getByText('Flagged posts could not be loaded.')).toBeInTheDocument()
  })

  it('shows an error with retry when a queue list fails', async () => {
    mockApi({ list_reports: async () => { throw new Error('down') } })
    at('/admin/moderation/queue')
    expect(await screen.findByRole('button', { name: /try again|retry/i })).toBeInTheDocument()
  })

  it('shows a clear empty state', async () => {
    mockApi({ list_reports: async () => ({ data: [] }), list_verification_requests: async () => ({ data: [] }) })
    getPosts.mockResolvedValue([])
    at('/admin/moderation/queue')
    expect(await screen.findByText('Nothing is waiting for review')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/modules/admin/screens/moderation/QueueScreen.test.jsx`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement the screen**

`src/modules/admin/screens/moderation/QueueScreen.jsx`:

```jsx
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Layers } from 'lucide-react'
import { DataTable, Empty, FilterBar, Pill } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../../styles/theme'
import { callAdminAuth } from '../../adminApi'
import { useQueue } from '../../data/queues'
import { contentRepository } from '../../repositories/contentRepository'
import { getModerationItems } from '../../lib/priorityScoring'
import { useAdminToast, useAdminConfirm, useAuditLog } from '../../AdminFeedback.jsx'
import { pathFor } from '../../navigation'
import PriorityBadge from '../../components/PriorityBadge'
import { BulkActionBar } from '../../components/BulkActionBar'
import AdminPageHeader from '../../ui/AdminPageHeader.jsx'
import { FilterPills } from '../../ui/FilterPills.jsx'
import { timeAgo } from '../../ui/adminHelpers.js'
import { useUrlFilters } from '../../ui/useUrlFilters.js'
import { primaryCell, selectionColumn } from '../../ui/tableHelpers.jsx'

const DEFAULTS = { source: 'all', priority: 'all' }
const SOURCE_LABEL = { report: 'Report', post: 'Flagged post', verification: 'Verification' }
const SOURCES = [
  { value: 'all', label: 'All sources' },
  { value: 'report', label: 'Reports' },
  { value: 'post', label: 'Flagged posts' },
  { value: 'verification', label: 'Verifications' },
]
const PRIORITIES = ['all', 'urgent', 'high', 'medium', 'low'].map(p => ({ value: p, label: p === 'all' ? 'All priorities' : p }))

export default function QueueScreen() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const showToast = useAdminToast()
  const askConfirm = useAdminConfirm()
  const audit = useAuditLog()
  const [f, setF] = useUrlFilters(DEFAULTS)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [working, setWorking] = useState(false)

  const reportsQ = useQueue('reports')
  const verifsQ = useQueue('verifications')
  const postsQ = useQuery({ queryKey: ['admin', 'queue-posts'], queryFn: () => contentRepository.getPosts({ limit: 50 }), staleTime: 15000 })

  const items = useMemo(
    () => getModerationItems({ reports: reportsQ.data || [], posts: postsQ.data || [], verifications: verifsQ.data || [] }),
    [reportsQ.data, postsQ.data, verifsQ.data],
  )
  const filtered = useMemo(
    () => items.filter(i => (f.source === 'all' || i.source === f.source) && (f.priority === 'all' || i.priority === f.priority)),
    [items, f.source, f.priority],
  )

  const isLoading = reportsQ.isLoading || verifsQ.isLoading
  const listError = reportsQ.error || verifsQ.error
  const retry = () => { reportsQ.refetch(); verifsQ.refetch(); postsQ.refetch() }

  const toggle = (id) => setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const toggleAll = () => setSelectedIds(prev => (filtered.length > 0 && filtered.every(i => prev.has(i.id)) ? new Set() : new Set(filtered.map(i => i.id))))
  const clear = () => setSelectedIds(new Set())
  const chosen = () => items.filter(i => selectedIds.has(i.id))

  function openItem(item) {
    if (item.source === 'verification') navigate(`${pathFor('verifications')}?id=${encodeURIComponent(item.id)}`)
    else if (item.source === 'report') navigate(`${pathFor('reports')}?id=${encodeURIComponent(item.raw.id)}`)
    else navigate(pathFor('posts'))
  }

  // Runs one call per selected item. An item that does not apply to the
  // action, or whose call fails, is counted as skipped and the rest continue.
  async function runBulk(perItem, summarise) {
    if (working) return
    setWorking(true)
    let done = 0
    let skipped = 0
    for (const item of chosen()) {
      try {
        if (await perItem(item)) done += 1
        else skipped += 1
      } catch {
        skipped += 1
      }
    }
    clear()
    setWorking(false)
    qc.invalidateQueries({ queryKey: ['admin'] })
    showToast(summarise(done, skipped), { type: skipped > 0 ? 'warning' : 'success' })
  }

  const tally = (verb) => (done, skipped) => (skipped > 0 ? `${verb} ${done}, skipped ${skipped}` : `${verb} ${done} items`)

  const bulkApprove = () => runBulk(async (item) => {
    if (item.source === 'verification') {
      await callAdminAuth('approve_verification', { id: item.id, userId: item.target_id, profession: item.raw.profession })
      audit('approve', 'verification', item.id, { userId: item.target_id })
      return true
    }
    if (item.source === 'report') {
      await callAdminAuth('resolve_report', { id: item.raw.id })
      audit('resolve', 'report', item.raw.id, {})
      return true
    }
    return false
  }, tally('Approved'))

  const bulkReject = () => runBulk(async (item) => {
    if (item.source === 'verification') {
      await callAdminAuth('reject_verification', { id: item.id })
      audit('reject', 'verification', item.id, {})
      return true
    }
    if (item.source === 'report') {
      await callAdminAuth('resolve_report', { id: item.raw.id })
      audit('resolve', 'report', item.raw.id, {})
      return true
    }
    return false
  }, tally('Rejected'))

  function bulkDelete() {
    const deletable = chosen().filter(i => (i.source === 'report' || i.source === 'post') && i.target_id)
    if (deletable.length === 0) {
      showToast('Only posts can be deleted. Nothing selected is a post.', { type: 'warning' })
      return
    }
    askConfirm({
      title: `Delete ${deletable.length} ${deletable.length === 1 ? 'post' : 'posts'}?`,
      consequence: 'This permanently deletes the selected posts along with their likes and comments. Selected verifications are left untouched. This cannot be undone.',
      confirmLabel: 'Delete',
      action: () => runBulk(async (item) => {
        if ((item.source !== 'report' && item.source !== 'post') || !item.target_id) return false
        await callAdminAuth('delete_post', { id: item.target_id })
        audit('delete', 'post', item.target_id, { reason: item.source === 'report' ? 'reported content' : 'flagged content' })
        return true
      }, (done, skipped) => (skipped > 0 ? `Deleted ${done}, skipped ${skipped}` : `Deleted ${done} ${done === 1 ? 'post' : 'posts'}`)),
    })
  }

  const columns = [
    selectionColumn({ rows: filtered, selectedIds, onToggle: toggle, onToggleAll: toggleAll, rowLabel: i => i.title }),
    { key: 'title', label: 'Item', render: i => primaryCell({ title: i.title, sub: i.description, onOpen: () => openItem(i), openLabel: `Open ${i.title}` }) },
    { key: 'source', label: 'Type', sortable: true, render: i => <Pill label={SOURCE_LABEL[i.source] || i.source} type="teal" /> },
    { key: 'score', label: 'Priority', sortable: true, render: i => <PriorityBadge priority={i.priority} score={i.score} /> },
    { key: 'created_at', label: 'Waiting', sortable: true, sortValue: i => i.created_at || '', render: i => (i.created_at ? timeAgo(i.created_at) : '—') },
  ]

  return (
    <div>
      <AdminPageHeader title="Moderation queue" subtitle={`${items.length} ${items.length === 1 ? 'item needs' : 'items need'} review`} />

      <FilterBar label="Queue filters" style={{ marginBottom: theme.space[8] }}>
        <FilterPills value={f.source} onChange={(source) => setF({ source })} options={SOURCES} />
        <FilterPills value={f.priority} onChange={(priority) => setF({ priority })} options={PRIORITIES} />
      </FilterBar>

      {postsQ.error && (
        <p role="status" style={{ margin: `0 0 ${theme.space[6]}px`, fontSize: 12, color: theme.warning }}>Flagged posts could not be loaded.</p>
      )}

      <DataTable
        rows={filtered}
        columns={columns}
        loading={isLoading}
        error={listError ? 'The moderation queue could not be loaded.' : null}
        onRetry={retry}
        empty={<Empty icon={<Layers size={40} strokeWidth={1.5} color={theme.gray300} />} message="Nothing is waiting for review" />}
      />

      <BulkActionBar
        selectedCount={selectedIds.size}
        onApprove={working ? undefined : bulkApprove}
        onReject={working ? undefined : bulkReject}
        onDelete={working ? undefined : bulkDelete}
        onClear={clear}
      />
    </div>
  )
}
```

Before running, confirm in `lib/priorityScoring.js` that a report item's `id` is `postId || r.id` and that `raw` is the report row (it is, at the time of writing); the screen uses `item.raw.id` for report calls because the item id is the post id.

- [ ] **Step 5: Route it and remove the legacy queue and store**

Add to `SCREEN_COMPONENTS` in `AdminApp.jsx`:

```jsx
  moderation: lazy(() => import('./screens/moderation/QueueScreen.jsx')),
```

In `legacy/LegacyScreens.jsx`: delete the `ModerationQueue` import, the `{tab === 'moderation' && …}` line, the `ModerationProvider` import, and unwrap the returned JSX so it is just `<div aria-live="polite"> … </div>`.

```bash
git rm apps/carefind/src/modules/admin/tabs/ModerationQueue.jsx apps/carefind/src/modules/admin/stores/moderationStore.jsx
grep -n "ModerationQueue\|moderationStore\|ModerationProvider\|useModerationStore" -r apps/carefind/src
```

Expected: no output.

- [ ] **Step 6: Run tests and build**

Run: `npm test -- src/modules/admin` — expected: PASS, 10 new tests.
Run: `node_modules/.bin/vite build` — expected: success.
Measure at 375, 768 and 1280px as in Task 8 Step 6, including with the bulk bar showing.

- [ ] **Step 7: Commit**

```bash
git add apps/carefind/src/modules/admin && git commit -m "feat(carefind): moderation queue as a selectable table with bulk actions" -- apps/carefind/src/modules/admin
```

---

### Task 12: Home and the feed ranking screen

**Files:**
- Create: `src/modules/admin/screens/home/HomeScreen.jsx`, `src/modules/admin/screens/platform/FeedRankingScreen.jsx`
- Modify: `src/modules/admin/repositories/dashboardRepository.js` (add `getTotals`), `src/modules/admin/HealthPulse.jsx` (grid columns), `src/modules/admin/AdminApp.jsx`, `src/modules/admin/legacy/LegacyScreens.jsx`
- Delete: `src/modules/admin/tabs/DashboardTab.jsx`, `src/modules/admin/tabs/OverviewTab.jsx`
- Test: `src/modules/admin/screens/home/HomeScreen.test.jsx`, `src/modules/admin/repositories/__tests__/dashboardRepository.totals.test.js`

**Interfaces:**
- Consumes: `usePendingCounts`, `useQueue`, `QUEUES` (Task 3); `canAccess`, `screenByKey`, `pathFor` (Task 1); `useUrlFilters`; `StatCard`, `MetricGrid`, `SectionCard`, `DataTable`; `HealthPulse`; `DateRange`; `callAdminAuth('list_transactions')` → `{ data: Array<{ type, naira_amount, created_at }> }`.
- Produces:
  - `dashboardRepository.getTotals(): Promise<{ users: number, posts: number }>` (throws on failure)
  - default exports `HomeScreen`, `FeedRankingScreen`

- [ ] **Step 1: Write the failing tests**

`src/modules/admin/repositories/__tests__/dashboardRepository.totals.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../adminApi.js', () => ({ callAdminAuth: vi.fn() }))
vi.mock('../../../../config/supabaseClient.js', () => ({ supabase: {} }))

import { createDashboardRepository } from '../dashboardRepository.js'

describe('dashboardRepository.getTotals', () => {
  it('asks for head counts only and returns them', async () => {
    const query = vi.fn(async (table) => ({ data: [], count: table === 'profiles' ? 1284 : 9310 }))
    const repo = createDashboardRepository({ query, api: vi.fn() })
    await expect(repo.getTotals()).resolves.toEqual({ users: 1284, posts: 9310 })
    expect(query).toHaveBeenCalledWith('profiles', { select: 'id', count: 'head' })
    expect(query).toHaveBeenCalledWith('posts', { select: 'id', count: 'head' })
  })

  it('reports zero for a missing count and lets failures through', async () => {
    const empty = createDashboardRepository({ query: vi.fn(async () => ({ data: [], count: null })), api: vi.fn() })
    await expect(empty.getTotals()).resolves.toEqual({ users: 0, posts: 0 })
    const broken = createDashboardRepository({ query: vi.fn(async () => { throw new Error('rls') }), api: vi.fn() })
    await expect(broken.getTotals()).rejects.toThrow('rls')
  })
})
```

`src/modules/admin/screens/home/HomeScreen.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router-dom'

const { callAdminAuth, getTotals } = vi.hoisted(() => ({ callAdminAuth: vi.fn(), getTotals: vi.fn() }))
vi.mock('../../adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))
vi.mock('../../repositories/dashboardRepository', () => ({ dashboardRepository: { getTotals } }))
vi.mock('../../HealthPulse.jsx', () => ({ default: () => <div>pulse strip</div> }))

import { renderAdmin } from '../../test/renderAdmin.jsx'
import HomeScreen from './HomeScreen.jsx'

const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600000).toISOString()
const day = (hoursAgo) => iso(hoursAgo).slice(0, 10)
const lists = {
  list_verification_requests: [
    { id: 'v1', full_name: 'Amina Bello', profession: 'Pharmacist', status: 'pending', created_at: iso(52) },
    { id: 'v2', full_name: 'Old Approved', status: 'approved', created_at: iso(500) },
  ],
  list_business_claims: [{ id: 'c1', status: 'pending', created_at: iso(33), businesses: { name: 'MedPlus Ikeja' } }],
  list_reports: [{ id: 'r1', post_id: 'p1', reason: 'Misinformation', status: 'pending', created_at: iso(5) }],
  list_news: [{ id: 'n1', headline: 'New clinic opens', status: 'pending', created_at: iso(2) }],
  list_withdrawal_requests: [{ id: 'w1', status: 'reserved', created_at: iso(3), profiles: { full_name: 'Chidi O.' } }],
  list_transactions: [
    { id: 't1', type: 'topup', naira_amount: 500000, created_at: iso(1) },
    { id: 't2', type: 'topup', naira_amount: 250000, created_at: iso(24 * 40) },
    { id: 't3', type: 'gift', naira_amount: 999999, created_at: iso(1) },
  ],
}

function mockApi(overrides = {}) {
  callAdminAuth.mockImplementation(async (action) => {
    if (overrides[action]) return overrides[action]()
    return { data: lists[action] || [] }
  })
}
function Where() { const l = useLocation(); return <span data-testid="where">{l.pathname}{l.search}</span> }
const at = (opts = {}) => renderAdmin(<><HomeScreen /><Where /></>, { route: opts.route || '/admin', ...opts })

describe('HomeScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); mockApi(); getTotals.mockResolvedValue({ users: 1284, posts: 9310 }) })

  it('summarises what needs attention, with the age of the oldest item', async () => {
    at()
    expect(await screen.findByText('5 items need attention across 5 queues')).toBeInTheDocument()
    const tiles = screen.getByRole('group', { name: 'Queues' })
    expect(within(tiles).getByText('Verifications')).toBeInTheDocument()
    expect(within(tiles).getByText('oldest 2d ago')).toBeInTheDocument()
    expect(within(tiles).getByText('Withdrawals')).toBeInTheDocument()
  })

  it('lists the longest-waiting items first and opens them on their own screen', async () => {
    at()
    const first = await screen.findByRole('button', { name: 'Open Amina Bello' })
    const names = screen.getAllByRole('button', { name: /^Open / }).map(b => b.getAttribute('aria-label'))
    expect(names.slice(0, 3)).toEqual(['Open Amina Bello', 'Open MedPlus Ikeja', 'Open Misinformation'])
    expect(screen.queryByRole('button', { name: 'Open Old Approved' })).not.toBeInTheDocument()
    fireEvent.click(first)
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/moderation/verifications?id=v1')
  })

  it('says so when nothing is waiting', async () => {
    mockApi(Object.fromEntries(Object.keys(lists).map(a => [a, async () => ({ data: [] })])))
    at()
    expect(await screen.findByText('Nothing needs attention right now')).toBeInTheDocument()
    expect(screen.getByText('All queues are clear')).toBeInTheDocument()
  })

  it('shows platform totals and revenue for the chosen period only', async () => {
    at()
    expect(await screen.findByText('1,284')).toBeInTheDocument()
    expect(screen.getByText('9,310')).toBeInTheDocument()
    expect(await screen.findByText('₦7,500')).toBeInTheDocument()
  })

  it('narrows revenue to a date range from the URL', async () => {
    at({ route: `/admin?from=${day(48)}&to=${day(0)}` })
    expect(await screen.findByText('₦5,000')).toBeInTheDocument()
  })

  it('shows a failed queue as unavailable instead of zero', async () => {
    mockApi({ list_reports: async () => { throw new Error('down') } })
    at()
    const tiles = await screen.findByRole('group', { name: 'Queues' })
    await waitFor(() => expect(within(tiles).getByText('Unavailable')).toBeInTheDocument())
    expect(screen.getByText('Some queues could not be loaded, so this list may be incomplete.')).toBeInTheDocument()
  })

  it('shows totals as unavailable when they fail to load', async () => {
    getTotals.mockRejectedValue(new Error('rls'))
    at()
    await waitFor(() => expect(screen.getAllByText('Unavailable').length).toBeGreaterThanOrEqual(2))
  })

  it('leaves out queues and revenue the role may not see', async () => {
    at({ admin: { id: 'm', role: 'moderator' }, permissions: { withdrawals: false, revenue: false, claims: false } })
    const tiles = await screen.findByRole('group', { name: 'Queues' })
    expect(within(tiles).queryByText('Withdrawals')).not.toBeInTheDocument()
    expect(within(tiles).queryByText('Claims')).not.toBeInTheDocument()
    expect(screen.queryByText('Revenue')).not.toBeInTheDocument()
    expect(callAdminAuth).not.toHaveBeenCalledWith('list_transactions', expect.anything())
    expect(screen.queryByRole('button', { name: 'Open MedPlus Ikeja' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/modules/admin/screens/home src/modules/admin/repositories/__tests__/dashboardRepository.totals.test.js`
Expected: FAIL (`getTotals` is not a function; `HomeScreen.jsx` not found).

- [ ] **Step 3: Add `getTotals` to the repository**

In `src/modules/admin/repositories/dashboardRepository.js`, add this method inside the returned object, before `getStats`:

```js
    // Whole-table counts, not the size of a loaded batch. Errors propagate so
    // the screen can say "unavailable" instead of showing a false zero.
    async getTotals() {
      const [users, posts] = await Promise.all([
        transport.query('profiles', { select: 'id', count: 'head' }),
        transport.query('posts', { select: 'id', count: 'head' }),
      ])
      return { users: users.count ?? 0, posts: posts.count ?? 0 }
    },
```

- [ ] **Step 4: Implement Home**

`src/modules/admin/screens/home/HomeScreen.jsx`:

```jsx
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle, DollarSign, FileText, Flag, Landmark, Newspaper, Shield, UserCheck, Users } from 'lucide-react'
import { DataTable, Empty, MetricGrid, Pill, SectionCard, StatCard } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../../styles/theme'
import { callAdminAuth } from '../../adminApi'
import { useAdmin } from '../../AdminGate.jsx'
import { QUEUES, usePendingCounts, useQueue } from '../../data/queues'
import { dashboardRepository } from '../../repositories/dashboardRepository'
import { canAccess, pathFor, screenByKey } from '../../navigation'
import HealthPulse from '../../HealthPulse.jsx'
import AdminPageHeader from '../../ui/AdminPageHeader.jsx'
import { DateRange } from '../../ui/FilterPills.jsx'
import { timeAgo } from '../../ui/adminHelpers.js'
import { useUrlFilters } from '../../ui/useUrlFilters.js'
import { primaryCell } from '../../ui/tableHelpers.jsx'

const DEFAULTS = { from: '', to: '' }
const UNAVAILABLE = 'Unavailable'
const LONGEST = 8

// How each queue names an item, and which screen opens it.
const QUEUE_VIEW = {
  verifications: { label: 'Verifications', one: 'Verification', icon: <UserCheck />, title: r => r.full_name || 'Unnamed applicant' },
  claims: { label: 'Claims', one: 'Claim', icon: <Shield />, title: r => r.businesses?.name || 'Unknown business' },
  reports: { label: 'Reports', one: 'Report', icon: <Flag />, title: r => r.reason || 'No reason given' },
  news: { label: 'News', one: 'News', icon: <Newspaper />, title: r => r.headline || 'Untitled article' },
  withdrawals: { label: 'Withdrawals', one: 'Withdrawal', icon: <Landmark />, title: r => r.profiles?.full_name || 'Withdrawal request' },
}
const NAMES = Object.keys(QUEUE_VIEW)

const naira = (kobo) => `₦${Math.round(kobo / 100).toLocaleString()}`

export default function HomeScreen() {
  const admin = useAdmin()
  const navigate = useNavigate()
  const [f, setF] = useUrlFilters(DEFAULTS)
  const { counts, total, failed } = usePendingCounts()

  // Hooks cannot be called in a loop; one call per queue, in a fixed order.
  const queues = {
    verifications: useQueue('verifications'),
    claims: useQueue('claims'),
    reports: useQueue('reports'),
    news: useQueue('news'),
    withdrawals: useQueue('withdrawals'),
  }
  const permitted = NAMES.filter(name => canAccess(screenByKey(QUEUES[name].permission), admin))

  const canSeeRevenue = canAccess(screenByKey('revenue'), admin)
  const totalsQ = useQuery({ queryKey: ['admin', 'home-totals'], queryFn: () => dashboardRepository.getTotals(), staleTime: 60000 })
  const txQ = useQuery({
    queryKey: ['admin', 'transactions'],
    queryFn: async () => (await callAdminAuth('list_transactions', {}))?.data || [],
    enabled: canSeeRevenue,
    staleTime: 60000,
  })

  const waiting = useMemo(() => {
    const all = []
    for (const name of permitted) {
      for (const row of queues[name].data || []) {
        if (!QUEUES[name].isPending(row)) continue
        all.push({ id: `${name}:${row.id}`, recordId: row.id, queue: name, title: QUEUE_VIEW[name].title(row), created_at: row.created_at })
      }
    }
    // Oldest first; items with no date sink to the bottom.
    all.sort((a, b) => (a.created_at || '9999').localeCompare(b.created_at || '9999'))
    return all
  }, [permitted.join(','), ...NAMES.map(n => queues[n].data)]) // eslint-disable-line react-hooks/exhaustive-deps

  const oldest = (name) => waiting.find(w => w.queue === name)?.created_at

  const revenue = useMemo(() => {
    const from = f.from || '0000'
    const to = f.to ? `${f.to}T23:59:59` : '9999'
    return (txQ.data || [])
      .filter(t => t.type === 'topup' && (t.created_at || '') >= from && (t.created_at || '') <= to)
      .reduce((sum, t) => sum + (t.naira_amount || 0), 0)
  }, [txQ.data, f.from, f.to])

  const open = (item) => navigate(`${pathFor(QUEUES[item.queue].permission)}?id=${encodeURIComponent(item.recordId)}`)

  const subtitle = total > 0
    ? `${total} ${total === 1 ? 'item needs' : 'items need'} attention across ${permitted.length} ${permitted.length === 1 ? 'queue' : 'queues'}`
    : 'Nothing needs attention right now'

  const columns = [
    { key: 'title', label: 'Item', render: i => primaryCell({ title: i.title, onOpen: () => open(i), openLabel: `Open ${i.title}` }) },
    { key: 'queue', label: 'Queue', render: i => <Pill label={QUEUE_VIEW[i.queue].one} type="amber" /> },
    { key: 'created_at', label: 'Waiting', render: i => (i.created_at ? timeAgo(i.created_at) : '—') },
  ]

  const period = f.from || f.to ? 'selected period' : 'all loaded transactions'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[10] }}>
      <AdminPageHeader title="Home" subtitle={subtitle} />

      <MetricGrid label="Queues">
        {permitted.map(name => {
          const count = counts[name]
          const since = oldest(name)
          return (
            <StatCard
              key={name}
              icon={QUEUE_VIEW[name].icon}
              label={QUEUE_VIEW[name].label}
              value={count == null ? UNAVAILABLE : count}
              tone={count > 0 ? 'warning' : undefined}
              sub={count > 0 && since ? `oldest ${timeAgo(since)}` : count === 0 ? 'clear' : undefined}
              onClick={() => navigate(pathFor(QUEUES[name].permission))}
            />
          )
        })}
      </MetricGrid>

      <SectionCard title="Waiting longest" sub={failed ? 'Some queues could not be loaded, so this list may be incomplete.' : undefined} bodyStyle={{ padding: 0 }}>
        <DataTable
          rows={waiting.slice(0, LONGEST)}
          columns={columns}
          onRowClick={open}
          loading={permitted.some(name => queues[name].isLoading)}
          empty={<Empty icon={<CheckCircle size={40} strokeWidth={1.5} color={theme.gray300} />} message="All queues are clear" />}
        />
      </SectionCard>

      <SectionCard title="Platform" sub={canSeeRevenue ? `Revenue covers ${period}.` : undefined}>
        <MetricGrid label="Platform totals">
          <StatCard icon={<Users />} label="Users" value={totalsQ.isError ? UNAVAILABLE : (totalsQ.data ? totalsQ.data.users.toLocaleString() : '…')} />
          <StatCard icon={<FileText />} label="Posts" value={totalsQ.isError ? UNAVAILABLE : (totalsQ.data ? totalsQ.data.posts.toLocaleString() : '…')} />
          {canSeeRevenue && (
            <StatCard icon={<DollarSign />} label="Revenue" value={txQ.isError ? UNAVAILABLE : (txQ.data ? naira(revenue) : '…')} onClick={() => navigate(pathFor('revenue'))} />
          )}
        </MetricGrid>
        {canSeeRevenue && (
          <div style={{ marginTop: theme.space[8], maxWidth: 420 }}>
            <DateRange from={f.from} to={f.to} onFrom={(from) => setF({ from })} onTo={(to) => setF({ to })} />
          </div>
        )}
      </SectionCard>

      <HealthPulse onNavigate={(key) => navigate(pathFor(key))} />
    </div>
  )
}
```

Three things to confirm against the shared components before running, changing only this file if they differ:
- `DataTable` prints its own "N items" count line above the table. Inside a `SectionCard` with `bodyStyle={{ padding: 0 }}` that line has no padding; if it looks wrong, pass `count=" "` to suppress it or give the section body its default padding.
- `timeAgo` returns strings such as `2d ago`; the tile reads `oldest 2d ago`.
- `naira_amount` is stored in kobo. The legacy code divides by 100 (`RevenueTab`, `DashboardTab`); the tests above assume the same (`500000` → `₦5,000`).

- [ ] **Step 5: Add the feed ranking screen and make the pulse strip responsive**

`src/modules/admin/screens/platform/FeedRankingScreen.jsx`:

```jsx
import AdminPageHeader from '../../ui/AdminPageHeader.jsx'
import FeedRankingConfig from '../../FeedRankingConfig.jsx'
import DistributionExperiments from '../../DistributionExperiments.jsx'

// These two panels used to sit at the bottom of the overview tab. They keep
// the same permission (`overview`), so access to them is unchanged.
export default function FeedRankingScreen() {
  return (
    <div>
      <AdminPageHeader title="Feed ranking" subtitle="How posts are ranked and which distribution experiments are running" />
      <FeedRankingConfig />
      <DistributionExperiments />
    </div>
  )
}
```

In `src/modules/admin/HealthPulse.jsx`, change the items grid from `gridTemplateColumns: 'repeat(4, 1fr)'` to:

```jsx
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
```

and add `aria-label="Refresh platform pulse"` to the refresh `<button>`.

- [ ] **Step 6: Route them and remove the legacy overview**

Add to `SCREEN_COMPONENTS` in `AdminApp.jsx`:

```jsx
  overview: lazy(() => import('./screens/home/HomeScreen.jsx')),
  feed_ranking: lazy(() => import('./screens/platform/FeedRankingScreen.jsx')),
```

In `legacy/LegacyScreens.jsx` delete: the three `{tab === 'overview' && …}` lines; the imports of `HealthPulse`, `DashboardTab` and `OverviewTab`; and the `dateFrom`/`dateTo` state. Then check what else became unused and remove it:

```bash
git rm apps/carefind/src/modules/admin/tabs/DashboardTab.jsx apps/carefind/src/modules/admin/tabs/OverviewTab.jsx
grep -n "DashboardTab\|OverviewTab\|dateFrom\|dateTo\|HealthPulse\|\bstats\b" apps/carefind/src/modules/admin/legacy/LegacyScreens.jsx
```

Expected: only the `stats = {}` name inside the `adminData` destructuring may remain; remove it from the destructuring if nothing else uses it.

`AdminApp.news.test.jsx` mocks `./FeedRankingConfig.jsx` and `./DistributionExperiments.jsx`; those mocks are still valid and need no change.

Home is no longer a legacy tab, so update `src/modules/admin/AdminApp.test.jsx`: add this mock beside the others,

```jsx
vi.mock('./screens/home/HomeScreen.jsx', () => ({ default: () => <div>home screen</div> }))
```

and in the `it.each` table change the expected text for `/admin-panel` and `/admin/dashboard` from `'legacy:overview'` to `'home screen'`.

- [ ] **Step 7: Run tests and build**

Run: `npm test -- src/modules/admin` — expected: PASS, 8 Home tests + 2 repository tests, and `HealthPulse.test.jsx` still green.
Run: `node_modules/.bin/vite build` — expected: success.
Measure Home at 375, 768 and 1280px as in Task 8 Step 6.

- [ ] **Step 8: Commit**

```bash
git add apps/carefind/src/modules/admin && git commit -m "feat(carefind): admin home shows what needs attention; feed ranking gets its own screen" -- apps/carefind/src/modules/admin
```

---

### Task 13: Documentation and whole-plan verification

**Files:**
- Create: `apps/carefind/docs/ADMIN_CONSOLE.md`
- Modify: `README.md` (repo root; add one line under the CareFind section pointing at the new doc)

**Interfaces:** none.

- [ ] **Step 1: Write the developer guide**

`apps/carefind/docs/ADMIN_CONSOLE.md`:

```markdown
# CareFind admin console

The admin lives at `/admin/*`. Design: `docs/superpowers/specs/2026-10-05-carefind-admin-console-design.md`.

## How it is put together

- `src/main.jsx` renders `AdminApp` for any path where `isAdminPath()` is true. The console has its own
  un-keyed router, so its sidebar, filters and open record survive navigation. Pages under the public
  router remount on every navigation; the console does not.
- `AdminGate` runs the server `verify` call before anything renders and provides `useAdmin()`
  (`adminUser`, `permissions`, `signOut`). It is for experience only: the admin API and the database
  policies decide what an admin may actually do.
- `navigation.js` is the single list of screens. The sidebar, routes, command palette and role editor
  all read it.
- `AdminFeedbackProvider` owns the one toast, the one confirm dialog and the activity trail:
  `useAdminToast()`, `useAdminConfirm()`, `useAdminActivity()`, `useAuditLog()`.
- `data/queues.js` owns the work queues and the pending counts shown in the sidebar and on Home.
- `legacy/LegacyScreens.jsx` renders screens that have not been rebuilt yet. It shrinks as screens
  move out and is deleted when the last one has.

## Adding or rebuilding a screen

1. Add (or keep) its entry in `SCREENS` in `navigation.js`. Reuse the existing permission key if the
   screen already existed. A brand-new key must be `explicit: true`, which denies it to every role
   except `super_admin` until it is granted.
2. Create `screens/<group>/<Name>Screen.jsx`. It takes no props. It fetches its own data with TanStack
   Query under a key starting `['admin', …]`, and renders loading, error-with-retry and empty states.
   Query functions must not swallow errors.
3. Keep search text, filters and the open record id in the URL with `useUrlFilters(DEFAULTS)`
   (`DEFAULTS` must be a module-level constant).
4. Build the list with the shared `DataTable`. Make the first column `primaryCell(...)` so a record
   can be opened from the keyboard. Open the record in `DetailDrawer`; use a full page only for
   records with a lot of related data (businesses, users).
5. Register the component in `SCREEN_COMPONENTS` in `AdminApp.jsx`.
6. If you are replacing a legacy tab, delete its `{tab === '…'}` line, handlers and state from
   `LegacyScreens.jsx` and delete the old tab file, in the same commit.
7. After any action that changes data, call `queryClient.invalidateQueries({ queryKey: ['admin'] })`.
8. Destructive actions go through `useAdminConfirm()` with a `consequence` sentence.

## Checks before committing a screen

- `npm test -- src/modules/admin`
- `node_modules/.bin/vite build` (not `npx vite build`)
- At 375, 768 and 1280px: `document.documentElement.scrollWidth === window.innerWidth`, with the
  drawer open and closed.
- Every component used in JSX is imported. CareFind's ESLint has no React plugin and will not tell you.

## Interim screens

"Business hub" and "Directory manager" in the Directory group are the old standalone pages mounted
unchanged. They are merged with "Businesses" into one screen in Plan 2.
```

In the root `README.md`, under the `### CareFind` module list, add:

```markdown
The CareFind admin console (`/admin`) is documented in `apps/carefind/docs/ADMIN_CONSOLE.md`.
```

- [ ] **Step 2: Run the whole CareFind suite, lint and build**

Run: `npm test`
Expected: the full suite passes. Any failure outside `src/modules/admin`, `src/modules/account/Login.test.jsx` and `src/mainSourceOrder.test.js` was not caused by this plan: confirm with `git stash` that it also fails on the commit before Task 1, and report it rather than fixing it here.

Run: `npm run lint` — expected: no new errors.
Run: `node_modules/.bin/vite build` — expected: success. In the build output, confirm there is a separate chunk whose name starts with `AdminApp` (the console is not in the public entry chunk).

- [ ] **Step 3: Confirm nothing from the old shell is left**

From the repo root:

```bash
grep -rnE "AdminPanel|AdminLayout|AdminSidebar|NAV_GROUPS|/admin-panel" apps/carefind/src --include=*.js --include=*.jsx | grep -v "navigation.js"
ls apps/carefind/src/modules/admin/tabs
```

Expected: the `grep` prints nothing (the only remaining mention of `/admin-panel` is the redirect in `navigation.js` and its tests). The `tabs` listing no longer contains `VerificationsTab`, `ReportsTab`, `ClaimsTab`, `ModerationQueue`, `DashboardTab` or `OverviewTab`.

- [ ] **Step 4: Signed-out browser check**

With the dev server running and no session, open each of these and confirm each ends at `/login` with no admin content flashing first: `/admin`, `/admin/moderation/queue`, `/admin/agents/transfers`, `/admin-panel`, `/business-directory`, `/agents/approval`. Confirm `/business-discovery`, `/agents/register` and `/agent-login` still load their public pages.

- [ ] **Step 5: Commit**

```bash
git add apps/carefind/docs/ADMIN_CONSOLE.md README.md && git commit -m "docs(carefind): admin console developer guide" -- apps/carefind/docs/ADMIN_CONSOLE.md README.md
```

- [ ] **Step 6: Hand over for the signed-in walkthrough**

The implementer cannot sign in as an admin. Give the owner this list to walk through, signed in as a super admin, at desktop width and on a phone:

1. `/admin` shows Home: queue tiles, "Waiting longest", platform totals, the pulse strip.
2. The sidebar shows eight groups with pending counts; collapsing it survives moving between screens; the bell shows the total.
3. Verifications: open a request, view its credential, approve one, reject one; refresh with a drawer open and it reopens.
4. Reports: dismiss one; delete a post and read the confirmation text first.
5. Claims: approve one, reject one.
6. Queue: select several items; the bulk bar appears; bulk approve; bulk delete with its confirmation.
7. Every other sidebar item still opens its old screen and works as before (Posts, Stories, News, Live, Promotions, Users, Tasks, Businesses, Business hub, Directory manager, Drug intel, Search insights, Shop, Orders, Revenue, Withdrawals, the three Agents screens, Team and roles, Audit log, Errors, Email templates, Feed ranking).
8. Ctrl+K opens search and navigates; the AI copilot button opens the copilot.
9. Sign out returns to `/login`.

Report anything that differs. Plan 2 (Community, Directory, Content, Commerce, Finance, Agents, Platform, clean-up) is written after this walkthrough.
