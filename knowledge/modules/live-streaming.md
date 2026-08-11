# Live Streaming — Business Domain

## Purpose
Real-time video broadcasting on CareFind — going live, viewing a live session, live comments/reactions, and a post-stream dashboard, plus a distinct "Show" concept layered on top of raw sessions. One of the largest concentrations of functionality in CareFind, comparable in scope to the entire Social Feed domain.

## Files
`apps/carefind/carefind-main/src/LiveSession.jsx` (552 lines), `LiveShow.jsx` (542 lines), `LiveDashboard.jsx` (296 lines), `GoLive.jsx` (78 lines), `UserGoLive.jsx` (168 lines), `VideoRecorder.jsx` (171 lines), `VideoUploader.jsx` (82 lines).

## Components
Seven separate, non-trivial components; no shared "live player" or "live chat" component was confirmed to be factored out between `LiveSession.jsx` and `LiveShow.jsx` during this review — their relationship (whether "Show" is a distinct product concept from "Session," e.g. scheduled/produced content versus ad hoc broadcasts) was not fully resolved.

## Services
Direct `supabase-js` calls against `live_sessions`, `live_shows`, `live_comments`, `live_reactions`, `live_participants`, `live_views`, `live_shares`, `live_items`, `live_messages` — nine distinct tables. No centralized live-streaming service file; each screen queries directly.

## Dependencies
Likely `notify.js` (the `'live': 'is live now 📡'` entry in `NOTIF_MESSAGES` confirms this domain fires notifications on going live), `lib/AuthContext.jsx`. Underlying video transport/CDN mechanism (WebRTC, a third-party streaming service, or Supabase Realtime) was not identified during this review.

## Database Tables
`live_sessions`, `live_shows`, `live_comments`, `live_reactions`, `live_participants`, `live_views`, `live_shares`, `live_items`, `live_messages`.

## Current State
Present and substantial in scope (seven files, ~1,900 lines) but not individually verified in this review beyond confirming their existence, table references, and the `notify.js` cross-reference. The distinction between "Session" and "Show," and the actual streaming transport mechanism, require direct reading before this entry can describe current state with confidence.

## Missing Documentation
No document explains the Session/Show distinction, the streaming transport technology in use, or how this domain relates to the platform's stated healthcare-discovery purpose. This is the largest domain in either codebase not covered by a detailed prior review pass, and is the top candidate for a dedicated follow-up.
