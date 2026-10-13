# CareFind admin Phase 5b (Teams, staff, roles, Tasks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Teams & Staff (teams, staff accounts, roles and permissions) and Sponsored Tasks out of `legacy/LegacyTabHost.jsx` into redesigned sections that never show a failed or forbidden read as "no members", wire the two existing server actions that had no UI (deactivate/reactivate, change role), and weaken no check.

**Architecture:** Settled-read hooks (`useTeamsData`, `useTasksData`), action hooks (`useStaffActions`, `useTaskActions`) returning `{ok}`/`{ok:false,error}`, a shared `PermissionMatrix`, four small `sections/teams/*` components composed by `TeamsSection`, a `TasksSection`; `AdminPanel` routes `teams` and `tasks`; the legacy host keeps only Shop and Email templates.

**Tech Stack:** React, Vite, vitest (jsdom), @tanstack/react-query v5, `packages/design-system`, `callAdminAuth`.

**Spec:** `docs/superpowers/specs/2026-10-13-carefind-admin-phase5b-design.md` (binding). ADM = `apps/carefind/src/modules/admin/`.

## Global Constraints

- No backend, SQL or auth change. Same `callAdminAuth` actions and payload keys (spec "Scope"); never a `token` field.
- The server enforces `super_admin`; UI hiding is a courtesy and is never presented as security. `AdminPanel`'s `isAllowed` check stays first and unchanged.
- A password is NEVER put in an audit entry, toast, log line, error message, query key or React Query cache. `createStaff` clears the password state on success and on failure.
- `super_admin` is never offered in any role select. A staff member's own row never offers Deactivate.
- A source that fails shows "Couldn't load, Retry", never "No members yet"/"No tasks yet"; "restricted" (non-super viewing staff) is its own state and makes no `list_staff` call.
- Deactivate wording (verified: `requireAdmin` checks `is_active` on every request, sessions are not revoked): "This stops them using the console: every request checks their account is active. Their account and history are kept." Delete role wording (the server only deletes the role row; its effect on staff is unverified): "This permanently deletes the role. Check the access of any staff who have it."
- Tests: `createWrapper` is NOT exported by `src/test/renderWithQueryClient.jsx`; use a local `makeWrapper()` with one `QueryClient` per test. The shared Modal card has `role="button"`: use exact role names and `within(dialog)`. Do not return a mock from a `beforeEach` arrow. ESLint has no React plugin: every JSX component must be imported (scan after writing). Every changed file must be valid UTF-8 (no raw 0x85/Windows-1252 bytes; use `…` as a real character).
- One commit per task; stage and commit in one command with explicit paths; messages end `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Full vitest takes ~17 minutes and is memory heavy; tasks run only focused tests plus `npx vitest run src/modules/admin`.

## Review Focus

- A failed list never reads as empty; "restricted" never calls `list_staff`; a failed refresh of a loaded list keeps it with a "Couldn't refresh" note.
- The password never leaves the form: scan every call to `callAdminAuth`/`showToast`/audit/`console` in `useStaffActions` for it (tests assert).
- `createStaff` for a custom role sends `roleId` AND `newRole` (the role name); a system role sends `newRole` only; email is trimmed and lower-cased; password < 8 never reaches the server.
- Own-row protections (no Deactivate; Change role on own row is also withheld) and that a deactivated staff row is distinguishable (status badge + Reactivate).
- Role matrix: `overview` is always included in the saved tabs (legacy `{ overview: true, ...tabs }`); system roles are read-only; deleting needs confirmation naming the role.
- Double submit: a second click on Create staff / Create role while the first runs is refused (in-flight guard); a result after unmount toasts a failure.
- Tasks compensation: `"abc"`, `0`, `-5`, `12.5` and empty are rejected client-side before any call; a valid value is sent as the original numeric string/number the server `parseInt`s (legacy sent the raw field value).

---

### Task 1: useTeamsData

**Files:**
- Create: `ADM/hooks/useTeamsData.js`, `ADM/hooks/useTeamsData.test.jsx`

**Interfaces:**
- Produces: `useTeamsData({ canSeeStaff })` returning a react-query result whose `data` is `{ teams, roles, staff }`; each of `teams` and `roles` is `{ status:'ok', data, stale? } | { status:'error' }`; `staff` is additionally `{ status:'restricted' }` when `canSeeStaff` is false. Key `['admin','teams', canSeeStaff]`.

- [ ] **Step 1: Failing test.** Mock `../adminApi` `callAdminAuth`. Cases: (a) `canSeeStaff: true` calls `list_teams {}`, `list_admin_roles {}`, `list_staff {}` (no `token` key) and settles each to `{status:'ok', data}` (`teams` from `res.teams`, `staff` from `res.staff`, `roles` from `res.data`); (b) `canSeeStaff: false` never calls `list_staff` and `staff` is `{status:'restricted'}`; (c) one rejected call settles only that source to `{status:'error'}` while the others stay ok; (d) a non-array payload for a source is an error; (e) a failed refresh of a source that last loaded keeps `{status:'ok', data: previous, stale:true}`, a first failure stays `{status:'error'}`, a later success has no `stale` (use `refetch` and read the previous value via `queryClient.getQueryData(key)` as `useLiveShows` does).
- [ ] **Step 2: FAIL. Step 3: implement** following `ADM/hooks/useLiveShows.js` (`settle(promise, previous)` with the stale keep) and the key shape above; the `staff` source resolves `{status:'restricted'}` without a call when `!canSeeStaff`.
- [ ] **Step 4: PASS. Step 5: Commit** `feat(carefind): teams, roles and staff read as independently settled sources`.

---

### Task 2: useStaffActions

**Files:**
- Create: `ADM/hooks/useStaffActions.js`, `ADM/hooks/useStaffActions.test.jsx`

**Interfaces:**
- Consumes: `useAdmin()` (`showToast`, `invalidateAdmin`), `callAdminAuth`, `bestEffort` from `../lib/bestEffort`.
- Produces: `useStaffActions()` -> `{ createTeam, createStaff, toggleStaff, assignRole, createRole, updateRole, deleteRole, isBusy(action, target), busy }`. Every method resolves `{ ok:true }` or `{ ok:false, error }`.
  - `createTeam({ name })` -> `create_team { name: name.trim() }`; blank name -> `{ok:false, error:'Enter a team name'}` with no call.
  - `createStaff({ name, email, password, role, roleId, teamId })` -> `create_staff { newEmail: email.trim().toLowerCase(), newPassword: password, newName: name.trim(), newRole: role, teamId: teamId || null, ...(roleId ? { roleId } : {}) }`; blank name/email or `password.length < 8` or `role === 'super_admin'` -> `{ok:false, error}` with no call.
  - `toggleStaff({ id, isActive })` -> `toggle_staff { staffId: id, isActive }`.
  - `assignRole({ staffId, roleId })` -> `assign_admin_role { staffId, roleId }`.
  - `createRole({ name, description, tabs })` -> `create_admin_role { name: name.trim(), description: description || '', carefindTabs: { overview: true, ...tabs } }`; blank name -> error, no call.
  - `updateRole({ roleId, description, tabs })` -> `update_admin_role { roleId, carefindTabs: { overview: true, ...tabs }, ...(description !== undefined ? { description } : {}) }`.
  - `deleteRole({ roleId })` -> `delete_admin_role { roleId }`.
  - Audit via `callAdminAuth('log_audit_action', { auditAction, targetType, targetId, metadata })`, inside `bestEffort`, after success only: `create_team` (`admin_team`, name), `create_staff` (`admin_user`, target = email; metadata `{ role, teamId, customRole: !!roleId }` — NEVER the password or name), `toggle_staff` (`admin_user`, id; `{ isActive }`), `assign_role` (`admin_user`, staffId; `{ roleId }`), `create_role` (`admin_role`, name; `{ tabs: sorted enabled keys }`), `update_role`, `delete_role` (`admin_role`, roleId).
  - Refresh once via `invalidateAdmin` and toast once on success (`Team created`, `Staff account created`, `Staff member deactivated`/`reactivated`, `Role changed`, `Role created`, `Role updated`, `Role deleted`), all through `bestEffort`; per-key in-flight guard (`${action}:${target ?? ''}`; a repeat resolves `{ok:false, error:'Already running'}` with no call); the key is held until the refresh resolves, capped at 10 s (copy the mechanism from `ADM/hooks/useLiveActions.js`: `capped(bestEffort(...), ms)` in `finally`).
- [ ] **Step 1: Failing test.** Cases, written in full: each action's exact payload; email trimmed+lower-cased; custom role sends `roleId` and `newRole`, system role sends no `roleId`; `password` of 7 characters, blank name/email, `super_admin` and blank team/role names make NO server call and return `{ok:false}`; a rejected call returns `{ok:false, error: message}` and neither toasts success, audits nor refreshes; a rejecting audit or refresh still returns `{ok:true}`; the password string appears in NO argument of any `callAdminAuth` call except the `create_staff` call itself, and in no `showToast` call (assert by serialising all mock calls); a repeated key is refused; the key is released after the refresh (and after the 10 s cap with fake timers); `deleteRole` payload has only `roleId`; matrix tabs always include `overview: true`.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: Commit** `feat(carefind): staff, team and role actions with audit and an in-flight guard`.

---

### Task 3: useTasksData and useTaskActions

**Files:**
- Create: `ADM/hooks/useTasksData.js`, `ADM/hooks/useTasksData.test.jsx`

**Interfaces:**
- Produces: `useTasksData(enabled = true)` -> react-query result, key `['admin','tasks']`, `data` = array from `dashboardRepository.getTasks()`; non-array or rejection is an error (never `[]`). `useTaskActions()` -> `{ createTask({ title, description, compensation, specialty }), busy }` resolving `{ok}`/`{ok:false,error}`; validation before any call: title and description non-blank, `compensation` a positive whole number (`/^\d+$/` after trim and `> 0`) else `{ok:false, error:'Enter a positive whole-number compensation'}`; payload `create_task { title: title.trim(), description: description.trim(), compensation: String(compensation).trim(), specialty: specialty?.trim() || null }`; success toasts `Task created`, refreshes once via `invalidateAdmin`; a repeat while running is refused.
- [ ] **Step 1: Failing test** covering the above, including `"abc"`, `"0"`, `"-5"`, `"12.5"`, `""` rejected without a call; failure returns `{ok:false,error}`; a failed list is an error.
- [ ] **Step 2: FAIL. Step 3: implement** (`dashboardRepository` is imported as in `useAlerts.js`). **Step 4: PASS. Step 5: Commit** `feat(carefind): tasks list and create with validation`.

---

### Task 4: PermissionMatrix

**Files:**
- Create: `ADM/ui/PermissionMatrix.jsx`, `ADM/ui/PermissionMatrix.test.jsx`
- Modify: `ADM/ui/admin.css` (small classes)

**Interfaces:**
- Produces: `<PermissionMatrix value={tabsObject} onChange={next => ...} disabled label />` — a `fieldset` with a `legend` (the `label`), one checkbox per assignable section grouped by `NAV_GROUPS` from `../navigation` (skip `overview`, which is implicit and shown as a fixed, disabled "Dashboard — always included" note); checkbox accessible name = the section label; `onChange` receives a new object (never mutates `value`); `disabled` disables all; read-only view lists the enabled sections as text when `disabled`.
- [ ] **Step 1: Failing test:** one checkbox per non-overview item with the right labels and grouping headings; toggling calls `onChange` with a new object including the toggle and keeping the others; `value` never mutated; `disabled` disables every checkbox; unknown keys in `value` are preserved on change; accessible fieldset name.
- [ ] **Step 2: FAIL. Step 3: implement** (CSS classes `adm-matrix*`, tokens only, wraps on narrow widths). **Step 4: PASS. Step 5: Commit** `feat(carefind): shared section-permission checkbox grid`.

---

### Task 5: Teams list and staff directory (read side + deactivate / change role)

**Files:**
- Create: `ADM/sections/teams/TeamsPanel.jsx`, `ADM/sections/teams/StaffDirectory.jsx`, and a `.test.jsx` for each

**Interfaces:**
- `<TeamsPanel teams staff onCreateTeam />` where `teams`/`staff` are the settled sources from Task 1; create-team form (name required, button disabled while running via `useStaffActions().createTeam`, inline `role="alert"` error, clears on success); each team lists its members (name, role, status badge) — "No members yet" only when `staff.status === 'ok'` and the team has none; `staff` error -> "Couldn't load staff" + Retry (prop `onRetry`), `restricted` -> "Only a super admin can see staff accounts".
- `<StaffDirectory staff roles currentAdminId onRetry />` uses `DirectoryTable` (as `PostsSection`) or a plain accessible table if paging is unneeded (judgement: staff are few, no paging — use the shared `DataTable`); columns name, email, role, team, status (`StatusBadge` active/suspended), last sign-in (`timeAgo`, "—" when none); row opens a `ReviewDrawer`-style drawer (see `ADM/ui/ReviewDrawer.jsx`) with: details; **Deactivate/Reactivate** (not on `currentAdminId`'s own row) -> `askConfirm({ title: 'Deactivate <name>?', consequence: <Global Constraints wording>, confirmLabel: 'Deactivate', action })` -> `toggleStaff({ id, isActive:false })`; Reactivate confirms "Reactivate <name>?" with "This lets them use the console again with their current role."; **Change role** select (assignable roles = system roles except `super_admin` + custom roles) -> `askConfirm({ title: 'Change <name>\'s role?', consequence: 'They will have <role>\'s access from their next request.', confirmLabel: 'Change role', action })` -> `assignRole({ staffId, roleId })` (the role's id from `roles.data`; a system-role name with no matching row id disables the option); no Change role on the own row; the drawer shows the server error inline and applies the late-result rule (`shownId` ref as in `PostsSection`).
- [ ] **Step 1: Failing tests** (mock `useStaffActions`, `useAdmin`): states (loading placeholder, failed -> Retry never "No members yet", restricted text, empty after ok), members listed per team, create-team payload/keep/clear, deactivate and reactivate confirmations with exact texts and payloads only after confirm, no Deactivate/Change role on own row, change-role confirmation and payload, `super_admin` not offered, server error inline in the drawer, markup in names rendered inert, busy disables the buttons, late result after drawer close toasts a failure.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: Commit** `feat(carefind): teams panel and staff directory with deactivate and change role`.

---

### Task 6: CreateStaffPanel

**Files:**
- Create: `ADM/sections/teams/CreateStaffPanel.jsx`, `ADM/sections/teams/CreateStaffPanel.test.jsx`

**Interfaces:**
- `<CreateStaffPanel teams roles />` (settled sources). Fields: Full name, Email, Password (type `password` with a "Show password" toggle button, `aria-pressed`, min 8 helper text "At least 8 characters"), Role (select of the five system roles in this order: moderator "Content Moderator", verification_officer "Verification Officer", business_manager "Business Manager", support_agent "Support Agent", analytics_manager "Analytics Manager", then the custom roles `roles.data.filter(r => !r.is_system)` labelled by name with underscores as spaces; `super_admin` never), Team (select, "No team" option; failed teams source -> the select is disabled with "Couldn't load teams"). Submit "Create staff account" -> `useStaffActions().createStaff({ name, email, password, role, roleId, teamId })` where `roleId` is the custom role's `id` when a custom role is chosen. Success: clear every field (incl. role/team to defaults), status message "Staff account created" in `role="status"`; failure: keep name/email/role/team, CLEAR the password, show the server error in `role="alert"`. Submit disabled while running or the form invalid (also native `required`/`type="email"`); a result after unmount toasts a failure.
- [ ] **Step 1: Failing tests:** payload for a system role (no `roleId`) and a custom role (`roleId` + `newRole`); success clears; failure keeps everything but the password and shows the error; password < 8 shows the helper error and makes no call; show/hide toggle flips the input `type` and the pressed state; the password value is never rendered into the DOM as text, an `aria-label`, `title` or `data-` attribute; roles failed -> only system roles offered plus a note "Couldn't load custom roles"; teams failed -> disabled select; double click makes one call; `super_admin` absent from the options.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: Commit** `feat(carefind): create staff panel that keeps the form and never keeps the password`.

---

### Task 7: RolesPanel

**Files:**
- Create: `ADM/sections/teams/RolesPanel.jsx`, `ADM/sections/teams/RolesPanel.test.jsx`

**Interfaces:**
- `<RolesPanel roles onRetry />` (settled source). Shown only to a super admin (the caller decides; the component also renders nothing sensitive for a non-super `useAdmin().adminUser.role`). Create role: name, description, `PermissionMatrix` -> `createRole({ name, description, tabs })` (blank name disabled; success clears, failure keeps and shows inline). Role list: name (underscores as spaces), a "System" badge, description, enabled sections as text; custom roles have **Edit** (inline editor with `PermissionMatrix` + description -> `updateRole`, Save/Cancel; Save disabled until something changed) and **Delete** (`askConfirm({ title: 'Delete the <name> role?', consequence: 'This permanently deletes the role. Check the access of any staff who have it.', confirmLabel: 'Delete role', action })` -> `deleteRole`); system roles are read-only with the note "System roles can't be edited here." Failed roles source -> "Couldn't load roles" + Retry (never an empty list); stale -> "Couldn't refresh" note.
- [ ] **Step 1: Failing tests:** create payload incl. `overview` always true; blank name; edit saves only changed fields' payload (`carefindTabs` with `overview: true`), cancel discards; delete asks first with the exact text and sends `{roleId}` only after confirm; system roles show no Edit/Delete; failed roles -> Retry; non-super renders nothing sensitive; markup in role names/descriptions inert; double click on Create makes one call.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: Commit** `feat(carefind): roles panel with a shared permission grid and confirmed delete`.

---

### Task 8: TeamsSection

**Files:**
- Create: `ADM/sections/TeamsSection.jsx`, `ADM/sections/TeamsSection.test.jsx`

**Interfaces:**
- Composes Tasks 1, 5, 6, 7: `const { adminUser } = useAdmin(); const isSuper = adminUser?.role === 'super_admin'`; `useTeamsData({ canSeeStaff: isSuper })`; h1 "Teams & Staff", subtitle "Manage teams, staff, and roles"; `TeamsPanel` always; `CreateStaffPanel` and `RolesPanel` and `StaffDirectory` only when `isSuper` (a non-super sees one note: "Staff accounts and roles can only be managed by a super admin." plus the teams list); while the whole query is loading, a placeholder; `onRetry` = `refetch`; the stale notes come from the panels.
- [ ] **Step 1: Failing test** (mock the hook and the four child components with stubs that expose their props): super admin gets all panels with the settled sources; a non-super gets only `TeamsPanel` and the note and the hook is called with `canSeeStaff: false`; whole-query failure -> "Couldn't load" + Retry (never empty panels); one h1.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: Commit** `feat(carefind): Teams & Staff section on settled sources`.

---

### Task 9: TasksSection

**Files:**
- Create: `ADM/sections/TasksSection.jsx`, `ADM/sections/TasksSection.test.jsx`

**Interfaces:**
- h1 "Sponsored Tasks", subtitle "Create and manage tasks for healthcare professionals". Create panel: Task title, Compensation (₦) (`type="text"` with `inputMode="numeric"`, helper "Whole naira, e.g. 500"), Target specialty (optional, helper "Leave empty for all specialties"), Description (textarea) -> `useTaskActions().createTask`; success clears, failure keeps everything and shows the error in `role="alert"`; inline validation messages for compensation. Task list from `useTasksData`: title, specialty ("All specialties" when none), compensation (`₦${Number(c).toLocaleString()}` as legacy), created (`timeAgo`); failed -> "Couldn't load tasks" + Retry; empty after ok -> "No tasks yet"; stale -> "Couldn't refresh" note. A short honest note under the list: "Task submissions can't be reviewed from the console yet." (finding 86).
- [ ] **Step 1: Failing tests:** states; create payload (exact, incl. `specialty: null` when blank); invalid compensation shows the message and makes no call; failure keeps the form; success clears; list rendering and ₦ formatting; markup inert; double click makes one call.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: Commit** `feat(carefind): sponsored tasks screen with validation and honest states`.

---

### Task 10: Wire the sections and retire the legacy code

**Files:**
- Modify: `ADM/AdminPanel.jsx`, `ADM/AdminPanel.sections.test.jsx`, `ADM/legacy/LegacyTabHost.jsx`
- Delete: `ADM/tabs/TeamsTab.jsx`, `ADM/tabs/TasksTab.jsx` (and any tests)

- [ ] **Step 1: AdminPanel.** Import the two sections; AFTER the unchanged `isAllowed` check route `teams` -> `<TeamsSection />` and `tasks` -> `<TasksSection />`. Mirror the Phase 5a wiring (`git show 51d2f8e --stat`).
- [ ] **Step 2: LegacyTabHost.** Delete ONLY dead code: the two imports and render lines; task state (`taskTitle, taskDesc, taskComp, taskSpec, savingTask`), team/staff/role state (`teamName, staffEmail, staffPass, staffName, staffRole, staffTeam, savingStaff, staffMsg, newRoleName, newRoleDesc, newRoleTabs, editingRoleId, editingRoleTabs, savingRole`), handlers `createTask, createStaff, createTeam`, `useAdminRoles`/`adminRoles`, the `tasks, teams, staff` destructure names, `ALL_TABS`/`adminUser` when nothing remaining uses them — grep EVERY identifier and import first and re-read the whole file; what must still work is Shop and Email templates (`ShopTab`, `EmailTemplatesTab` receive only `showToast`). A ReferenceError here would crash both. Pre-existing unused leftovers (`useEffect`, `adminPermissions`, `askConfirm`, `dateFrom`/`dateTo`, `ecom*`, `updateEcomApp`, `moderateProduct`) may stay unless they only served the removed tabs.
- [ ] **Step 3: Delete the two tab files**, then `grep -rn "TeamsTab\|TasksTab" apps/carefind/src` and fix importers (report). `hooks/queries.js` and `useAdminData` are not modified (`useAdminRoles` becomes dead; documented).
- [ ] **Step 4: Extend `AdminPanel.sections.test.jsx`** `TABS` with `teams` (nav label as in `navigation.js`, heading "Teams & Staff") and `tasks` (heading "Sponsored Tasks"), mocking the two sections like the existing mocks, so the generic loops cover routing and the not-permitted fallback.
- [ ] **Step 5: Verify** `npx vitest run src/modules/admin`, `npm run build`, `npm run lint` (0 errors); scan touched files for un-imported JSX components and for invalid UTF-8.
- [ ] **Step 6: Commit** `refactor(carefind): Teams and Tasks leave the legacy host`.

---

### Task 11: Docs

**Files:**
- Modify: `docs/ADMIN_REDESIGN.md` (docs only; no push, no PR, no full suite)

- [ ] **Step 1:** Phase table: 5a "built (PR #28)", 5b "built on `feat/carefind-admin-phase5b`", 5c remains. Code organisation: the new hooks, `ui/PermissionMatrix`, `sections/teams/*`, the two sections; dead-code notes (`useAdminRoles`, tasks/teams/staff in `useAdminData` still read by `useAdminData` itself); the host now holds only Shop and Email templates.
- [ ] **Step 2: Findings 80-86** exactly as in the spec (verify each fact with Read/Grep first; real SHAs from `git log --oneline feat/carefind-admin-phase5a..HEAD`), the behaviour changes (deactivate/change-role wired; audit entries; password minimum; roleId sent; restricted state; confirmations) and the verified server facts the wording relies on (`requireAdmin` checks `is_active` on every request; `toggle_staff` does not revoke sessions; `delete_admin_role` only deletes the row; `list_staff` super-admin only; `get_admin_permissions` not in repo SQL).
- [ ] **Step 3: Verification state** (unit/component tests with the final counts from the last task report; responsive layout NOT measured; behaviour against the live admin NOT exercised; custom-role access resolution (finding 80) NOT verified — owner must check `get_admin_permissions` in Supabase).
- [ ] **Step 4: Commit** `docs(carefind): Phase 5b state and findings 80-86`.

---

## Self-review

- **Spec coverage:** settled teams/roles/staff + restricted (T1); staff/team/role actions, audit, password rules, in-flight guard (T2); tasks list+create (T3); permission grid (T4); teams list + deactivate/change role (T5); create staff incl. roleId (T6); roles panel (T7); composition + non-super gating (T8); tasks screen (T9); routing + legacy retirement (T10); findings 80-86 (T11).
- **Plan decisions the spec left open:** staff table uses the shared `DataTable` (few rows, no paging); own-row Change role also withheld; `super_admin` withheld everywhere; compensation validated as a positive whole number client-side (legacy sent the raw field to `parseInt`); delete-role wording avoids claims about staff on the role.
- **Known thin spots:** section tests of T5-T9 are exact case lists, not code (earlier phases needed fix rounds on exactly these); `get_admin_permissions` behaviour is unverifiable from the repo, so custom-role access cannot be asserted in tests; the audit `targetId` for `create_staff` is the email because the server returns no id.
- **Type consistency:** settled source `{status, data, stale?}` plus `{status:'restricted'}` used by T5-T8; `useStaffActions` method names/arg shapes match T5-T7; `PermissionMatrix` `value`/`onChange` object shape matches the `tabs` argument of `createRole`/`updateRole`.
