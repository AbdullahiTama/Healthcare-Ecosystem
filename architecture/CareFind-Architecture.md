# CareFind Architecture

`apps/carefind` — Vite + React 18 + `react-router-dom` + Vercel serverless functions (`api/*.js`). No git repository of its own found within this workspace.

## The central finding: implementation scope does not match documentation

`docs/PROJECT_OVERVIEW.md` and this engagement's own briefs describe CareFind as a public healthcare discovery platform — search providers/medicines/labs, view profiles, (future) book appointments. Measured by actual source: of ~48 files and ~15,410 lines in `src/`, only three files are genuinely "healthcare discovery" —

- `Search.jsx` (333 lines) — product/business/professional search, verified in full this session
- `BusinessProfile.jsx` (347 lines) — business listing + reviews, verified in full this session
- `DrugProfile.jsx` (501 lines) — not verified in full this session, inferred healthcare-adjacent from name/route

Everything else — and it is the overwhelming majority of the codebase — implements a **social feed, live-streaming, and creator-monetization platform**:

| Concern | Files | Approx. lines |
|---|---|---|
| Social feed / posts / stories | `Feed.jsx`, `Stories.jsx`, `SavedPosts.jsx`, `VisualCard.jsx` | ~2,400 |
| Live streaming | `LiveSession.jsx`, `LiveShow.jsx`, `LiveDashboard.jsx`, `GoLive.jsx`, `UserGoLive.jsx` | ~1,700 |
| Creator monetization / wallet / gifting | `Wallet.jsx`, `ProfessionalMonetization.jsx`, `GiftPanel.jsx` | ~860 |
| News/articles | `News.jsx`, `NewsArticle.jsx`, `ArticleEditor.jsx` | ~1,100 |
| Playlists | `PlaylistCreate.jsx`, `PlaylistView.jsx` | ~390 |
| Media capture/upload tooling | `VideoRecorder.jsx`, `VideoUploader.jsx`, `VoiceRecorder.jsx`, `SlideUploader.jsx`, `DrawingBoard.jsx` | ~620 |
| Admin | `AdminPanel.jsx` (single largest file in the entire ecosystem), `AdminLogin.jsx`, `AdminStaff.jsx`, `AdminTeams.jsx` | ~2,370 |
| Profile / identity | `Profile.jsx`, `PublicProfile.jsx`, `ProfessionalDashboard.jsx` | ~1,580 |

This isn't a defect in any single file — each is a reasonably built feature in isolation — but it means **"CareFind" as implemented is much closer to a TikTok/Instagram-style creator platform with a healthcare-search feature bolted on**, not a healthcare discovery platform with social features. Anyone planning ecosystem-level work should treat the docs' framing of CareFind's purpose with caution and verify against the actual route/table they're about to touch.

## Layers

1. **Presentation** — flat `src/`, no `pages/`/`components/` subfolders. ~48 files, each a self-contained screen. The closest things to a shared component library are `Logo.jsx`, `BottomNav.jsx`, `VisualCard.jsx`, and `richText.jsx` — see `Component-Catalog.md` addendum.
2. **Data access** — direct `supabase-js` query builder calls (`supabase.from('table').select(...)`) scattered across page components, no centralized service file equivalent to CareHub's `lib/supabase.js`. The few genuine shared services are `lib/supabaseClient.js` (the client instance), `lib/AuthContext.jsx` (real Supabase Auth), `lib/reviewAI.js`, `lib/sentiment.js`, `lib/activeIdentity.js`, `notify.js` — see `Service-Catalog.md` addendum.
3. **Backend compute** — three Vercel serverless functions: `api/admin-auth.js` and `api/admin-setup.js` (both critically broken — see `Authentication.md`), and `api/paystack-webhook.js` (the one properly-built piece of security-sensitive code in either product — correct HMAC verification, idempotent).
4. **Identity layers, plural** — real Supabase Auth for end-users (`lib/AuthContext.jsx`), a completely separate, forgeable token scheme for CareFind's own admin panel (`api/admin-auth.js`), and a `localStorage`-based "active posting identity" switcher (`lib/activeIdentity.js`) layered on top of the Auth user for the personal/business/staff-position posting modes.

## Routing

27 flat routes declared directly in `main.jsx` (plus 3 admin routes on a separate mechanism). **Fixed this engagement**: 16 now go through a new `RequireAuth.jsx` router-level guard (redirects to `/login` if logged out); the other 11 are deliberately public (search, business/drug/news pages, viewing a livestream or playlist). `App.jsx` is confirmed dead code — a full second, unused search implementation, never imported by anything. Full route table in `Routing.md`'s CareFind sections.

## The genuine healthcare-adjacent surface, in more detail

`Search.jsx` and `BusinessProfile.jsx` read live from CareHub's own `businesses`/`products` tables (filtered by `visible_on_carefind`/`list_on_carefind`), plus CareFind-owned `reviews`, `profiles`, `promotions`, and `search_logs` tables. This is real, working integration — the one place where CareFind functions as the docs describe. Full detail on exactly what's shared vs. CareFind-owned is in `Shared-Services.md`.

## What's strong here

- Real Supabase Auth (`lib/AuthContext.jsx`) — the best-built auth path in the entire ecosystem.
- Correct HMAC webhook verification (`paystack-webhook.js`) — the only properly-secured payment code either product has.
- `lib/activeIdentity.js` — a small, well-commented, deliberately-designed piece of state management.
- Proper `supabase-js` query builder usage throughout, including working embedded-resource joins (`profiles(full_name)`, `staff:staff_id(...)`), implying more enforced foreign keys exist in this side of the schema than CareHub's.

## What's weak here

- The admin surface (`AdminPanel.jsx`, 1,868 lines) sits behind the ecosystem's most broken authentication implementation (`Authentication.md`) and has no route guard of its own.
- `lib/reviewAI.js`'s Anthropic API call appears to be missing required auth headers — likely non-functional as written (`Service-Catalog.md` addendum).
- No shared component library despite being the larger of the two codebases by a wide margin.
- The stray, accidentally-created directory (a pasted code snippet run as a shell command) sits inside this app's `src/lib/` — see `Folder-Structure.md`.
