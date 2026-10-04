# CareFind — Full Product, Code & UX Audit + Competitive Benchmark

Date: 2026-10-04 · Scope: `apps/carefind` (frontend, `api/` serverless, tracked SQL) · Mode: **read-only audit, no code changed** (per `.claude/commands/audit.md`).

Method: read `README.md`, `docs/PROJECT_OVERVIEW.md`, `planning/roadmap.md`, `planning/CODE_AUDIT.md`, `CAREFIND_ARCHITECTURE.md`, `CAREFIND_UPDATED_FEATURE_STATUS.md`, then the implementation (routing, discovery, profiles, navigation, auth, API handlers). Ran the test suite and a production build. Live Supabase advisors could **not** be pulled (the connector has no permission on project `szdybxmgmhndoytqanfb`), so database findings come from tracked SQL only and must be confirmed against the live DB.

Baseline:

| Check | Result |
|---|---|
| Tests | 367/367 pass, but **1 suite fails to load** (`src/test/payments/consultations.test.js` imports the real Supabase client and throws without `.env`) |
| Build | Clean, but **one 1.17 MB JS chunk (313 KB gzip)**. Only `AdminPanel` is code-split |
| Size | ~36.6k LOC. Largest files: `Feed.jsx` 2,612 · `AdminPanel.jsx` 2,010 · `PublicProfile.jsx` 1,044 · `Profile.jsx` 1,025 |
| Styling | **3,040 inline `style={{}}` objects** vs 66 `className`s; no dark mode; 3 reduced-motion checks |

---

## 1. Executive summary

1. **There is a live, critical admin-auth bypass** (§4, S1). Admin tokens are unsigned base64 strings, and most admin actions accept *any* well-formed token. Anyone on the internet can approve withdrawals, approve business claims, delete users and posts, and publish promotions. **Fix this before anything else in this document.**
2. **CareFind's identity is split.** The README calls it a "public healthcare discovery platform", but the code is mostly a social/creator app: feed, live shows, gifts, wallet, playlists. Discovery ("MedMarket") is one tab out of five. A patient who opens `/` lands on a **B2B marketing page** (`ForBusiness`). When they tap Home they get a **social feed**, not search.
3. **The discovery core is thinner than the competition's.** It has no map, no "open now", no ratings in result lists, no price comparison across sellers in search, no stock signal, no prescription/medicine-safety information and no SEO. Nigerian competitors such as Famasi, myMedicines, Pharmarun and MedPlus already offer price comparison, prescription upload, delivery and stock checks.
4. **CareFind's differentiator is real and underused.** No competitor has **CareHub's live operational data** (real inventory, real hours, real booking slots from the providers' own POS/clinic software) plus **verified professionals** plus **WhatsApp-native contact**. The strategy below is built on that.
5. **The landing page makes claims the product does not support.** "Every review comes from a verified visit", "every business is verified" and "compare side by side" are not true today. It also shows testimonials that read as invented and a "partners" strip naming real Nigerian hospitals and pharmacies. That is a trust and legal risk for a health product.

---

## 2. Architecture report

### 2.1 Shape

```
Browser (Vite/React 18 SPA, React Router v6, no data cache)
  ├── supabase-js (anon key) ──► Supabase Postgres + RLS  ← most reads/writes, straight from page components
  └── fetch /api/* ──► Vercel single function api/router.js ──► _handlers/* (service-role)
                                                         └── Paystack (payments, transfers)
```

- **Routing (`src/main.jsx`)**: 36 routes, all statically imported except `AdminPanel`. Public: `/`, `/feed`, `/search`, `/business/:id`, `/drug/:name`, `/u/:id`, news, live and playlists. Auth-gated through `RequireAuth`. Admin uses a separate `admin_token` in `localStorage`.
- **State**: `AuthContext` plus local component state. There is no query cache, so every screen refetches on mount, and `BottomNav` runs 2 queries on **every route change** (`components/BottomNav.jsx:30-48`).
- **Layout**: `AppShell` (desktop: header + left/right sidebars) vs `BottomNav` (mobile). Each page hand-branches `isMobile ? … : <AppShell>`, and that branching is duplicated in every page.
- **Design tokens**: `styles/theme.js` re-exports `packages/design-system/src/theme.js`. Tokens exist, but they are used through inline styles rather than CSS classes or components.

### 2.2 Business logic, discovery domain

| Flow | Where | How it works |
|---|---|---|
| Product search | `Search.jsx:154-180` | `ilike` on name/generic/category, `limit(100)`, newest first. Location filter and `list_on_carefind` are applied **client-side**. "Near me" is a client haversine sort |
| Facility search | `Search.jsx:119-146,181-195` | Server-side `status='active' AND visible_on_carefind`, pages of 40 |
| Professional search | `Search.jsx:196-205` | `profiles.is_verified=true`, `limit(40)`, no pagination |
| Drug page | `DrugProfile.jsx:42-108` | Products are grouped by **fuzzy `ilike '%name%'`** on the URL string. Reviews are pooled across every matched product |
| Facility page | `BusinessProfile.jsx` | Profile, contact, Google Maps link, free-text hours, products, reviews and a booking card that calls `/api/booking` (anonymous, service-role) |
| Contact | `shared-marketplace` | `whatsappLink`/`telLink` with Nigerian `080→+234` normalisation, in one place (good) |

### 2.3 What is genuinely good

- WhatsApp + Call on every buyer surface, with normalisation centralised in a shared package.
- Booking validates slot, date, type and eligibility server-side, and checks for double booking (`api/_handlers/booking.js`).
- Wallet and withdrawals are atomic RPCs with server-verified identity and Paystack account-name resolution.
- Markdown renderer is XSS-safe (React text nodes, href allow-list).
- Loading, empty and error states exist on most discovery screens, and touch targets are ≥44px on most controls.
- The documentation and audit discipline is strong. The gaps below are mostly *product* and *UX* gaps, not neglect.

---

## 3. Competitive benchmark

Comparables: **Famasi, myMedicines, Pharmarun, MedPlus, PharmaTrack** (Nigeria, medicine access); **DrugStoc** (Nigeria, B2B supply); **Practo** (India), **Zocdoc** (US), **GoodRx** (US) as the global reference for doctor discovery, booking and drug pricing.

| Capability | CareFind today | Nigerian peers | Global reference | Gap |
|---|---|---|---|---|
| Medicine search | ✅ name/generic | ✅ | ✅ | — |
| Price comparison across sellers | ⚠️ only on drug page ("lowest price") | ✅ Famasi, PharmaTrack | ✅ GoodRx core | **High** |
| Live stock / availability | ❌ (CareHub has stock; search ignores it) | ⚠️ MedPlus Assist checks stock | ⚠️ | **High, and CareFind is best placed to win it** |
| Map view / directions | ⚠️ "Directions" link only | ⚠️ | ✅ | High |
| Open now / structured hours | ❌ free-text `hours` | ⚠️ | ✅ | High |
| Ratings in result list | ❌ (only "See reviews" link) | ✅ | ✅ | High |
| Filters (open now, distance, rating, price, Rx/OTC, delivery) | ⚠️ location + sale type only | ✅ | ✅ | High |
| Book appointment | ✅ slot request + Paystack/CareCoins | ⚠️ | ✅ Zocdoc real-time | Medium (real-time slots from CareHub) |
| Prescription upload | ❌ | ✅ myMedicines, Famasi | ✅ Practo | Medium |
| Delivery / pickup | ❌ (WhatsApp hand-off) | ✅ core offer | ✅ | Strategic choice (partner, don't build) |
| Refill reminders / chronic care | ❌ | ✅ Famasi auto-refill | ✅ | Medium |
| Drug information & safety | ❌ (no indications, warnings, Rx flag, NAFDAC no.) | ⚠️ | ✅ | **High (patient safety)** |
| Verified professionals | ✅ role badges | ❌ | ✅ | **Differentiator** |
| Telehealth / consultation | ✅ paid consultations | ✅ Famasi | ✅ | — |
| WhatsApp-native contact | ✅ everywhere | ⚠️ PharmaTrack | ❌ | **Differentiator** |
| Provider-side SaaS feeding live data | ✅ CareHub | ❌ | ⚠️ Zocdoc syncs calendars | **Strongest differentiator** |
| SEO (indexable drug/facility pages) | ❌ SPA, no per-page title/meta | ✅ | ✅ | **High (main acquisition channel)** |
| Offline / low data / PWA | ❌ no manifest, no SW | ⚠️ | — | High for the Nigerian market |
| Local languages | ❌ | ⚠️ | — | Medium (Hausa/Yoruba/Igbo/Pidgin) |
| Social feed / live / gifts | ✅ large | ❌ | ❌ | Unique, but it dilutes the core job |

### 3.1 Positioning recommendation

Do not compete with Famasi or myMedicines on delivery logistics. Compete on **trust and truth of data**:

> **"CareFind: see who actually has your medicine, at what price, open right now near you, and talk to them on WhatsApp in one tap, from pharmacies and clinics running on CareHub."**

That promise is only possible because CareHub sits under it:

1. **"In stock" badges** from CareHub inventory (`products.stock` is already read on the drug page, `DrugProfile.jsx:56-60`, but never surfaced as a badge, a filter or in search).
2. **"Open now"** from structured hours entered in CareHub settings.
3. **Real-time booking slots** from CareHub appointments, not static comma-separated slots.
4. **A "CareHub-verified" tier**: facilities whose stock and prices are system-sourced rank above self-declared listings.
5. **Verified-visit reviews**: allow a review only after a CareHub sale or appointment. This makes the landing-page claim true and is something no competitor can copy without the SaaS layer.

---

## 4. Security findings

| # | Severity | Finding | Evidence |
|---|---|---|---|
| **S1** | **Critical** | **Admin token is forgeable and most admin actions don't check the database.** `generateToken` = `base64(adminId|role|timestamp)` with no signature. `verifyToken` only base64-decodes and checks age. `approve_claim`, `approve_withdrawal`, `delete_user`, `delete_post`, `create_promotion`, `approve_news` and others call only `verifyToken`, so a token built in a browser console as `btoa('x|super_admin|'+Date.now())` passes. Super-admin-only actions trust `payload.role` from the same unsigned token | `api/_handlers/admin-auth.js:15-29, 58-61, 105-115, 234-246` |
| **S2** | **Critical** | **Admin passwords are effectively plaintext.** The "hash" is `cf_hashed_${password}` | `admin-auth.js:11-13` |
| **S3** | **Critical** | **`admin-setup` resets the super admin to a password committed in the repo** (`CareFind@Admin2024!`). The setup key falls back to a hardcoded string when `ADMIN_SECRET_SALT` is unset, and the password is returned in the response. It also hashes with SHA-256, which doesn't match login's scheme, so the endpoint is both dangerous and broken | `api/_handlers/admin-setup.js:8-55` |
| S4 | High | `credentials` storage bucket is public: professional licences and IDs are readable by URL (already noted in feature status, still open) | `VerifyProfessional.jsx:90-97` |
| S5 | High | `reviewAI.js` calls `api.anthropic.com` **from the browser with no key**, so it always fails. The tempting "fix" (adding a key client-side) would leak a secret. Review text is also placed into the prompt unescaped (prompt injection). Move it to a server handler or remove it | `business-profiles-reviews/reviewAI.js:36-44` |
| S6 | Medium | Raw user input is interpolated into PostgREST `.or()` filter strings. A comma or parenthesis in a search breaks the query, and filter syntax can be injected (bounded by RLS and the ANDed `status` filter, but fragile). `ilike` wildcards (`%`, `_`) are not escaped | `Search.jsx:126,156,198`; `DrugProfile.jsx:50` |
| S7 | Medium | Anonymous `/api/booking` has no rate limit or bot check, so slots can be spammed | `booking.js` header comment |
| S8 | Medium | Reviews: one-review-per-user is enforced only client-side. No unique constraint is found in tracked SQL (verify live). Fake-review risk | `DrugProfile.jsx:93-98` |
| S9 | Low | Admin token in `localStorage` (XSS-readable). Acceptable only once S1 is fixed with short-lived signed tokens; better to migrate admins to Supabase Auth + `profiles.is_admin`, which the feed-config RPCs already use | `AdminLogin.jsx:35` |

**Recommended S1–S3 fix (proposal, not implemented):** retire the bespoke admin system. Admins sign in with Supabase Auth; every admin action verifies the JWT with `verifyUser` and checks `profiles.is_admin` (or an `admin_users.user_id` link with role) **from the DB on every call**. Delete `admin-setup.js`. Rotate every admin password, since the old values were stored reversibly and the table was anon-readable until 2026-08-15.

---

## 5. Correctness & data-integrity findings

| # | Finding | Evidence |
|---|---|---|
| D1 | **Suspended or pending businesses' products leak into the drug page.** Search requires `status='active'`, but the drug page checks only `visible_on_carefind` | `DrugProfile.jsx:56-60` vs `Search.jsx:121-122` |
| D2 | Product search doesn't filter by business status or stock at all, and its featured fallback ignores visibility | `Search.jsx:103-109,155` |
| D3 | **Drug identity is a fuzzy string.** `/drug/Para` pools "Paracetamol", "Paracetamol Extra" and "Paracetamol syrup" and averages their reviews together. A normalised `medicines` catalogue (generic + strength + form) is needed for comparison to mean anything | `DrugProfile.jsx:50` |
| D4 | Filters fire a query **and a `search_logs` insert on every keystroke** (location and specialty inputs are effect dependencies). There is no debounce and no stale-response guard, so results can flash out of order | `Search.jsx:88, 210-219` |
| D5 | Internal errors are shown to users ("Search log failed: …") while review-submit failures are silent (`console.error` only) | `Search.jsx:218`; `DrugProfile.jsx:127` |
| D6 | Product search is capped at 100, then filtered client-side, so results can be silently missing. No product or professional pagination | `Search.jsx:164-167, 201` |
| D7 | Location is mixed: `lat/lng` vs `latitude/longitude` coalesced in JS, and Nearby feed uses text-token matching. No PostGIS, so "near me" cannot scale past client-side sorting | `CAREFIND_ARCHITECTURE.md §9` |
| D8 | Test suite isn't hermetic (see Baseline). One suite needs real env to load | `consultations.test.js` |

---

## 6. UI/UX audit

### 6.1 Information architecture (biggest UX issue)

- `/` = B2B "For Business" page; Home = social feed; discovery is labelled **"MedMarket"** on mobile and **"Discover"** on desktop (`BottomNav.jsx:85` vs `LeftSidebar.jsx:13`). Three names for one product.
- A patient's primary job (*find medicine or care near me, now*) sits behind a marketing page and a social feed.
- **Recommendation:** make search the home for logged-out users (`/` → discovery landing with a single search box and "near me"). Move the B2B pitch to `/for-business`. Keep the feed as a tab, and use one name ("Find" or "Discover") everywhere.

### 6.2 Discovery screens

| Issue | Standard / competitor practice | Fix |
|---|---|---|
| No map | Split list/map is the norm (Practo, Zocdoc) | Map toggle on facilities and products (Leaflet + OSM to avoid Maps billing) |
| Result cards lack decision data | Rating ★, review count, distance, open-now, in-stock, price — all on the card | Redesign `ResultCard`; data already exists for rating and distance |
| Filters are limited and differ per tab | Chips: Open now · In stock · Distance · Rating 4+ · Price · Rx/OTC · Delivery · Accepts booking | Shared filter bar; bottom sheet on mobile |
| No autocomplete or typo tolerance | Suggest drugs/generics as you type; "Did you mean" | `pg_trgm` search RPC with debounced suggestions |
| Empty product state shows nothing without a query | Popular searches, categories, recently viewed | Zero-state content |
| "Near me" is disabled with no explanation if permission was never asked | Explain and offer a "Use my location" button | Ask on intent, not on mount (the hook currently prompts on page load) |
| Auto-scrolling marquee | WCAG 2.2.2 requires pause for moving content >5s. It ignores reduced-motion and duplicates items for screen readers | Static swipeable carousel with pause; `aria-hidden` on the duplicate set |
| Drug page has no medical info | Generic, strength, form, Rx/OTC, warnings, NAFDAC reg. no., "talk to a pharmacist" | Medicine catalogue + safety block + disclaimer |
| Facility page: free-text hours, no photos gallery, no services list | Structured hours with today highlighted, services, insurance/HMO accepted | Structured fields in CareHub settings |

### 6.3 Accessibility (WCAG 2.2 AA)

- Category tabs and filter chips are `<button>`s with no `aria-pressed`/`role="tab"`/`aria-selected`, so state is conveyed by colour only.
- `BottomNav` is a `<div>`, not `<nav aria-label>`, and has no `aria-current="page"`.
- 27 `onClick` handlers on `div`/`span`/`p` are not keyboard-operable.
- Placeholder-only inputs (specialty field has no label).
- No route-change focus management or announcements. No per-page `document.title` (screen readers and browser history all say "CareFind").
- Small text: many 9–10.5px labels (`fontSize: 9.5`, `10`, `10.5`) fall below a legible minimum. Contrast of `gray300`/`textLight` on white needs checking.
- Positive: global `:focus-visible` outline exists, aria-labels on icon buttons are common (503 `aria-*`), and `VideoPlayer` respects reduced motion.

### 6.4 Visual / design-system consistency

- 3,040 inline style objects make consistency impossible to enforce. The WhatsApp/Call button pair, for example, is hand-written at least 5 times (Search ×2, DrugProfile, BusinessProfile ×2).
- Gradient hero on Search contradicts the design docs' "no gradients" rule, which CareHub follows.
- Hover/press effects are done by mutating `style` in `onMouseDown`/`onMouseUp`, which skips keyboard and touch-cancel cases.
- No dark mode. Not required, but expected by many users on low-end OLED Android phones (battery).

### 6.5 Performance (matters most for Nigerian mobile networks)

- 313 KB gzip JS before first paint for every route, including `gsap` + `ScrollTrigger` (landing only) and both `react-icons` and `lucide-react` (two icon sets). Recommended: route-level `lazy()` for every page, drop `react-icons`, lazy-load gsap. Target <150 KB initial.
- No PWA: no manifest, no service worker, no install prompt, no offline shell. Competitors on Android are native apps; a PWA closes most of that gap cheaply.
- Third-party Unsplash images on the landing page (hotlinked, unsized).
- No data cache: back-navigation refetches everything (React Query/SWR would add stale-while-revalidate and request de-duplication).

### 6.6 Trust & content

- Landing page claims (verified visits, every business verified, side-by-side compare) are not true yet (`ForBusiness.jsx:14-25`). Either make them true (§3.1) or reword now.
- Testimonials with first-name-plus-initial personas, and a partner strip naming **Lagos State Hospital, MedPlus, Reddington Hospital, HealthPlus, ecare Africa** (`ForBusiness.jsx:27-33`). Unless these are signed partners, remove them; this is a legal exposure, not just a UX issue.
- No medical disclaimer, no "in an emergency call 112", no privacy/terms links on discovery pages.

---

## 7. Technical debt

1. God components: `Feed.jsx` (2.6k), `AdminPanel.jsx` (2.0k), `PublicProfile`/`Profile` (1k each); `Profile.jsx` and `PublicProfile.jsx` duplicate story/post/review rendering.
2. No repository/service layer in CareFind: queries live in page components. This contradicts the project rule "business logic belongs in services", and CareHub has already proven the repository-seam pattern.
3. Dead code still shipped: `PostCard.jsx`, `postRepository.js`, `useFeed.js`, `useComments.js` (per `CAREFIND_ARCHITECTURE.md §10`).
4. Duplicated distance-sort logic (`Search.jsx:137-143` and `186-190`) and duplicated contact-button markup.
5. Bespoke admin auth parallel to Supabase Auth (see S1).
6. SQL as loose files, no migration tooling, no CI (already tracked in roadmap §3).
7. No observability: errors go to `console.error`. Add Sentry (or similar) plus a structured server log in `api/`.

---

## 8. Prioritised roadmap

### P0 — this week (security & trust)
1. **S1–S3**: replace admin auth (Supabase Auth + DB role check on every action), delete `admin-setup.js`, rotate admin credentials, review `admin_users` audit trail for forged-token activity.
2. **S4**: make `credentials` bucket private; serve via signed URLs to admins only.
3. **S5**: remove or move `reviewAI` server-side.
4. Remove unverifiable landing claims, testimonials and partner names.
5. **D1/D2**: enforce `status='active'` (and in-stock) consistently. Ideally move to a single `public_listings` view/RPC so the rule lives in one place.

### P1 — next 2–4 weeks (core discovery quality)
6. IA change: discovery-first home, one name, B2B page moved.
7. Search RPC (`pg_trgm`, escaped input, server-side filters, pagination, debounced autocomplete); fixes S6, D4, D6.
8. Result cards with rating, distance, open-now, in-stock, price; shared filter bar.
9. Structured opening hours (CareHub settings → CareFind "Open now").
10. Accessibility pass (§6.3) and per-page titles.
11. Route-level code splitting, drop `react-icons`, PWA manifest + service worker.
12. Hermetic tests + a minimal GitHub Actions gate (test + build).

### P2 — 1–3 months (differentiation)
13. Medicine catalogue (generic/strength/form/Rx flag/NAFDAC) → true price comparison across sellers.
14. "CareHub-verified" listings and verified-visit reviews.
15. Real-time booking slots from CareHub appointments.
16. Map view (Leaflet/OSM) + PostGIS distance queries.
17. Prescription upload to a chosen pharmacy (private bucket, consented, retention policy).

### P3 — later
18. Refill reminders (WhatsApp/SMS), saved medicines, family profiles.
19. Localisation (Pidgin, Hausa, Yoruba, Igbo).
20. HMO/insurance acceptance filter; delivery via partners rather than an in-house fleet.

---

## 9. Test plan for the P0/P1 work (when implemented)

- **Admin auth:** forged/expired/tampered token → 401 on *every* action (table-driven test over the action list); non-admin JWT → 403; admin JWT → 200.
- **Listing eligibility:** pending/suspended/hidden business products never appear in search, featured or drug page (repository tests with in-memory adapter).
- **Search:** inputs containing `, ( ) % _ '` return correct results and don't error; debounce issues one query per settled input; stale responses discarded.
- **Accessibility:** axe checks in Vitest for Search, DrugProfile and BusinessProfile; keyboard-only path from search to WhatsApp contact.
- **Performance:** initial JS budget asserted in CI; Lighthouse mobile ≥ 90 performance / 100 accessibility on `/` and `/search`.
- Manual: 375 / 768 / 1280 widths; slow-3G throttling; location denied vs granted.

---

Sources used for the competitive benchmark:
- [7 digital pharmacy platforms changing how Nigerians buy medicine in 2026 — Technext](https://technext24.com/explainer/7-digital-pharmacy-platforms-in-nigeria/)
- [Famasi](https://www.famasi.me/) · [Pharmarun](https://www.pharmarun.africa/) · [myMedicines](https://liners.com/mymedicines) · [MedPlus Nigeria](https://medplusnig.com/) · [PharmaTrack](https://pharmat.lovable.app/) · [DrugStoc (Google Play)](https://play.google.com/store/apps/details?id=com.drugstoc.app&hl=en)
- [Practo vs Zocdoc — Appscrip](https://appscrip.com/blog/practo-vs-zocdoc/) · [Doctor finder & booking apps like Practo/Zocdoc — Gearheart](https://gearheart.io/blog/creating-doctor-finder-booking-app-practo-zocdoc/) · [Top US healthcare apps (GoodRx) — RipenApps](https://ripenapps.com/blog/top-successful-healthcare-apps-in-usa/)
