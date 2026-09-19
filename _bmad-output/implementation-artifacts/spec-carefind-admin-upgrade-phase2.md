---
title: 'CareFind Admin Upgrade Phase 2: Design System & State Architecture'
type: 'refactor'
created: '2026-09-16'
status: 'done'
review_loop_iteration: 0
baseline_commit: '638f4a4bfe9f30eeb3b71e3e12eece42ca458774'
context:
  - packages/design-system/src/theme.js
  - apps/carefind/src/styles/global.css
  - apps/carefind/src/modules/admin/AdminPanel.jsx
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** AdminPanel.jsx is a 980-line god component with ~110 useState hooks, 40+ hardcoded colors bypassing the theme system, and 30-second polling instead of Realtime. This makes the admin panel unmaintainable and stale-prone.

**Approach:** Extract CSS tokens into dark-mode-ready CSS variables, replace useState prop-drilling with Zustand stores split by domain, and add Supabase Realtime subscriptions to replace polling. Each change is incremental — tabs can be migrated independently.

## Boundaries & Constraints

**Always:**
- Preserve all existing functionality — no feature regressions
- Keep inline style approach (no Tailwind migration)
- Use existing `packages/design-system/src/theme.js` as token source
- Zustand stores use `persist` middleware only for theme preference
- Realtime subscriptions must clean up on component unmount
- Maintain backward compatibility with existing tab props (incremental migration)

**Ask First:**
- Whether to migrate AdminPanel.jsx useState to Zustand in this phase or defer (it has ~110 hooks)
- Whether to add dark mode toggle or only respect OS preference

**Never:**
- Remove any existing tab or feature
- Change the admin authentication flow
- Add Tailwind or CSS-in-JS libraries
- Use Zustand for server state (only for UI state + client cache)

</frozen-after-approval>

## Code Map

- `packages/design-system/src/theme.js` -- canonical token source (194 lines): brand palette, semantic colors, typography, spacing, elevation, motion
- `apps/carefind/src/styles/global.css` -- CSS custom properties mirror of theme.js tokens (lines 9-63), resets, keyframes, utility classes
- `apps/carefind/src/styles/theme.js` -- re-exports design-system theme (line 4)
- `apps/carefind/src/modules/admin/AdminPanel.jsx` -- god component: ~110 useState hooks (lines 47-161), 30s polling (lines 195-198), tab routing via useState('overview'), all data fetching
- `apps/carefind/src/modules/admin/AdminLayout.jsx` -- flex container: sidebar + scrollable content
- `apps/carefind/src/modules/admin/AdminSidebar.jsx` -- responsive nav with NAV_GROUPS for 19 tabs
- `apps/carefind/src/modules/admin/tabs/*.jsx` -- 19 tab files, pure presentation receiving props from AdminPanel
- `apps/carefind/src/modules/admin/HealthPulse.jsx` -- dashboard widget with 30s polling (line 6, 26)
- `apps/carefind/src/config/supabaseClient.js` -- basic Supabase client, no Realtime config (16 lines)
- `apps/carefind/src/modules/social-feed/LiveSession.jsx` -- existing Realtime pattern: supabase.channel() + .on('postgres_changes') + .subscribe() (lines 266-292)
- `apps/carefind/src/modules/social-feed/Feed.jsx` -- existing Realtime pattern for comments/live status (lines 663-691)
- `apps/carefind/src/modules/admin/tabs/PostsTab.jsx` -- uses theme tokens, has media preview from Phase 1
- `apps/carefind/src/modules/admin/tabs/UsersTab.jsx` -- has hardcoded #fff colors (lines 36, 65, 70, 91, 143, 158)
- `apps/carefind/src/modules/admin/tabs/StoriesTab.jsx` -- hardcoded color palette (lines 8-13)
- `apps/carefind/src/modules/admin/tabs/AdminShop.jsx` -- 14 hardcoded status colors (lines 23-36)

## Tasks & Acceptance

**Execution:**
- [ ] `apps/carefind/src/styles/tokens.css` -- CREATE: CSS custom properties for dark/light mode using theme.js values as source, with `prefers-color-scheme: dark` media query
- [ ] `apps/carefind/src/modules/admin/AdminPanel.jsx` -- MODIFY: import tokens.css, replace hardcoded #0E6F5A with var(--color-primary) (lines 114, 958)
- [ ] `apps/carefind/src/modules/admin/tabs/AdminShop.jsx` -- MODIFY: replace 14 hardcoded status colors (lines 23-36) with semantic CSS variables
- [ ] `apps/carefind/src/modules/admin/tabs/StoriesTab.jsx` -- MODIFY: replace hardcoded palette (lines 8-13) with CSS variables
- [ ] `apps/carefind/src/modules/admin/tabs/UsersTab.jsx` -- MODIFY: replace 6 hardcoded #fff (lines 36, 65, 70, 91, 143, 158) with var(--color-surface)
- [ ] `apps/carefind/src/modules/admin/tabs/PostsTab.jsx` -- MODIFY: replace hardcoded #fff, #000 (lines 40, 53, 95) with CSS variables
- [ ] `apps/carefind/src/modules/admin/tabs/HealthPulse.jsx` -- MODIFY: replace hardcoded colors (lines 37, 44, 52, 59) with CSS variables
- [ ] `apps/carefind/src/modules/admin/tabs/GoLiveTab.jsx` -- MODIFY: replace hardcoded colors (lines 31, 47-50, 138) with CSS variables
- [ ] `apps/carefind/src/modules/admin/tabs/TeamsTab.jsx` -- MODIFY: replace hardcoded role colors (lines 84-88, 129, 134) with CSS variables
- [ ] `apps/carefind/src/modules/admin/tabs/DrugsTab.jsx` -- MODIFY: replace hardcoded #f59e0b star color (line 90) with CSS variable
- [ ] `apps/carefind/src/modules/admin/tabs/BusinessesTab.jsx` -- MODIFY: replace hardcoded #f59e0b star color (line 71) with CSS variable
- [ ] `apps/carefind/src/modules/admin/tabs/NotificationsTab.jsx` -- MODIFY: replace hardcoded #f59e0b (line 10) with CSS variable
- [ ] `apps/carefind/src/modules/admin/tabs/PromotionsTab.jsx` -- MODIFY: replace hardcoded #fff (line 149) with CSS variable
- [ ] `apps/carefind/src/modules/admin/tabs/VerificationsTab.jsx` -- MODIFY: replace hardcoded #fff (line 56) with CSS variable
- [ ] `apps/carefind/src/modules/admin/tabs/NewsTab.jsx` -- MODIFY: replace hardcoded rgba (line 137) with CSS variable
- [ ] `apps/carefind/src/modules/admin/tabs/SearchesTab.jsx` -- MODIFY: replace hardcoded #fff (line 93) with CSS variable
- [ ] `apps/carefind/src/modules/admin/AdminAiCopilot.jsx` -- MODIFY: replace hardcoded white/rgba colors (lines 88, 222, 240-241, 244, 272, 282, 309, 340, 392) with CSS variables
- [ ] `apps/carefind/src/modules/admin/stores/postsStore.js` -- CREATE: Zustand store for posts list, filters, pagination, loading, error state
- [ ] `apps/carefind/src/modules/admin/stores/usersStore.js` -- CREATE: Zustand store for users list, search, verification status
- [ ] `apps/carefind/src/modules/admin/stores/adminMetaStore.js` -- CREATE: Zustand store for active tab, theme preference (persisted)
- [ ] `apps/carefind/src/modules/admin/hooks/useRealtimeChannel.js` -- CREATE: reusable hook for Supabase Realtime subscriptions with cleanup
- [ ] `apps/carefind/src/modules/admin/AdminPanel.jsx` -- MODIFY: replace 30s setInterval (lines 195-198) with Realtime subscription, wrap in Zustand store providers
- [ ] `apps/carefind/src/modules/admin/HealthPulse.jsx` -- MODIFY: replace 30s setInterval (line 26) with Realtime subscription
- [ ] `apps/carefind/src/modules/admin/tabs/PostsTab.jsx` -- MODIFY: consume postsStore instead of props for posts data
- [ ] `apps/carefind/src/modules/admin/tabs/UsersTab.jsx` -- MODIFY: consume usersStore instead of props for users data
- [ ] `apps/carefind/src/modules/admin/AdminPanel.jsx` -- MODIFY: add aria-live regions for loading/data update announcements
- [ ] `apps/carefind/src/modules/admin/tabs/*.jsx` -- MODIFY: ensure all interactive elements have visible focus styles (outline or box-shadow)

**Acceptance Criteria:**
- Given the admin panel loads in light mode, when viewed, then all colors match Phase 1 appearance (no visual regressions)
- Given the OS is set to dark mode, when the admin panel loads, then dark theme is applied with readable text (4.5:1 contrast minimum)
- Given AdminPanel.jsx has ~110 useState hooks, when refactored, then shared state is in Zustand stores and local UI state remains as useState
- Given Posts tab is open, when a new post is created in another tab/session, then it appears within 2 seconds without manual refresh
- Given Users tab is open, when a user is verified in another tab, then status updates within 2 seconds
- Given any tab, when data is loading, then screen reader announces "Loading [tab name]"
- Given any button/link, when tabbed to, then focus indicator is clearly visible

## Spec Change Log

## Design Notes

**Dark mode strategy:** CSS custom properties in `:root` with `@media (prefers-color-scheme: dark)` override. This avoids JavaScript theme toggling complexity and respects OS preference automatically. If a manual toggle is later desired, a `.dark` class on `<body>` can be added with a second override block.

**Zustand migration approach:** AdminPanel.jsx passes ~20 props per tab. Instead of migrating all tabs at once, create stores and migrate PostsTab and UsersTab first (the most data-heavy). Other tabs continue receiving props until their next refactor cycle. This keeps the blast radius small.

**Realtime fallback:** The `useRealtimeChannel` hook will attempt Realtime subscription and fall back to a 30-second polling interval if the connection fails. This ensures no regression if Supabase Realtime is unavailable.

**Existing Realtime patterns:** LiveSession.jsx (lines 266-292) and Feed.jsx (lines 663-691) already use `supabase.channel()` + `.on('postgres_changes')` + `.subscribe()`. The new hook follows this exact pattern for consistency.

## Verification

**Commands:**
- `cd apps/carefind && npx vite build` -- expected: builds without errors
- `grep -r "#[0-9a-fA-F]\{6\}" apps/carefind/src/modules/admin/tabs/ --count` -- expected: reduced from ~40 to <5 hardcoded hex values
- `grep -r "setInterval" apps/carefind/src/modules/admin/ --count` -- expected: 0 (all replaced with Realtime)

**Manual checks:**
- Toggle OS dark mode preference -- admin panel should switch theme, all text readable
- Open two browser tabs on Posts tab, create post in one -- other tab updates within 2s
- Tab through all buttons/links in admin -- focus ring visible on each
- Check color contrast with browser dev tools -- all text passes WCAG AA (4.5:1)

## Suggested Review Order

**Design token system**

- CSS custom properties for light/dark mode via prefers-color-scheme
  [`tokens.css:1`](../../apps/carefind/src/styles/tokens.css#L1)

**Realtime infrastructure**

- Reusable hook with Supabase Realtime + polling fallback + cleanup
  [`useRealtimeChannel.js:1`](../../apps/carefind/src/modules/admin/hooks/useRealtimeChannel.js#L1)

- Realtime subscriptions replacing 30s polling, aria-live region added
  [`AdminPanel.jsx:175`](../../apps/carefind/src/modules/admin/AdminPanel.jsx#L175)

- Realtime subscription for dashboard pulse data
  [`HealthPulse.jsx:29`](../../apps/carefind/src/modules/admin/HealthPulse.jsx#L29)

**Zustand stores**

- Posts store with fetch, CRUD, and loading state
  [`postsStore.js:1`](../../apps/carefind/src/modules/admin/stores/postsStore.js#L1)

- Users store with fetch and update
  [`usersStore.js:1`](../../apps/carefind/src/modules/admin/stores/usersStore.js#L1)

- Admin meta store with persist middleware for theme
  [`adminMetaStore.js:1`](../../apps/carefind/src/modules/admin/stores/adminMetaStore.js#L1)

**CSS variable replacements**

- Admin panel: storyBg, Sparkles icon, Realtime hooks
  [`AdminPanel.jsx:112`](../../apps/carefind/src/modules/admin/AdminPanel.jsx#L112)

- Shop: 14 status colors replaced with semantic variables
  [`AdminShop.jsx:23`](../../apps/carefind/src/modules/admin/AdminShop.jsx#L23)

- Stories: 6 color presets + overlay colors
  [`StoriesTab.jsx:8`](../../apps/carefind/src/modules/admin/tabs/StoriesTab.jsx#L8)

- HealthPulse: alert colors replaced
  [`HealthPulse.jsx:42`](../../apps/carefind/src/modules/admin/HealthPulse.jsx#L42)

- Users, Posts, GoLive, Teams, Drugs, Businesses, Notifications, Promotions, Verifications, News, Searches tabs
  (16 files total with hardcoded hex replaced)

**Accessibility**

- Loading state aria-live announcement
  [`AdminPanel.jsx:907`](../../apps/carefind/src/modules/admin/AdminPanel.jsx#L907)

- Content region aria-live for data updates
  [`AdminPanel.jsx:929`](../../apps/carefind/src/modules/admin/AdminPanel.jsx#L929)
