---
title: 'CareFind Admin Upgrade Phase 3: Moderation Queue & Audit Logging'
type: 'feature'
created: '2026-09-16'
status: 'done'
review_loop_iteration: 0
baseline_commit: '32318c818c0184c0e16d9592f52792d541945053'
context:
  - packages/design-system/src/theme.js
  - apps/carefind/src/modules/admin/AdminPanel.jsx
  - apps/carefind/src/modules/admin/tabs/ReportsTab.jsx
  - apps/carefind/src/modules/admin/tabs/PostsTab.jsx
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Content moderation is manual and per-item with no priority system. Reports, posts, verifications, and claims live in separate tabs with no unified view. There is no audit trail for admin actions, making accountability impossible. The AI copilot is regex-based and cannot understand natural language queries.

**Approach:** Build a unified Moderation Queue that aggregates reports, pending posts, and flagged content with priority scoring. Add bulk operations (select-all, batch approve/reject/delete). Add audit logging to track every admin action with actor, timestamp, and target. Upgrade the AI copilot to use a real LLM for natural language queries.

## Boundaries & Constraints

**Always:**
- Preserve all existing moderation actions (delete, suspend, approve, reject)
- Keep individual action buttons working alongside bulk operations
- Audit log must capture: actor_id, action, target_type, target_id, timestamp, metadata
- Priority scoring must be deterministic (same inputs = same score)
- Bulk operations must be atomic (all succeed or all fail with rollback)

**Ask First:**
- Whether to upgrade AI copilot to use OpenAI/Anthropic API or keep regex-based (API costs)
- Whether audit log should be database table or separate logging service

**Never:**
- Remove any existing moderation action
- Make bulk operations irreversible without confirmation
- Store admin passwords or secrets in audit log
- Skip audit logging for destructive actions (delete, suspend)

</frozen-after-approval>

## Code Map

- `apps/carefind/src/modules/admin/AdminPanel.jsx` -- orchestrator: all moderation actions (lines 733-873), loadAll (lines 224-308), tab routing
- `apps/carefind/src/modules/admin/tabs/ReportsTab.jsx` -- current report moderation: delete/dismiss only (100 lines)
- `apps/carefind/src/modules/admin/tabs/PostsTab.jsx` -- post moderation: delete only (167 lines)
- `apps/carefind/src/modules/admin/tabs/VerificationsTab.jsx` -- verification approve/reject (160 lines)
- `apps/carefind/src/modules/admin/tabs/ClaimsTab.jsx` -- claim approve/reject (120 lines)
- `apps/carefind/src/modules/admin/tabs/NewsTab.jsx` -- news approve/reject/delete (240 lines)
- `apps/carefind/src/modules/admin/AdminAiCopilot.jsx` -- floating AI chat widget (412 lines)
- `apps/carefind/src/lib/adminAiQuery.js` -- regex-based query parser (313 lines)
- `apps/carefind/src/modules/admin/repositories/contentRepository.js` -- post CRUD operations
- `apps/carefind/src/modules/admin/repositories/usersRepository.js` -- user operations
- `apps/carefind/api/_handlers/admin-auth.js` -- all backend endpoints (1083 lines)
- `apps/carefind/src/modules/admin/stores/postsStore.js` -- Zustand store for posts
- `apps/carefind/src/modules/admin/stores/usersStore.js` -- Zustand store for users

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/src/modules/admin/tabs/ModerationQueue.jsx` -- CREATE: unified queue component aggregating reports, flagged posts, pending verifications with priority scoring
- [x] `apps/carefind/src/modules/admin/stores/moderationStore.jsx` -- CREATE: React Context store for queue items, selected items, bulk action state
- [x] `apps/carefind/src/modules/admin/components/BulkActionBar.jsx` -- CREATE: floating action bar when items selected (approve/reject/delete with count)
- [x] `apps/carefind/src/modules/admin/components/PriorityBadge.jsx` -- CREATE: visual priority indicator (urgent/high/medium/low) with color coding
- [x] `apps/carefind/src/modules/admin/components/AuditLog.jsx` -- CREATE: audit trail viewer with filtering by actor, action, date range
- [x] `apps/carefind/api/_handlers/admin-auth.js` -- MODIFY: add `log_audit_action` helper function, add `list_audit_logs` action, add `bulk_action` action for batch operations
- [x] `apps/carefind/src/modules/admin/AdminPanel.jsx` -- MODIFY: add ModerationQueue tab to nav, wrap moderation actions with audit logging
- [x] `apps/carefind/src/modules/admin/AdminSidebar.jsx` -- MODIFY: add Moderation Queue + Audit Log to NAV_GROUPS
- [x] `apps/carefind/src/modules/admin/tabs/ReportsTab.jsx` -- MODIFY: add select checkboxes, integrate with moderationStore for bulk selection
- [x] `apps/carefind/src/modules/admin/tabs/PostsTab.jsx` -- MODIFY: add select checkboxes, integrate with moderationStore for bulk selection
- [x] `apps/carefind/src/modules/admin/tabs/VerificationsTab.jsx` -- MODIFY: add select checkboxes for bulk approve/reject
- [x] `apps/carefind/src/modules/admin/lib/priorityScoring.js` -- CREATE: deterministic priority scoring function (age, report count, content type, author history)
- [x] `apps/carefind/src/lib/adminAiQuery.js` -- MODIFY: upgrade to support LLM-backed queries with fallback to regex patterns, add moderation and audit queries
- [x] `apps/carefind/src/modules/admin/AdminAiCopilot.jsx` -- MODIFY: add loading state for LLM queries, display audit log queries

**Acceptance Criteria:**
- Given reports exist with different ages and report counts, when scored, then older items with more reports score higher (priority: urgent > high > medium > low)
- Given 5 posts are selected in PostsTab, when "Delete" is clicked in BulkActionBar, then all 5 are deleted atomically and audit logged
- Given a moderator approves a verification request, when viewing AuditLog, then the action appears with actor name, timestamp, and target user
- Given the AI copilot receives "show me posts flagged for spam", when processed, then relevant flagged posts are displayed
- Given bulk operations fail partially, when error occurs, then all changes are rolled back and error message shown
- Given ModerationQueue tab is open, when new report arrives via Realtime, then it appears in the queue within 2 seconds

## Spec Change Log

## Design Notes

**Priority scoring algorithm:**
```
score = (report_count * 30) + (age_hours * 0.5) + (content_type_weight) + (author_violation_count * 20)
```
Where content_type_weight: text=5, question=10, review=15, article=20, visual=25, premium=30
Priority thresholds: urgent >= 100, high >= 60, medium >= 30, low < 30

**Bulk operation atomicity:** Use a database transaction via Supabase RPC. If any item fails, entire batch rolls back. Audit log entry created per-item even in batch (one log per target, not one log per batch).

**AI copilot upgrade path:** Start with regex patterns (current). If LLM API key is configured, route to LLM. If not, stay regex. This keeps the feature free for self-hosted instances.

## Verification

**Commands:**
- `cd apps/carefind && npx vite build` -- expected: builds without errors
- Manual: Create 3 reports on different posts, open ModerationQueue -- items appear with correct priority scores
- Manual: Select 2 posts, click Delete in BulkActionBar -- both deleted, audit log shows 2 entries
- Manual: Ask AI copilot "how many pending reports" -- returns count from queue
- Manual: Check audit_log table in Supabase -- entries exist for all test actions

**Manual checks:**
- Bulk delete with partial failure -- all items remain, error toast shown
- Realtime: create report in another tab -- appears in queue within 2s
- Audit log filtering by actor and date range -- correct results

## Suggested Review Order

**Priority scoring engine**

- Deterministic scoring formula with deduplication and upper bound
  [`priorityScoring.js:12`](../../apps/carefind/src/modules/admin/lib/priorityScoring.js#L12)

**Unified moderation queue**

- Queue component aggregating reports, flagged posts, verifications with priority sorting
  [`ModerationQueue.jsx:27`](../../apps/carefind/src/modules/admin/tabs/ModerationQueue.jsx#L27)

- Confirmation dialog before bulk delete
  [`ModerationQueue.jsx:106`](../../apps/carefind/src/modules/admin/tabs/ModerationQueue.jsx#L106)

- Audit logging integrated into bulk operations
  [`ModerationQueue.jsx:68`](../../apps/carefind/src/modules/admin/tabs/ModerationQueue.jsx#L68)

**Bulk operations infrastructure**

- React Context store for selection state
  [`moderationStore.jsx:1`](../../apps/carefind/src/modules/admin/stores/moderationStore.jsx#L1)

- Floating action bar with approve/reject/delete
  [`BulkActionBar.jsx:1`](../../apps/carefind/src/modules/admin/components/BulkActionBar.jsx#L1)

- Priority badge visual indicator
  [`PriorityBadge.jsx:1`](../../apps/carefind/src/modules/admin/components/PriorityBadge.jsx#L1)

**Audit logging**

- Audit trail viewer with filtering
  [`AuditLog.jsx:1`](../../apps/carefind/src/modules/admin/components/AuditLog.jsx#L1)

- Backend endpoints: log_audit_action, list_audit_logs, bulk_action
  [`admin-auth.js:1086`](../../apps/carefind/api/_handlers/admin-auth.js#L1086)

**Integration**

- ModerationProvider wrapper, audit logging on all 9 moderation actions
  [`AdminPanel.jsx:164`](../../apps/carefind/src/modules/admin/AdminPanel.jsx#L164)

- Realtime subscription for reports table
  [`AdminPanel.jsx:207`](../../apps/carefind/src/modules/admin/AdminPanel.jsx#L207)

- New nav items in sidebar
  [`AdminSidebar.jsx:23`](../../apps/carefind/src/modules/admin/AdminSidebar.jsx#L23)

**Tab modifications**

- ReportsTab: select checkboxes integrated with moderation context
  [`ReportsTab.jsx:10`](../../apps/carefind/src/modules/admin/tabs/ReportsTab.jsx#L10)

- PostsTab: select checkboxes integrated with moderation context
  [`PostsTab.jsx:15`](../../apps/carefind/src/modules/admin/tabs/PostsTab.jsx#L15)

- VerificationsTab: select checkboxes for bulk approve/reject
  [`VerificationsTab.jsx:15`](../../apps/carefind/src/modules/admin/tabs/VerificationsTab.jsx#L15)

**AI copilot enhancements**

- New moderation and audit query patterns
  [`adminAiQuery.js:234`](../../apps/carefind/src/lib/adminAiQuery.js#L234)

- Updated suggestions and welcome message
  [`AdminAiCopilot.jsx:12`](../../apps/carefind/src/modules/admin/AdminAiCopilot.jsx#L12)
