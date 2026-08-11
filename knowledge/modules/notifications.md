# Notifications — Business Domain

## Purpose
In-app alert delivery — each product has its own independent implementation with no shared code or table.

## Files
CareHub: `apps/carehub/src/components/layout/NotificationBell.jsx`, `lib/supabase.js` (`notify`, `getMyNotifications`, `markNotificationRead`, `markAllNotificationsRead`), `lib/realtime.js` (live subscription). CareFind: `apps/carefind/carefind-main/src/notify.js`, `Notifications.jsx`.

## Components
CareHub: `NotificationBell.jsx` — a sidebar-embedded bell with unread count and a slide-out panel; notably reads the logged-in user via a direct `localStorage` parse rather than the app's own `useAuth()` context, the one place in CareHub's component tree where auth state is read two different ways. CareFind: `Notifications.jsx` — a dedicated full-screen list, not a bell widget.

## Services
CareHub: `notify(businessId, recipients, kind, title, body, link)` — called internally by `sendMessage`, `createOrder`, `advanceOrder`, `logActivity`, and `commentOnActivity` from within `lib/supabase.js` itself; deliberately swallows its own errors (documented in its own inline comment) so a failed notification never blocks the action that triggered it. CareFind: `notify({ recipientId, actorId, type, message, link, postId })` in `notify.js`, with the identical silent-failure design independently arrived at, plus a `NOTIF_MESSAGES` map covering like/comment/reply/gift/follow/mention/live/news event types (implying it's called from the Social Feed and Live Streaming domains).

## Dependencies
CareHub's version is the only consumer, alongside `LiveActivity.jsx`, of `lib/realtime.js`'s live-subscription mechanism. CareFind's has no confirmed live-update mechanism from prior review passes.

## Database Tables
CareHub: `staff_notifications` (`id, business_id, staff_id, is_owner, kind, title, body, link, read_at, created_at`). CareFind: `notifications` (`recipient_id, actor_id, type, message, link, post_id, read`) — a completely separate table with no relationship to CareHub's.

## Current State
Both implementations work and both notify recipients live for the actions that call them. CareHub's has a real-time push via `watchTable('staff_notifications', ...)`; whether CareFind's has an equivalent live mechanism was not confirmed. Both independently chose to fail silently on write errors — a genuine point of convergent design between two teams that otherwise shared almost no code.

## Missing Documentation
No document records that both products independently built a notifications system with no attempt to share the underlying table or delivery mechanism, despite the "one ecosystem" framing in project documentation. No document specifies how CareHub's `NotificationBell.jsx` bypassing the app's own auth context (reading `localStorage` directly instead) came to be, or whether it was ever aligned with the rest of the app's pattern.
