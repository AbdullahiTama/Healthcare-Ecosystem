# CareFind admin Phase 2b (Users and Businesses) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Users and Businesses out of `LegacyTabHost` into directory screens with server-side search, filters and paging and a detail drawer, so rows beyond the newest 100 can be found and counts are honest.

**Architecture:** Two directory hooks (`useUsersDirectory`, `useBusinessesDirectory`) page on the server (`limit + 1` to detect a next page). A shared `DirectoryTable` supplies search, filters slot, count line, paging and states. `useUserActions` holds the moved verify/suspend/delete handlers. Two thin sections supply columns, filters and drawer bodies on `ReviewDrawer`. A new, injection-safe `or` filter op is added to the admin transport for the businesses location filter.

**Tech Stack:** React, @tanstack/react-query, vitest + Testing Library (jsdom), `@care-ecosystem/design-system/components/ui`.

**Spec:** `docs/superpowers/specs/2026-10-12-carefind-admin-phase2b-design.md`

## Global Constraints

- All paths are relative to the worktree root. `ADM` = `apps/carefind/src/modules/admin/`. Run tests from `apps/carefind`: `npx vitest run <path>`. Branch `feat/carefind-admin-phase2b` (based on `feat/carefind-admin-phase2a`).
- One commit per task unless the task says otherwise, staged and committed in one command with explicit paths: `git add <paths> && git commit -m "..." -- <paths>`. Messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- No backend, SQL, auth or financial change (nothing under `apps/carefind/api`). Same `callAdminAuth` actions and payloads for `manual_verify {userId, specialty}`, `suspend_user {userId, days}`, `delete_user {userId}`. Never send a `token` field.
- No UI-only permission check presented as security. `AdminPanel`'s `isAllowed` gate must still cover both tabs.
- A source that fails to load shows "Couldn't load" with Retry, never an empty list, "No users match", or a zero.
- The shared design-system package (`packages/design-system`) is not modified.
- ESLint has no React plugin: after writing JSX, check every component used is imported. Run `npm run lint` (not bare eslint) from `apps/carefind`.
- The shared `Modal` card carries `role="button"` (known defect, Phase 2a finding 21), so tests must use exact role names and `within(screen.getByRole('dialog'))` where text appears in both the table and the drawer.
- The full vitest suite takes 10+ minutes: during tasks run only `npx vitest run src/modules/admin`.
- Tests use `renderWithQueryClient` from `apps/carefind/src/test/renderWithQueryClient.jsx` (relative `../../../test/renderWithQueryClient.jsx` from `ADM/hooks`, `ADM/ui`, `ADM/sections`). Section tests that don't need a query client may use plain `render`.

## Review Focus

- A search term containing `, ( ) " \ % _` can never add, drop or change a filter clause (Task 1).
- A failed list is never rendered as "No users match" / "No businesses match" (Tasks 5-7).
- Delete is hidden for the signed-in admin and only runs after confirmation; Suspend now confirms (Task 6).
- A failed posts/reviews/products load in a drawer shows an inline message, never "0" (Tasks 6-7).
- Changing search or a filter resets to page 1; Next is enabled only when `limit + 1` rows came back (Tasks 2, 3, 5).

---

### Task 1: Injection-safe `or` filter op in the admin transport

**Files:**
- Modify: `ADM/repositories/transport.js`
- Create: `ADM/repositories/transport.test.js`

**Interfaces:**
- Produces: `likeContains(term)` (exported) returns the ilike pattern `%<escaped term>%`, escaping `\`, `%`, `_` with a backslash. `adminTransport.query(table, { filters })` gains `{ op: 'or', terms: [{ col, contains }] }`, meaning "any column contains the text, case-insensitively", built as one PostgREST `or(...)` clause: `col.ilike."<pattern>"` joined by commas, each pattern double-quoted with `\` and `"` backslash-escaped. `col` must match `/^[a-z_][a-z0-9_]*$/` or the call throws `Error('Invalid filter column')`.

- [ ] **Step 1: Write the failing test** `ADM/repositories/transport.test.js`

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = vi.hoisted(() => [])
vi.mock('../../../config/supabaseClient.js', () => {
  const builder = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve) => resolve({ data: [], error: null, count: 0 })
      return (...args) => { calls.push([prop, ...args]); return builder }
    },
  })
  return { supabase: { from: (t) => { calls.push(['from', t]); return builder }, rpc: vi.fn(), storage: {} } }
})
vi.mock('../adminApi.js', () => ({ callAdminAuth: vi.fn() }))

import { createAdminTransport, likeContains } from './transport.js'

const transport = createAdminTransport()
const orClause = () => calls.find(c => c[0] === 'or')?.[1]
beforeEach(() => { calls.length = 0 })

describe('likeContains', () => {
  it('wraps a plain term', () => expect(likeContains('lagos')).toBe('%lagos%'))
  it('escapes LIKE wildcards and the escape character', () => {
    expect(likeContains('50%_off\\x')).toBe('%50\\%\\_off\\\\x%')
  })
})

describe('or filter op', () => {
  it('builds one or() clause over every column', async () => {
    await transport.query('businesses', { filters: [{ op: 'or', terms: [{ col: 'state', contains: 'lagos' }, { col: 'city', contains: 'lagos' }] }] })
    expect(orClause()).toBe('state.ilike."%lagos%",city.ilike."%lagos%"')
  })

  it('a term with commas, parentheses and quotes stays inside one quoted value', async () => {
    await transport.query('businesses', { filters: [{ op: 'or', terms: [{ col: 'state', contains: 'a",id.eq.1),(x' }] }] })
    const clause = orClause()
    // the injected quote is escaped, so the whole term is a single ilike value
    expect(clause).toBe('state.ilike."%a\\",id.eq.1),(x%"')
    expect(clause.match(/\.ilike\./g)).toHaveLength(1)
  })

  it('escapes % _ and backslash for LIKE and then for the quoted string', async () => {
    await transport.query('businesses', { filters: [{ op: 'or', terms: [{ col: 'state', contains: '50%_\\' }] }] })
    expect(orClause()).toBe('state.ilike."%50\\\\%\\\\_\\\\\\\\%"')
  })

  it('rejects a column name that is not a plain identifier', async () => {
    await expect(transport.query('businesses', { filters: [{ op: 'or', terms: [{ col: 'state,id', contains: 'x' }] }] })).rejects.toThrow('Invalid filter column')
  })

  it('ignores an empty or term list instead of sending or()', async () => {
    await transport.query('businesses', { filters: [{ op: 'or', terms: [] }] })
    expect(orClause()).toBeUndefined()
  })

  it('leaves the existing ops unchanged', async () => {
    await transport.query('businesses', { filters: [{ op: 'eq', col: 'state', val: 'Lagos' }, { op: 'ilike', col: 'name', val: '%x%' }] })
    expect(calls).toContainEqual(['eq', 'state', 'Lagos'])
    expect(calls).toContainEqual(['ilike', 'name', '%x%'])
  })
})
```

- [ ] **Step 2: Run, expect FAIL**: `cd apps/carefind && npx vitest run src/modules/admin/repositories/transport.test.js` (likeContains is not exported / or op ignored).

- [ ] **Step 3: Implement** in `ADM/repositories/transport.js`. Add above `createAdminTransport`:

```js
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

// A LIKE pattern matching `term` anywhere. \, % and _ in the term are escaped so
// the term can only ever match itself.
export function likeContains(term) {
  return `%${String(term).replace(/[\\%_]/g, '\\$&')}%`
}

// PostgREST quoted value: wrapped in double quotes, with \ and " escaped.
const quote = (v) => `"${String(v).replace(/[\\"]/g, '\\$&')}"`

function orClause(terms) {
  return terms.map(({ col, contains }) => {
    if (!IDENTIFIER.test(col)) throw new Error('Invalid filter column')
    return `${col}.ilike.${quote(likeContains(contains))}`
  }).join(',')
}
```

and inside the `for (const f of filters)` loop add:

```js
        else if (f.op === 'or') { if (f.terms?.length) q = q.or(orClause(f.terms)) }
```

- [ ] **Step 4: Run, expect PASS** (all tests in the file). If the exact-string expectations for the escaped cases disagree with PostgREST's documented quoting (backslash escapes `"` and `\` inside a double-quoted value), STOP and report DONE_WITH_CONCERNS with what you verified rather than editing the tests to match.
- [ ] **Step 5: Run `npx vitest run src/modules/admin`**, expect green. Commit `feat(carefind): admin transport or filter op that cannot be injected through search text`.

---

### Task 2: useUsersDirectory

**Files:**
- Create: `ADM/hooks/useUsersDirectory.js`, `ADM/hooks/useUsersDirectory.test.jsx`

**Interfaces:**
- Consumes: `callAdminAuth` (`../adminApi`), `adminTransport` (`../repositories/transport`).
- Produces: `USERS_PAGE_SIZE = 25`; `useUsersDirectory({ search, verified, specialty, page })` returns the react-query result with `data = { rows, hasNext, total }`; key `['admin', 'users', { search, verified, specialty, page }]`. `total` is the head count of `profiles` when `search`, `specialty` are empty and `verified === 'all'`, otherwise `null`. A failed list rejects (error), never `[]`; a failed head count gives `total: null` (it must not fail the list).

- [ ] **Step 1: Failing test**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createWrapper } from '../../../test/renderWithQueryClient.jsx'

const callAdminAuth = vi.hoisted(() => vi.fn())
const query = vi.hoisted(() => vi.fn())
vi.mock('../adminApi', () => ({ callAdminAuth }))
vi.mock('../repositories/transport', () => ({ adminTransport: { query } }))

import { useUsersDirectory, USERS_PAGE_SIZE } from './useUsersDirectory'

const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: `u${i}` }))
const params = (o = {}) => ({ search: '', verified: 'all', specialty: '', page: 0, ...o })

beforeEach(() => {
  callAdminAuth.mockReset().mockResolvedValue({ data: rowsOf(3) })
  query.mockReset().mockResolvedValue({ data: [], count: 4218 })
})

describe('useUsersDirectory', () => {
  it('asks the server for one extra row and the right offset', async () => {
    const { result } = renderHook(() => useUsersDirectory(params({ page: 2, search: 'ada', verified: 'verified', specialty: 'pharm' })), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callAdminAuth).toHaveBeenCalledWith('list_user_profiles', { search: 'ada', verified: 'verified', specialty: 'pharm', limit: USERS_PAGE_SIZE + 1, offset: 2 * USERS_PAGE_SIZE })
  })

  it('hasNext is true only when the extra row came back, and it is trimmed off', async () => {
    callAdminAuth.mockResolvedValue({ data: rowsOf(USERS_PAGE_SIZE + 1) })
    const { result } = renderHook(() => useUsersDirectory(params()), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.hasNext).toBe(true)
    expect(result.current.data.rows).toHaveLength(USERS_PAGE_SIZE)
  })

  it('hasNext is false on a short page', async () => {
    const { result } = renderHook(() => useUsersDirectory(params()), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.hasNext).toBe(false)
    expect(result.current.data.rows).toHaveLength(3)
  })

  it('gives the grand total only when no filter is active', async () => {
    const a = renderHook(() => useUsersDirectory(params()), { wrapper: createWrapper() })
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true))
    expect(a.result.current.data.total).toBe(4218)
    expect(query).toHaveBeenCalledWith('profiles', { select: 'id', count: 'head' })

    const b = renderHook(() => useUsersDirectory(params({ search: 'ada' })), { wrapper: createWrapper() })
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true))
    expect(b.result.current.data.total).toBeNull()
  })

  it('a failed list is an error, not an empty list', async () => {
    callAdminAuth.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useUsersDirectory(params()), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('a failed count does not fail the list', async () => {
    query.mockRejectedValue(new Error('count down'))
    const { result } = renderHook(() => useUsersDirectory(params()), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.total).toBeNull()
    expect(result.current.data.rows).toHaveLength(3)
  })

  it('treats a response without a list as an error', async () => {
    callAdminAuth.mockResolvedValue({})
    const { result } = renderHook(() => useUsersDirectory(params()), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
```

If `createWrapper` is not exported by `renderWithQueryClient.jsx`, read that file and use whatever it exports for a query-client wrapper (add a small local wrapper in the test if it only exports a render helper).

- [ ] **Step 2: Run, expect FAIL** (module missing).
- [ ] **Step 3: Implement**

```js
import { useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'
import { adminTransport } from '../repositories/transport'

export const USERS_PAGE_SIZE = 25

// One page of the user directory, filtered on the server. limit+1 rows are
// requested so a next page can be detected without a total (the server returns
// no count). A failed list rejects; it is never shown as an empty directory.
async function loadUsers({ search, verified, specialty, page }) {
  const res = await callAdminAuth('list_user_profiles', {
    search, verified, specialty, limit: USERS_PAGE_SIZE + 1, offset: page * USERS_PAGE_SIZE,
  })
  if (!Array.isArray(res?.data)) throw new Error('list_user_profiles returned no list')
  const hasNext = res.data.length > USERS_PAGE_SIZE

  let total = null
  const unfiltered = !search && !specialty && verified === 'all'
  if (unfiltered) {
    try {
      const r = await adminTransport.query('profiles', { select: 'id', count: 'head' })
      total = typeof r.count === 'number' ? r.count : null
    } catch { total = null }
  }
  return { rows: res.data.slice(0, USERS_PAGE_SIZE), hasNext, total }
}

export function useUsersDirectory(params) {
  return useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: () => loadUsers(params),
    placeholderData: (prev) => prev,
  })
}
```

(`placeholderData` keeps the previous page on screen while the next loads; this requires @tanstack/react-query v5 — check `apps/carefind/package.json`; on v4 use `keepPreviousData: true`.)

- [ ] **Step 4: Run, expect PASS (7 tests).** Commit `feat(carefind): useUsersDirectory, server-side search and paging for users`.

---

### Task 3: useBusinessesDirectory

**Files:**
- Create: `ADM/hooks/useBusinessesDirectory.js`, `ADM/hooks/useBusinessesDirectory.test.jsx`

**Interfaces:**
- Consumes: `adminTransport`, `likeContains` (`../repositories/transport`).
- Produces: `BUSINESSES_PAGE_SIZE = 25`; `useBusinessesDirectory({ search, type, status, location, page })` with `data = { rows, hasNext, total }`; key `['admin','businesses',{...}]`. `total` is the exact filtered count (`count: 'exact'`), `null` if the server returned none. Filters: `search` → `{ op:'ilike', col:'name', val: likeContains(search) }`; `type !== 'all'` → `{ op:'eq', col:'business_type', val:type }`; `status === 'claimed'` → `{ op:'eq', col:'visible_on_carefind', val:true }`, `'unclaimed'` → `val:false`; `location` → `{ op:'or', terms:[{col:'state', contains:location},{col:'city', contains:location}] }`. Select `'id, name, business_type, city, state, whatsapp, visible_on_carefind, created_at'`, order `created_at` descending, `limit = PAGE_SIZE + 1`, `offset = page * PAGE_SIZE`.

- [ ] **Step 1: Failing test**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createWrapper } from '../../../test/renderWithQueryClient.jsx'

const query = vi.hoisted(() => vi.fn())
vi.mock('../repositories/transport', async () => {
  const actual = await vi.importActual('../repositories/transport')
  return { ...actual, adminTransport: { query } }
})

import { useBusinessesDirectory, BUSINESSES_PAGE_SIZE } from './useBusinessesDirectory'

const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: `b${i}` }))
const p = (o = {}) => ({ search: '', type: 'all', status: 'all', location: '', page: 0, ...o })
const run = async (params) => {
  const hook = renderHook(() => useBusinessesDirectory(params), { wrapper: createWrapper() })
  await waitFor(() => expect(hook.result.current.isSuccess || hook.result.current.isError).toBe(true))
  return hook.result.current
}

beforeEach(() => query.mockReset().mockResolvedValue({ data: rowsOf(3), count: 312 }))

describe('useBusinessesDirectory', () => {
  it('queries businesses with an exact count, limit+1 and the page offset', async () => {
    await run(p({ page: 1 }))
    expect(query).toHaveBeenCalledWith('businesses', expect.objectContaining({
      count: 'exact', limit: BUSINESSES_PAGE_SIZE + 1, offset: BUSINESSES_PAGE_SIZE,
      order: { column: 'created_at', ascending: false },
    }))
  })

  it('sends no filters when nothing is selected', async () => {
    await run(p())
    expect(query.mock.calls[0][1].filters).toEqual([])
  })

  it('builds the name, type, status and location filters', async () => {
    await run(p({ search: 'garki', type: 'pharmacy', status: 'unclaimed', location: 'abuja' }))
    expect(query.mock.calls[0][1].filters).toEqual([
      { op: 'ilike', col: 'name', val: '%garki%' },
      { op: 'eq', col: 'business_type', val: 'pharmacy' },
      { op: 'eq', col: 'visible_on_carefind', val: false },
      { op: 'or', terms: [{ col: 'state', contains: 'abuja' }, { col: 'city', contains: 'abuja' }] },
    ])
  })

  it('claimed means visible_on_carefind = true', async () => {
    await run(p({ status: 'claimed' }))
    expect(query.mock.calls[0][1].filters).toContainEqual({ op: 'eq', col: 'visible_on_carefind', val: true })
  })

  it('escapes the search term as a LIKE pattern', async () => {
    await run(p({ search: '50%' }))
    expect(query.mock.calls[0][1].filters[0].val).toBe('%50\\%%')
  })

  it('trims the extra row, reports hasNext, and exposes the exact filtered total', async () => {
    query.mockResolvedValue({ data: rowsOf(BUSINESSES_PAGE_SIZE + 1), count: 312 })
    const r = await run(p())
    expect(r.data.hasNext).toBe(true)
    expect(r.data.rows).toHaveLength(BUSINESSES_PAGE_SIZE)
    expect(r.data.total).toBe(312)
  })

  it('a failed query is an error, not an empty list', async () => {
    query.mockRejectedValue(new Error('rls'))
    const r = await run(p())
    expect(r.isError).toBe(true)
    expect(r.data).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**

```js
import { useQuery } from '@tanstack/react-query'
import { adminTransport, likeContains } from '../repositories/transport'

export const BUSINESSES_PAGE_SIZE = 25

const COLUMNS = 'id, name, business_type, city, state, whatsapp, visible_on_carefind, created_at'

function filtersFor({ search, type, status, location }) {
  const filters = []
  if (search) filters.push({ op: 'ilike', col: 'name', val: likeContains(search) })
  if (type && type !== 'all') filters.push({ op: 'eq', col: 'business_type', val: type })
  if (status === 'claimed') filters.push({ op: 'eq', col: 'visible_on_carefind', val: true })
  else if (status === 'unclaimed') filters.push({ op: 'eq', col: 'visible_on_carefind', val: false })
  if (location) filters.push({ op: 'or', terms: [{ col: 'state', contains: location }, { col: 'city', contains: location }] })
  return filters
}

// One page of the business directory, filtered on the server. A failed query
// rejects; it is never shown as an empty directory.
async function loadBusinesses(params) {
  const { data, count } = await adminTransport.query('businesses', {
    select: COLUMNS,
    filters: filtersFor(params),
    order: { column: 'created_at', ascending: false },
    limit: BUSINESSES_PAGE_SIZE + 1,
    offset: params.page * BUSINESSES_PAGE_SIZE,
    count: 'exact',
  })
  return {
    rows: data.slice(0, BUSINESSES_PAGE_SIZE),
    hasNext: data.length > BUSINESSES_PAGE_SIZE,
    total: typeof count === 'number' ? count : null,
  }
}

export function useBusinessesDirectory(params) {
  return useQuery({
    queryKey: ['admin', 'businesses', params],
    queryFn: () => loadBusinesses(params),
    placeholderData: (prev) => prev,
  })
}
```

(Same react-query v4/v5 note as Task 2.)

- [ ] **Step 4: Run, expect PASS (7 tests).** Commit `feat(carefind): useBusinessesDirectory, server-side search and paging for businesses`.

---

### Task 4: useUserActions

**Files:**
- Create: `ADM/hooks/useUserActions.js`, `ADM/hooks/useUserActions.test.jsx`

**Interfaces:**
- Consumes: `useAdmin()` → `showToast`, `invalidateAdmin`, `recordAction`; `callAdminAuth`.
- Produces: `useUserActions()` returns `{ busy, verifyUser({ id, specialty }), suspendUser({ id, days }), deleteUser({ id, name }) }`, each resolving `{ ok: true }` or `{ ok: false, error }`. Success invalidates and toasts (`'User verified'`, `` `User suspended for ${days} days` ``, `'User deleted'`); failure toasts nothing and invalidates nothing. `verifyUser` with an empty/whitespace specialty resolves `{ ok: false, error: 'Enter a specialty' }` without calling the server. Audit writes (non-blocking, same as legacy): suspend `('suspend','user',id,{days})`, delete `('delete','user',id,{name})`; verify has no audit (as legacy; finding 35). `recordAction` is not called (legacy did not).

- [ ] **Step 1: Failing test**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const callAdminAuth = vi.hoisted(() => vi.fn())
const admin = vi.hoisted(() => ({ showToast: vi.fn(), invalidateAdmin: vi.fn(), recordAction: vi.fn() }))
vi.mock('../adminApi', () => ({ callAdminAuth }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import { useUserActions } from './useUserActions'

const run = async (fn) => { let out; await act(async () => { out = await fn() }); return out }
beforeEach(() => {
  callAdminAuth.mockReset().mockResolvedValue({})
  Object.values(admin).forEach(f => f.mockReset())
})

describe('useUserActions', () => {
  it('verifies with the legacy payload and refreshes', async () => {
    const { result } = renderHook(() => useUserActions())
    const out = await run(() => result.current.verifyUser({ id: 'u1', specialty: 'Pharmacist' }))
    expect(out).toEqual({ ok: true })
    expect(callAdminAuth).toHaveBeenCalledWith('manual_verify', { userId: 'u1', specialty: 'Pharmacist' })
    expect(admin.invalidateAdmin).toHaveBeenCalled()
    expect(admin.showToast).toHaveBeenCalledWith('User verified', { type: 'success' })
  })

  it('refuses a blank specialty without calling the server', async () => {
    const { result } = renderHook(() => useUserActions())
    const out = await run(() => result.current.verifyUser({ id: 'u1', specialty: '   ' }))
    expect(out).toEqual({ ok: false, error: 'Enter a specialty' })
    expect(callAdminAuth).not.toHaveBeenCalled()
  })

  it('suspends with the legacy payload, audits it and toasts the days', async () => {
    const { result } = renderHook(() => useUserActions())
    await run(() => result.current.suspendUser({ id: 'u1', days: '7' }))
    expect(callAdminAuth).toHaveBeenCalledWith('suspend_user', { userId: 'u1', days: '7' })
    expect(callAdminAuth).toHaveBeenCalledWith('log_audit_action', expect.objectContaining({ auditAction: 'suspend', targetType: 'user', targetId: 'u1', metadata: { days: '7' } }))
    expect(admin.showToast).toHaveBeenCalledWith('User suspended for 7 days', { type: 'success' })
  })

  it('deletes with the legacy payload and audits the name', async () => {
    const { result } = renderHook(() => useUserActions())
    await run(() => result.current.deleteUser({ id: 'u1', name: 'Ada Obi' }))
    expect(callAdminAuth).toHaveBeenCalledWith('delete_user', { userId: 'u1' })
    expect(callAdminAuth).toHaveBeenCalledWith('log_audit_action', expect.objectContaining({ auditAction: 'delete', targetType: 'user', targetId: 'u1', metadata: { name: 'Ada Obi' } }))
    expect(admin.showToast).toHaveBeenCalledWith('User deleted', { type: 'success' })
  })

  it('returns the error and neither toasts nor refreshes on failure', async () => {
    callAdminAuth.mockRejectedValueOnce(new Error('Not allowed'))
    const { result } = renderHook(() => useUserActions())
    const out = await run(() => result.current.deleteUser({ id: 'u1', name: 'Ada' }))
    expect(out).toEqual({ ok: false, error: 'Not allowed' })
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
    expect(admin.showToast).not.toHaveBeenCalled()
  })

  it('a failing audit write does not fail the action', async () => {
    callAdminAuth.mockImplementation(async (a) => { if (a === 'log_audit_action') throw new Error('audit down'); return {} })
    const { result } = renderHook(() => useUserActions())
    const out = await run(() => result.current.suspendUser({ id: 'u1', days: '1' }))
    expect(out.ok).toBe(true)
  })

  it('busy is the id being acted on and clears afterwards', async () => {
    let release
    callAdminAuth.mockImplementation(() => new Promise(r => { release = r }))
    const { result } = renderHook(() => useUserActions())
    let pending
    act(() => { pending = result.current.deleteUser({ id: 'u9', name: 'X' }) })
    expect(result.current.busy).toBe('u9')
    await act(async () => { release({}); await pending })
    expect(result.current.busy).toBeNull()
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**

```js
import { useCallback, useState } from 'react'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../provider/AdminProvider.jsx'

// The user actions that used to live in LegacyTabHost, calling the same server
// actions with the same payloads. Each resolves { ok } or { ok: false, error }
// so the drawer can show a failure where the admin is looking; success toasts
// and refreshes the lists.

async function audit(auditAction, targetType, targetId, metadata = {}) {
  try {
    await callAdminAuth('log_audit_action', { auditAction, targetType, targetId, metadata })
  } catch { /* an audit failure must not block the action */ }
}

export function useUserActions() {
  const { showToast, invalidateAdmin } = useAdmin()
  const [busy, setBusy] = useState(null)

  const run = useCallback(async ({ id, action, payload, auditAs, metadata, success }) => {
    setBusy(id)
    try {
      await callAdminAuth(action, payload)
      if (auditAs) audit(auditAs[0], auditAs[1], id, metadata)
      invalidateAdmin()
      showToast(success, { type: 'success' })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    } finally {
      setBusy(null)
    }
  }, [showToast, invalidateAdmin])

  const verifyUser = ({ id, specialty }) => {
    if (!specialty || !specialty.trim()) return Promise.resolve({ ok: false, error: 'Enter a specialty' })
    return run({ id, action: 'manual_verify', payload: { userId: id, specialty }, success: 'User verified' })
  }
  const suspendUser = ({ id, days }) => run({
    id, action: 'suspend_user', payload: { userId: id, days },
    auditAs: ['suspend', 'user'], metadata: { days }, success: `User suspended for ${days} days`,
  })
  const deleteUser = ({ id, name }) => run({
    id, action: 'delete_user', payload: { userId: id },
    auditAs: ['delete', 'user'], metadata: { name }, success: 'User deleted',
  })

  return { busy, verifyUser, suspendUser, deleteUser }
}
```

- [ ] **Step 4: Run, expect PASS (7 tests).** Commit `feat(carefind): useUserActions, verify/suspend/delete moved out of LegacyTabHost`.

---

### Task 5: DirectoryTable

**Files:**
- Create: `ADM/ui/DirectoryTable.jsx`, `ADM/ui/DirectoryTable.test.jsx`

**Interfaces:**
- Consumes: shared `DataTable`, `Button`, `Empty` from the design system.
- Produces: `<DirectoryTable>` with props: `title` (h1), `noun` (`'user'` or `'business'`, for copy), `query` (the react-query result: `{ data: { rows, hasNext, total }, isLoading, isError, refetch }`), `columns`, `search`, `onSearch(text)` (called debounced 300 ms after typing stops; the input itself is uncontrolled-local and re-syncs when `search` changes to '' from outside), `searchPlaceholder`, `filters` (node, the filter row), `filtersActive` (boolean), `onClear`, `page`, `onPage(n)`, `pageSize`, `renderDrawer(row, { close, setError })` → `{ title, status?, body, footer }`, `toolbar` (optional node, e.g. Export), `rowLabel(row)` (accessible name for the Review button). Behaviour:
  - h1 once; count line: `total != null` → `{total} {noun}s`; else `{rows.length} shown`; while loading no count.
  - loading → DataTable `loading`; `isError` → DataTable `error="Couldn't load this list."` with `onRetry={refetch}` (never the empty text); empty → `filtersActive ? "No {noun}s match these filters" + Clear filters button : "No {noun}s yet"`.
  - Previous disabled on page 0; Next disabled unless `data.hasNext`.
  - Row click and a per-row `Review {rowLabel(row)}` button open `ReviewDrawer` (`ui/ReviewDrawer.jsx`); the drawer closes if its row leaves the page; `preventClose={useAdmin().confirming}` (as Phase 2a).

- [ ] **Step 1: Failing test** `DirectoryTable.test.jsx` (mock `useAdmin` as `{ confirming: false }`; use fake timers for the debounce). Cases (write them out in full, in the style of `ReviewQueue.test.jsx`):
  1. one h1; rows render; count shows `4218 users` when `total` is set and `3 shown` when null.
  2. typing in the search box calls `onSearch` only after 300 ms with the typed text (use `vi.useFakeTimers()`; advance 299 → not called; advance 1 → called once with the final text, after several keystrokes).
  3. `isError` shows Retry (calls `refetch`) and does NOT show "No users match" or "No users yet".
  4. empty + `filtersActive` shows "No users match these filters" and a Clear filters button that calls `onClear`; empty + not active shows "No users yet".
  5. `isLoading` shows no count and no empty text.
  6. Previous disabled on page 0 and calls `onPage(page - 1)` otherwise; Next disabled when `hasNext` is false, calls `onPage(page + 1)` when true.
  7. clicking `Review Ada` opens a dialog with the drawer title, body and footer from `renderDrawer`; Close closes it.
  8. the drawer closes when its row disappears from `data.rows` on re-render.
  9. Escape while `useAdmin().confirming` is true leaves the drawer open (mock `confirming: true`); with `confirming: false` it closes.

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `DirectoryTable.jsx`. Reuse the page/head/tab/note classes from `ui/admin.css` (`adm-page`, `adm-head`, `adm-note`, `adm-btn-reset`); add `.adm-dir-bar` (flex, wrap, gap 12, margin-bottom 12), `.adm-dir-search` (min-height 44, full width up to 420px) and `.adm-dir-pager` (flex, gap 8, justify end, margin-top 12) to the end of `admin.css`, using the real `--adm-*` tokens defined at its top. Debounce with `useEffect` + `setTimeout(300)` on a local `text` state; skip calling `onSearch` when `text === search`; when `search` becomes `''` from outside (Clear filters) reset `text`. Compose the table, drawer and pager as in `ReviewQueue.jsx` (read it first and mirror its open-row handling, close-on-missing-row effect gated on loaded data, and `preventClose`).
- [ ] **Step 4: Run, expect PASS.** Commit `feat(carefind): DirectoryTable with server paging, debounced search and honest states`.

---

### Task 6: UsersSection

**Files:**
- Create: `ADM/sections/UsersSection.jsx`, `ADM/sections/UsersSection.test.jsx`

**Interfaces:**
- Consumes: `useUsersDirectory`, `USERS_PAGE_SIZE`; `useUserActions`; `useTrustQueues` (for `phoneMap` from `verifications.data`: `{ [v.user_id]: v.phone }`); `useAdmin()` → `adminUser`, `askConfirm`; `callAdminAuth('get_user_posts', { userId, limit: 3 })` via `useQuery(['admin','user-posts', id])`; `DirectoryTable`; `exportCSV`, `timeAgo`, `FilterPills` from `../ui`; `Input`, `Button`, `StatusBadge` from the design system.
- Produces: `<UsersSection />` (default export).

Behaviour:
- Local state `{ search, verified: 'all', specialty: '', page: 0 }`; any change to search/verified/specialty sets `page` to 0. Specialty text is debounced the same way as search (reuse a tiny `useDebounced(value, 300)` helper defined in this file or in `DirectoryTable.jsx` and exported).
- `filtersActive = !!(search || specialty || verified !== 'all')`; `onClear` resets all.
- Filters node: `FilterPills` (All / Verified / Unverified) and an `Input` labelled "Specialty".
- Toolbar: `Export this page (CSV)` button calling `exportCSV(rows, 'users_page.csv')` (disabled with no rows).
- Columns: Name (avatar initial, `full_name || display_name || 'No name'`, `@display_name` beneath), Title (`verification_label || '—'`), Location, Verified (`StatusBadge status="confirmed"` when verified else '—'), Joined (`timeAgo`, sortable).
- Review label: the user's display name.
- Drawer (`title` = name, `status` = verified ? 'confirmed' : undefined): details grid (User ID first 16 chars, Title, Specialty, Location, Verified, Joined date); phone `Call` link (`tel:`) only when `phoneMap[id]`; `Website` link when set; the 3 most recent posts with an inline "Couldn't load posts" message on failure (never "0 posts") and "No posts yet" when empty; footer (never for `id === adminUser.id` for Delete):
  - Verify: shown when not verified; clicking reveals an `Input` "Specialty" and a "Verify" button that calls `verifyUser({ id, specialty })`; a blank specialty shows the returned error inline.
  - Suspend: a `<select aria-label="Suspend duration">` (1, 3, 7, 14, 30, 365 days; default 7) and a "Suspend" button that calls `askConfirm({ title: 'Suspend this user?', consequence: `${name} will not be able to use CareFind for ${days} day(s).`, confirmLabel: 'Suspend', action })`, where the action calls `suspendUser`. Verify the consequence wording against the `suspend_user` handler in `apps/carefind/api/_handlers/admin-auth.js` (~line 246) and state only what it does.
  - Delete: "Delete account" (hidden when `id === adminUser?.id`), `askConfirm({ title: 'Delete this user?', consequence: `This permanently deletes ${name}'s account and all their posts, comments, and content. This cannot be undone.`, confirmLabel: 'Delete', action })` (the legacy text) calling `deleteUser({ id, name })`.
  - Every action: on `{ ok: true }` close the drawer; on `{ ok: false, error }` call `setError(error)` and leave the drawer open (unlike legacy, which closed it on failure).

- [ ] **Step 1: Failing test** `UsersSection.test.jsx`. Mock `../hooks/useUsersDirectory` (keep `USERS_PAGE_SIZE` via `importActual`; the mocked hook records its params and returns a settable result), `../hooks/useUserActions`, `../hooks/useTrustQueues`, `../provider/AdminProvider.jsx` (`{ adminUser: { id: 'a1' }, askConfirm, confirming: false }`), `../adminApi` (`callAdminAuth` for `get_user_posts`). Write in full (fake timers for debounced inputs; `renderWithQueryClient` because the section uses `useQuery` for posts):
  1. one h1 "Users"; rows render; a verified user shows the badge; the count line uses `total`.
  2. typing in search and waiting 300 ms changes the hook params (`search`, `page: 0`); after paging to page 2, changing a filter resets `page` to 0.
  3. the Verified pill sets `verified: 'verified'`; the Specialty input (debounced) sets `specialty`.
  4. failed list → Retry, no "No users match".
  5. Export button is labelled "Export this page (CSV)", is disabled with no rows, and (with rows) is enabled and renders its icon (regression from the old UsersTab test: the tab must not crash on render).
  6. drawer: details, Call link only when the phone is known, posts section shows 3 posts; when `get_user_posts` rejects it shows "Couldn't load posts" and never "0".
  7. Verify: with a blank specialty the inline error shows and `verifyUser` is not satisfied (called with blank returns the error); with "Pharmacist" it calls `verifyUser({ id, specialty: 'Pharmacist' })` and closes on success.
  8. Suspend asks `askConfirm` (title "Suspend this user?", `confirmLabel: 'Suspend'`); `suspendUser` is not called until the confirm `action` runs, then it is called with `{ id, days: '7' }`; changing the select to 30 sends '30'.
  9. Delete asks `askConfirm` with the legacy consequence text and `confirmLabel: 'Delete'`; `deleteUser({ id, name })` runs only when the action runs; on `{ ok: false, error }` the drawer stays open and shows the error in `role="alert"`.
  10. Delete account is not rendered when the open user is the signed-in admin (`id === adminUser.id`); Suspend and Verify still are.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** per the behaviour above, mirroring `VerificationsSection.jsx`'s `renderDrawer`/`finish` pattern (read it first). Export `UserBody` ({ u, phone, posts… }) as a named export only if it keeps the file readable; do not add exports nothing imports.
- [ ] **Step 4: Run, expect PASS.** Commit `feat(carefind): Users section with server-side search, paging and a detail drawer`.

---

### Task 7: BusinessesSection

**Files:**
- Create: `ADM/sections/BusinessesSection.jsx`, `ADM/sections/BusinessesSection.test.jsx`

**Interfaces:**
- Consumes: `useBusinessesDirectory`; `feedConfigRepository.getBusinessReviews(id)` and `.getBusinessProducts(id)` (both throw on error) via `useQuery(['admin','business-reviews', id])` and `(['admin','business-products', id])`; `DirectoryTable`; `FilterPills`, `exportCSV`, `timeAgo` from `../ui`; `Input`, `StatCard` from the design system.
- Produces: `<BusinessesSection />`.

Behaviour:
- State `{ search, type: 'all', status: 'all', location: '', page: 0 }`, any change resets `page` to 0; search and location debounced 300 ms (reuse the helper from Task 6/5). `filtersActive` and `onClear` as in Users.
- Filters: `FilterPills` for type (`all, pharmacy, hospital, clinic, dental, optical, wellness, skincare`), `FilterPills` for status (All / Claimed / Unclaimed), `Input` "State or city".
- Toolbar: `Export this page (CSV)`.
- Columns: Name, Type (capitalised), Location (`city, state`), Status (`Claimed` when `visible_on_carefind` else `Unclaimed`; text, not colour alone), Added (`timeAgo`, sortable). Review label: the business name.
- Drawer (`title` = name): details grid (Type, Location, WhatsApp when set, Added date, Status); three `StatCard`s (Reviews, Products, Avg rating) each with their own loading ("…"), failed ("Couldn't load", never 0) and loaded states; reviews list (stars, comment; "No reviews yet" when empty; "Couldn't load reviews" on failure); `Export company data CSV` button (disabled until both loaded) exporting `[...reviews, ...products]` as `${name}_data.csv`. No footer actions (the legacy tab had none).

- [ ] **Step 1: Failing test** `BusinessesSection.test.jsx`. Mock `../hooks/useBusinessesDirectory`, `../repositories/feedConfigRepository`, `../provider/AdminProvider.jsx` (`{ confirming: false }`). Cases (write in full):
  1. one h1 "Businesses"; rows render with Claimed/Unclaimed text; count uses the exact `total`.
  2. each filter (search debounced, type pill, status pill, location debounced) changes the hook params and resets `page` to 0.
  3. failed list shows Retry and not "No businesses match".
  4. empty with filters → "No businesses match these filters" + Clear filters (resets params); empty without → "No businesses yet".
  5. drawer shows details; reviews and products load: stats show counts and the average rating to one decimal; with no reviews the average shows "N/A".
  6. products load fails → the Products card shows "Couldn't load" (not 0) while reviews still render; reviews fail → "Couldn't load reviews".
  7. Export company data is disabled until both loads finish; clicking it calls `exportCSV` path (mock `exportCSV` from `../ui` via `vi.mock('../ui', async ...)` or spy on `URL.createObjectURL`) with the filename `${name}_data.csv`.
  8. opening a second business shows its own data, not the first's.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** per the behaviour above (mirror Task 6's structure; no drawer footer).
- [ ] **Step 4: Run, expect PASS.** Commit `feat(carefind): Businesses section with server-side search, paging and a detail drawer`.

---

### Task 8: Wire the sections and retire the legacy code

**Files:**
- Modify: `ADM/AdminPanel.jsx`, `ADM/legacy/LegacyTabHost.jsx`
- Delete: `ADM/tabs/UsersTab.jsx`, `ADM/tabs/UsersTab.test.jsx`, `ADM/tabs/BusinessesTab.jsx`
- Modify: `ADM/AdminPanel.sections.test.jsx` (add `users` and `businesses` to the routed/hidden cases, in the existing style)

- [ ] **Step 1: AdminPanel.** Import `UsersSection` and `BusinessesSection`; in `ActiveSection`, after the `isAllowed` check and with the Phase 2a branches, add `if (tab === 'users') return <UsersSection />` and `if (tab === 'businesses') return <BusinessesSection />`. The `isAllowed(permissions, tab)` check must stay first.
- [ ] **Step 2: LegacyTabHost.** Delete ONLY what is now dead: the two tab imports and render lines; the state `userSearch, userVerifiedFilter, userSpecialtyFilter, selectedUser, suspendDays, userPosts, deletingUser, verifyingUser, verifySpecialty, bizSearch, bizTypeFilter, bizStateFilter, bizStatusFilter, selectedBiz, bizReviews, bizProducts`; the handlers `viewUserDetails`, `suspendUser`, `deleteUser`, `reallyDeleteUser`, `manualVerify`. KEEP `users`, `businesses`, `phoneMap` (still passed to GoLive and others), `deletePost`/`reallyDeletePost` (PostsTab), `logAuditAction`, `usersRepository` only if still used. After deleting, grep LegacyTabHost.jsx for every removed identifier and every now-unused import; anything still used stays. Check `supabase` is still needed elsewhere before touching its import.
- [ ] **Step 3: Delete the three old files**, then `grep -rn "UsersTab\|BusinessesTab" apps/carefind/src` and fix any remaining importer (report what you changed).
- [ ] **Step 4: Extend `AdminPanel.sections.test.jsx`** so that `users` and `businesses` route to their sections and fall back to the Overview when their permission is false.
- [ ] **Step 5: Verify**: `npx vitest run src/modules/admin` (green), then `npm run build` and `npm run lint` from `apps/carefind` (build succeeds, 0 lint errors). Scan every touched file for un-imported JSX components.
- [ ] **Step 6: Commit** `refactor(carefind): Users and Businesses leave the legacy host`.

---

### Task 9: Docs, full verification

**Files:**
- Modify: `docs/ADMIN_REDESIGN.md` (docs only; do not push or open a PR in this task)

- [ ] **Step 1: Phase table:** Phase 2a "built (PR #23)", Phase 2b "built on `feat/carefind-admin-phase2b` (Users, Businesses)"; keep 3-5.
- [ ] **Step 2: Code organisation:** add `ui/DirectoryTable`, `hooks/useUsersDirectory`, `hooks/useBusinessesDirectory`, `hooks/useUserActions`, the `or` filter op in `repositories/transport.js`, `UsersSection`, `BusinessesSection`; note that `users`/`businesses`/`phoneMap` stay in `useAdminData` for Go Live and others.
- [ ] **Step 3: Findings** (same style as 1-28):
  29. Users and Businesses loaded the newest 100 rows and filtered in the browser, so search could not find older rows and the header showed the loaded count. FIXED (server-side search and paging).
  30. `list_user_profiles` interpolates the search term into `.or(...)` in `api/_handlers/admin-auth.js` (~line 606): a comma or parenthesis in the term can change the filter. Backend; documented, not changed. The new businesses filter cannot be injected (Task 1).
  31. `phoneMap` is built only from verification requests, so most users show no Call button.
  32. The Users title filter filtered `verification_label` in the browser while the server filters `specialty`; they never matched. FIXED (the filter is now Specialty).
  33. `BusinessesTab` received an unused raw `supabase` client prop. Removed.
  34. Suspend fired with no confirmation. Added one.
  35. `manual_verify` writes no audit row and no action history, unlike suspend and delete. Kept as legacy; an owner decision.
  36. The legacy delete closed the drawer even when the delete failed. FIXED (it stays open with the error).
- [ ] **Step 4: Verification state:** Phase 2b is covered by unit/component tests (list them); responsive widths are still NOT measured in a browser (no admin session); the server-side `or` clause behaviour against a live PostgREST is unverified (covered only by string-level tests).
- [ ] **Step 5: Full verification from `apps/carefind`:** `npx vitest run` (report file and test totals; takes 10+ minutes, run it once in the background and wait), `npm run build` (AdminPanel chunk size), `npm run lint` (errors/warnings). Do not edit code files; report failures.
- [ ] **Step 6: Commit** `docs(carefind): Phase 2b state and findings 29-36`. Do NOT push or open a PR; the controller does that after the user approves.

---

## Self-review

- **Spec coverage:** `or` op (T1), both directory hooks (T2-T3), user actions (T4), DirectoryTable and its states (T5), per-screen behaviour incl. Suspend confirmation, Specialty filter, export-this-page, Delete hidden for self (T6-T7), legacy retirement and the unchanged `users/businesses/phoneMap` (T8), findings 29-34 plus new 35-36 (T9).
- **Spec deviations called out:** (a) the spec's `or` term shape was `{ col, op, val }`; the plan narrows it to `{ col, contains }` because only substring matching is needed and a narrower op is harder to misuse. (b) Findings 35 (manual verify unaudited) and 36 (legacy delete closed the drawer on failure) were found while planning and are added to the spec's list.
- **Known thin spots:** Task 5, 6 and 7 specify tests as exact cases rather than full code (the Phase 2a lesson: the section tests there were written in full by the implementer in the committed-pattern style, and those tasks needed fix rounds); reviewers should check them closely. Task 1's exact escaped strings must be confirmed against PostgREST's quoting rules; the implementer is told to stop and report if they disagree.
- **Type consistency:** `useUsersDirectory`/`useBusinessesDirectory` both return `data = { rows, hasNext, total }`, matching `DirectoryTable`'s `query` prop; `useUserActions` method names and argument shapes match their use in T6; `likeContains` is exported from T1 and used in T3.
