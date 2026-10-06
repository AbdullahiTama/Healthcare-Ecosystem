# CareFind Admin Console: structure and UI redesign

- **Date:** 2026-10-05
- **Status:** Design approved in conversation; awaiting review of this written spec
- **App:** `apps/carefind`
- **Scope:** Stage 1 of the admin programme: one routed console, a shared set of screen building blocks, and the migration of every existing admin screen into it. New admin features are later stages with their own specs.

## 1. Goal

The CareFind admin is hard to use and hard to extend. Its structure is fragmented and its screens are a mobile feed stretched onto a desktop. This stage replaces it with one console that:

- holds every admin screen behind one access gate, in one navigation, with real URLs;
- uses tables, drawers and detail pages suited to desk work, in the existing CareHub/CareFind design language;
- lets each later feature (finance, shop operations, community moderation) be added as a screen rather than as more state in one file.

**Who it is for:** one operator today (the founder), structured so that staff roles can be switched on later without redesign. The role machinery (`admin_roles`, per-screen permissions, teams and staff) already exists and is kept.

**Success looks like:**

- every admin function reachable from one sidebar, none lost;
- any screen, filter or open record can be refreshed or linked;
- a user outside the newest 100 can be found;
- a failed load is visibly an error, not an empty list;
- the console is usable at 375, 768 and 1280px;
- `AdminPanel.jsx` no longer exists.

## 2. Current state

Findings from reading the code on 2026-10-05.

| Problem | Evidence |
|---|---|
| Four disconnected admin surfaces | `/admin-panel` (25 tabs); `/admin/dashboard` and `/admin/businesses` (`DashboardHub`, `BusinessesHub`); `/admin/agents`, `/admin/applications`, `/admin/earnings`, `/admin/transfers` (`agents-hub`); `/business-directory` (`BusinessDirectoryPage`: add, edit, delete, import and categorise businesses). The sidebar links to none of the standalone pages. |
| Duplicates | Two dashboards; three business lists (`BusinessesTab`, `BusinessesHub`, `BusinessListTab`). |
| No URLs for screens | The active tab is `useState('overview')` in `AdminPanel.jsx`. A refresh returns to Dashboard. |
| One file owns everything | `AdminPanel.jsx` is 932 lines with about 85 `useState` calls and passes 20–40 props to each tab. |
| Fixed data batch | `useAdminData` in `src/hooks/queries.js` loads 50 posts and 100 users once and screens filter that batch in the browser. Users outside the newest 100 cannot be found; the Users header reports the batch size as the total. |
| Errors hidden as empty | Each request in that batch ends in `.catch(() => [])`. |
| Layout | `AdminLayout` caps content at 960px. Records are stacked cards. A record's detail renders as a card above the list. The home screen stacks `HealthPulse`, `DashboardTab` and `OverviewTab`. |
| Navigation grouping | "System" mixes Drug Intel, Tasks, Promotions and Searches with Audit Log and Errors. Claims is under Users. Companies is under Commerce. |
| Standalone pages have no client gate | The `/admin/*` hub and agent routes and `/business-directory` render without `RequireAuth` or a `verify` call. The live database policies on `agents`, `agent_tiers`, `applications`, `admin_roles` and `businesses` require `is_platform_admin()` or the owning row, so this is a broken experience for a stranger, not a data exposure. |
| Emojis | About 130 remain in the admin (previously permitted as internal tooling). |

## 3. Decisions

| Decision | Choice |
|---|---|
| Operator model | Solo now, role-ready. Sidebar groups are permission boundaries. |
| Architecture | Routed console inside CareFind (`/admin/*`), lazy-loaded. Not a URL-synced single panel, not a separate app. |
| Shell | Grouped light sidebar with pending counts; top bar with global search, alerts bell and account menu. |
| Record pattern | Table with slide-over drawer by default. Full detail page for businesses and users, reached from the drawer. Drawer is full-screen on a phone. |
| Delivery | Incremental. The console works after every step. One commit per screen. |

## 4. Information architecture

Each screen keeps its existing permission key so that roles already created keep working.

| Group | Screen | Path under `/admin` | Permission key | Source |
|---|---|---|---|---|
| Home | Overview | `/` | `overview` | `HealthPulse`, `DashboardTab`, `OverviewTab` merged; `DashboardHub` retired into it |
| Moderation | Queue | `/moderation/queue` | `moderation` | `ModerationQueue` |
| Moderation | Reports | `/moderation/reports` | `reports` | `ReportsTab` |
| Moderation | Verifications | `/moderation/verifications` | `verifications` | `VerificationsTab` |
| Moderation | Claims | `/moderation/claims` | `claims` | `ClaimsTab` |
| Content | Posts | `/content/posts` | `posts` | `PostsTab` |
| Content | Stories | `/content/stories` | `stories` | `StoriesTab` |
| Content | News | `/content/news` | `news` | `NewsTab` |
| Content | Live | `/content/live` | `golive` | `GoLiveTab` |
| Content | Promotions | `/content/promotions` | `promotions` | `PromotionsTab` |
| Community | Users | `/community/users`, `/community/users/:id` | `users` | `UsersTab` |
| Community | Tasks | `/community/tasks` | `tasks` | `TasksTab` |
| Directory | Businesses | `/directory/businesses`, `/directory/businesses/:id` | `businesses` | `BusinessesTab`, `BusinessesHub` and `BusinessListTab` merged into one list with one Add business action |
| Directory | Categories | `/directory/categories` | `business_categories` (new) | `BusinessCategoriesTab` |
| Directory | Import | `/directory/import` | `business_import` (new) | `BusinessImportTab` |
| Directory | Drug intel | `/directory/drugs` | `drugs` | `DrugsTab` |
| Directory | Search insights | `/directory/searches` | `searches` | `SearchesTab` |
| Commerce | Shop | `/commerce/shop` | `shop` | `ShopTab`, `AdminShop` |
| Commerce | Orders | `/commerce/orders` | `orders` | `OrdersTab` |
| Commerce | Revenue | `/commerce/revenue` | `revenue` | `RevenueTab` |
| Finance | Withdrawals | `/finance/withdrawals` | `withdrawals` | `WithdrawalsTab` |
| Agents | Applications | `/agents/applications` | `agent_applications` (new) | `AgentApproval` |
| Agents | Earnings | `/agents/earnings` | `agent_earnings` (new) | `AgentEarnings` |
| Agents | Transfers | `/agents/transfers` | `agent_transfers` (new) | `AgentTransfer` |
| Platform | Team and roles | `/platform/team` | `teams` | `TeamsTab` |
| Platform | Audit log | `/platform/audit-log` | `audit_log` | `AuditLog` |
| Platform | Errors | `/platform/errors` | `errors` | `ErrorsTab` |
| Platform | Email templates | `/platform/email-templates` | `email_templates` | `EmailTemplatesTab` |
| Platform | Feed ranking | `/platform/feed-ranking` | `overview` | `FeedRankingConfig` and `DistributionExperiments`, which today sit at the bottom of the overview tab; the permission key is unchanged so nobody gains or loses access |

Further rules:

- **Alerts** (`notifications`) leaves the sidebar and becomes the bell in the top bar, opening a panel with the same content as `NotificationsTab`. In Plan 1 the bell links to an interim `/admin/alerts` page that renders the existing tab; it becomes a panel in Plan 2 when the batch query behind it is retired.
- **Pending counts** appear beside Queue, Reports, Verifications, Claims, News, Withdrawals, Agent applications and Shop.
- **A group with no permitted screens is hidden.**
- **Interim Directory screens in Plan 1.** Until the three business lists are merged in Plan 2, `BusinessesHub` and `BusinessDirectoryPage` are mounted unchanged inside the console as "Business hub" (`/directory/business-hub`, key `businesses`) and "Directory manager" (`/directory/manager`, key `business_import`), so no function is lost and both are gated. The Categories screen and the `business_categories` key arrive with the merge.
- **Pending counts in Plan 1** cover Queue, Reports, Verifications, Claims, News and Withdrawals. Agent applications and Shop gain counts when those screens are migrated in Plan 2.
- **New permission keys are not granted implicitly to restricted roles.** The sidebar today treats any key that is not explicitly `false` as allowed. For the five new keys, a role sees the screen only if it is the unrestricted admin role or the key is explicitly `true`. Existing keys keep today's behaviour.
- **Redirects:** `/admin-panel` → `/admin`; `/admin/dashboard` → `/admin`; `/admin/businesses` → the business list (in Plan 1 the interim `/admin/directory/business-hub`, keeping `?id=`; after the merge `/admin/directory/businesses/:id`); `/admin/applications` and `/admin/agents` → `/admin/agents/applications`; `/admin/earnings` → `/admin/agents/earnings`; `/admin/transfers` → `/admin/agents/transfers`; `/business-directory` → the directory screens (in Plan 1 the interim `/admin/directory/manager`).
- **Agent-facing routes are untouched:** `/agent-login`, `/agents/register`. The routes `/agents/approval`, `/agents/earnings` and `/agents/transfer` currently render the admin components without a gate; they redirect to the gated console.
- **The public route `/business-discovery` is untouched.** It imports hooks and `BusinessCard` from the `business-directory` module; those shared pieces stay where they are.

## 5. Architecture

### 5.1 Routing

CareFind's router is `<Routes key={location.key}>` in `src/main.jsx`, which remounts the matched page on every navigation. A shell placed inside it would lose its state on each click.

- `RoutesWithKey` renders `AdminApp` directly when the path starts with `/admin` (and for the legacy addresses that redirect into it), outside the keyed `<Routes>`.
- `AdminApp` owns an un-keyed `<Routes>` with one layout route (the shell) and a child route per screen.
- `AdminApp` is loaded with `lazy()` so admin code is not in the public bundle.
- Inside the console, URL changes for filters use the router normally; the remount rule in `utils/urlParams` applies only to pages under the keyed router.

### 5.2 Access gate

- `AdminGate` wraps everything in `AdminApp`. It runs the existing flow: Supabase session check, then `callAdminAuth('verify')`. On failure it signs out, clears the cached admin user and permissions, and navigates to `/login`.
- It provides `adminUser` and `permissions` through context. Screens do not receive them as props.
- Each route is wrapped in a permission check for its key and renders a no-access state when denied.
- An expired session detected by any `callAdminAuth` call routes to `/login` from every screen.
- The client gate is for experience only. The admin API and database policies remain the authority and are not changed in this stage.

### 5.3 Navigation registry

One module, `admin/navigation.js`, defines every screen: group, key, label, lucide icon, path and optional count key. The sidebar, the route table, the command palette (`commandRegistry.js`) and the role editor's screen list all read from it, replacing `NAV_GROUPS` and `ALL_TABS`.

### 5.4 Data

- Each screen has its own TanStack Query hook(s) and renders its own loading, error and empty states. `useAdminData` is retired screen by screen and deleted at clean-up.
- Query functions do not swallow errors.
- **Users, Posts and Businesses** get server-side search, filtering and pagination through their existing repositories (`usersRepository`, `contentRepository`, `commerceRepository` / `businessRepository`), returning rows and a total count.
- Lists served by `callAdminAuth` (verifications, reports, claims, transactions, withdrawals, teams, staff, news) keep their current actions unchanged in this stage.
- **Pending counts:** one query returns the counts for the sidebar and Home. It is invalidated by the existing realtime channels (`verification_requests`, `posts`, `reports`, `news`) and their 30-second polling fallback, which move from `AdminPanel` into the shell.
- **URL state:** search text, filters, sort, page and the open record id live in the query string, so a view survives refresh and can be shared.

### 5.5 State

- Form state lives in the screen or drawer that owns the form.
- The confirm dialog and toast are provided once by the shell through context (`useAdminConfirm`, `useToast`), replacing `askConfirm` and `showToast` props.
- Audit logging (`log_audit_action`) moves into a small `useAuditLog` helper used by the screens that log today.

### 5.6 File layout

```
src/modules/admin/
  AdminApp.jsx            routes + lazy screens
  AdminGate.jsx           verify, context, session expiry
  navigation.js           the screen registry
  shell/                  AdminShell, Sidebar, TopBar, AlertsPanel
  ui/                     shared building blocks (section 6)
  screens/<group>/        one folder per group, one file per screen
  repositories/           unchanged, extended for pagination
  legacy/                 LegacyScreens (migration only, deleted at clean-up)
```

The agent, businesses-hub and directory admin components move under `screens/agents` and `screens/directory`; their repositories stay in their modules.

### 5.7 Migration adapter

In step 1, the body of `AdminPanel.jsx` becomes `legacy/LegacyScreens.jsx`: it keeps its state and handlers, drops its own layout, auth check, toast and palette, and takes the active tab from the route. Unmigrated routes render it. As each screen is rebuilt, its route points at the new screen and its state and handlers are deleted from `LegacyScreens`. When the last screen is migrated the file is removed.

## 6. Building blocks

**Amended 2026-10-05 during planning.** The shared design system (`packages/design-system`, re-exported from `src/components/ui`) already ships most of what this section first proposed to build: `DashboardShell`, `PageHeader`, `MetricGrid`, `StatCard`, `SectionCard`, `DataTable` (sorting, pagination, loading/error/empty states and an automatic phone card layout), `FilterBar`, `SearchBar`, `Modal` with a `drawer` variant (focus trap, Esc, focus return), `StatusBadge`, `Empty`, `ErrorState`, `ConfirmDialog` and `Toast`. The console uses those. Only the pieces below are new, and they live in `admin/ui`.

| Block | Responsibility | Built on |
|---|---|---|
| `useUrlFilters(defaults)` | Maps search text, filters, page and the open record id to the query string | `react-router-dom` |
| `DetailDrawer` | Slide-over for one record, bound to a record id in the URL | `Modal variant="drawer"` |
| `StatusPill` | Adds the admin statuses the shared registry lacks (approved, rejected, resolved, flagged) | `Pill`, `StatusBadge` |
| `primaryCell`, `selectionColumn` | A keyboard-reachable "open record" cell and a checkbox column, expressed as `DataTable` column definitions so the shared table is not modified | `DataTable` |
| `NoAccess` | Shown when a permission check fails | `Empty` |

Existing admin pieces (`AdminPageHeader`, `AdminFilterBar`, `FilterPills`, `DateRange`, `BulkActionBar`, `RowActions`, `timeAgo`, `exportCSV`) are kept and reused. `AdminPageHeader` renders its title as an `<h1>`.

Server-side pagination for `DataTable` is needed first by Users, Posts and Businesses and is designed in Plan 2.

## 7. Visual standard

- Cream page background, white cards with a 1px border and the large radius token, flat teal primary, no gradients, system font. Colours come from `theme.js` / `tokens.css`; no hardcoded hex.
- Sidebar: white, 256px expanded and 64px collapsed, group labels in small caps, active item on the teal-mist background, counts in amber pills.
- Tables: compact rows, header row in muted small caps, numbers and money right-aligned with tabular figures, the primary column bold with a muted second line.
- Status vocabulary: pending amber, approved or active teal, rejected or failed red, neutral grey. Every status carries a text label.
- Content width is fluid to a 1280px maximum.
- Emojis in the admin are replaced with lucide icons.
- Filters are pills; the active pill is filled teal.

## 8. Responsive and accessibility

- **≤768px:** the sidebar is a slide-in menu opened from the top bar; tables render as stacked cards; drawers are full-screen; the page never scrolls sideways.
- **769–1024px:** the sidebar is collapsed to icons by default; wide tables scroll inside their own card.
- **Verified at 375, 768 and 1280px** per screen, by measurement with the main width constrained.
- Keyboard: every action reachable by keyboard; visible focus rings; rows open with Enter; drawer traps focus and closes on Esc.
- Semantics: real `<table>` markup with header scopes; `aria-label` on icon-only buttons; `aria-current` on the active sidebar item; live region for toasts.
- Text contrast meets WCAG AA.

## 9. Home

One overview replacing the three stacked dashboards:

- a row of stat tiles for each queue with a pending count and the age of the oldest item, each linking to its queue;
- a "waiting longest" table merging the oldest pending items across queues, each row opening its record;
- a small set of platform totals (users, posts, revenue for the selected period) with the existing date range control;
- the health indicators from `HealthPulse`, reduced to a compact strip.

Screens the operator lacks permission for contribute no tiles or rows.

## 10. Error handling

- A failed load shows `ErrorState` with retry on that screen; the shell and other screens keep working.
- A failed action shows a toast naming what failed and leaves the record unchanged. Optimistic updates are rolled back.
- Destructive actions keep the consequence-stating confirm dialog.
- The pending-counts query failing hides the counts and shows a small warning in the sidebar footer; it does not block navigation.

## 11. Security implications

- No database policy, RPC or admin API check is changed.
- Coverage increases: the hub, agent and directory admin screens move behind the verified gate.
- New permission keys are deny-by-default for restricted roles (section 4).
- `postLiveItem` reads a legacy `admin_token` from `localStorage` and passes it in the payload, where `callAdminAuth` already strips it. The read is removed when the Live screen is migrated.
- **To confirm in step 9, and report rather than fix:** the live policies `agent_referrals_own` and `agent_transfers_own` scope writes to the owning agent, and `agent_earnings` is read-only to clients. `AgentTransfer` performs these writes from the browser, so it may not work for an admin. Any fix is a server-side change and is out of scope for this stage.

## 12. Delivery order

| Step | Content | Plan |
|---|---|---|
| 1 | Foundation: `AdminApp`, `AdminGate`, `navigation.js`, shell, pending counts, redirects, `LegacyScreens` adapter | Plan 1 |
| 2 | Building blocks with tests | Plan 1 |
| 3 | Home | Plan 1 |
| 4 | Moderation: Queue, Reports, Verifications, Claims | Plan 1 |
| 5 | Community: Users (server search and pagination, detail page), Tasks | Plan 2 |
| 6 | Directory: Businesses (merged, detail page), Categories, Import, Drug intel, Search insights | Plan 2 |
| 7 | Content: Posts, Stories, News, Live, Promotions | Plan 2 |
| 8 | Commerce: Shop, Orders, Revenue | Plan 2 |
| 9 | Finance and Agents: Withdrawals; Applications, Earnings, Transfers | Plan 2 |
| 10 | Platform: Team and roles, Audit log, Errors, Email templates | Plan 2 |
| 11 | Clean-up: delete `LegacyScreens`, `AdminLayout`, `AdminSidebar`, `useAdminData`, `DashboardHub`, `BusinessDirectoryPage`, the duplicate business lists and dead code | Plan 2 |

Plan 2 is written after Plan 1 has shipped and been used.

Commit rules: one commit per screen or building block; a behaviour fix found during a move is a separate commit from the move; files are staged and committed in one command with explicit paths.

## 13. Testing

- **Building blocks:** unit tests for rendering, sorting, selection, pagination, URL sync, drawer focus trap, Esc and focus return, and the three state blocks.
- **Gate and routing:** signed out goes to `/login`; a denied key renders `NoAccess`; each legacy address redirects; the shell does not remount when navigating between screens.
- **Screens:** each migrated screen has tests for its actions through the UI. Existing suites (`AdminPanel.news.test.jsx`, `AdminLogin.test.jsx`, `CommandPalette.test.jsx`, `HealthPulse.test.jsx`, `UsersTab.test.jsx`, `adminApi.test.js`) stay green; those bound to `AdminPanel` are ported to the new screen when it is migrated.
- **Pagination:** Users, Posts and Businesses tests cover search reaching rows beyond the first page and the total count.
- **Build and lint:** `node_modules/.bin/vite build` and ESLint per commit. CareFind's ESLint has no React plugin, so each moved file is also scanned for JSX components that are used but not imported.
- **Layout:** measured at 375, 768 and 1280px per screen.
- **Limit:** signed-in screens cannot be exercised in a browser by the implementer, because entering admin credentials is off-limits. They are covered by tests and measurement, and the owner walks through each group after it lands.

## 14. Out of scope

- New finance views: wallets and CareCoin, commissions, settlements, refunds, a full withdrawal approval flow.
- Shop operations gaps: promo codes, product Q&A, vendor ratings, order disputes, tracking.
- Community moderation gaps: business reviews, comments, playlists, user-hosted live sessions.
- Creator monetisation views: subscriptions, gifts, consultations.
- Server-side pagination for lists served by the admin API.
- Any change to the admin API, RPCs or database policies.
- Redesign of the AI copilot beyond re-mounting it in the shell.
- A separate admin app, and dark mode.

## 15. Notes

- `docs/PROJECT_OVERVIEW.md`, `planning/ROADMAP.md`, `planning/CODE_AUDIT.md` and `docs/design/SCREEN_PATTERNS.md` are referenced by project instructions and earlier work but are not present in the repository. This spec is based on the code, `theme.js` and `tokens.css`.
- The layout and record-pattern mockups shown during design are saved under `.superpowers/brainstorm/` (git-ignored).
