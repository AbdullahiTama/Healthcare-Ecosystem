CareHub Ecosystem — Senior Staff Engineer Onboarding Report

0. What this repo actually is

The root HealthCare-Ecosystem folder is not itself a git repository. It contains planning/documentation scaffolding (mostly empty templates) plus two independent applications under apps/:

- apps/carehub — the internal SaaS product ("CareHub"). Has its own nested .git, remote origin = github.com/AbdullahiTama/skincarepro. Vite + React 18, no backend of its own — talks straight to Supabase's REST endpoint.
- apps/carefind/carefind-main — the public discovery/social platform ("CareFind"). No git repo of its own found. Vite + React 18 + Vercel serverless functions (api/*.js) + Supabase.

The skincarepro remote name, combined with 'skincare' being the default/first entry in BUSINESS_TYPES and the fallback business type throughout CareHub, strongly indicates CareHub was originally a skincare-spa POS product that was repurposed into a general healthcare platform. Hospital-specific modules (Triage, Doctor, Lab, Imaging, Rx Inbox) read as later additions bolted onto a retail/POS data model rather than a ground-up clinical design.

---
1. Folder Structure

HealthCare-Ecosystem/
├── .claude/                  agents, commands, empty context/rules/checklists/templates dirs
├── docs/                     PROJECT_OVERVIEW, ONBOARDING, SESSION_WORKFLOW, spec template
├── knowledge/business/       vision, product principles
├── knowledge/glossary/       domain terms
├── knowledge/workflows/      master patient-journey workflow
├── knowledge/modules/        empty — no per-module documentation exists
├── planning/                 roadmap.md, CODE_AUDIT.md (audit is an empty checklist)
├── prompts/                  09 numbered prompt templates for AI-driven dev process
├── templates/                architecture/module doc templates (unused so far)
├── architecture/, decisions/ empty directories
└── apps/
    ├── carehub/               internal SaaS (own git repo)
    │   └── src/{pages,components,lib}
    └── carefind/carefind-main/  public app (flat src/, no subfolders)

CareHub is organized (pages/, components/{layout,ui}, lib/). CareFind is flat — ~45 top-level .jsx/.js files directly in src/ with no folder structure. This is a real structural asymmetry between the two products in the same "ecosystem."

There is also a stray artifact worth flagging directly: a directory literally named
apps/carefind/carefind-main/import { createClient } from '@supabase/supabase-js'  const supabaseUrl = 'https_/src/lib/supabaseClient.js
— clearly the result of a pasted code snippet being run as a shell command (unescaped mkdir/redirection) rather than saved as a file. It's inert junk but pollutes the repo and should be removed.

---
2. Architecture

There is no backend service layer, no ORM, and no database schema tracked in version control anywhere in this repo — no migrations, no SQL files, no supabase/ config. The schema exists only inside the live Supabase project. Both frontends are thin clients that talk directly to Postgres via PostgREST:

- CareHub: hand-rolled sbFetch() wrapper in lib/supabase.js builds PostgREST query strings by hand ('products?business_id=eq.' + id) using the publishable/anon key, hardcoded in source (lib/supabase.js and duplicated again in lib/realtime.js, and again inline in several hospital pages per the earlier grep). No supabase-js query builder is used for CRUD — only for the realtime websocket channel.
- CareFind: uses @supabase/supabase-js properly via a shared client (lib/supabaseClient.js) and real supabase.auth.* for its consumer-facing accounts. Admin functionality instead goes through bespoke Vercel serverless functions (api/admin-auth.js, api/admin-setup.js) that talk to Postgres with the service-role key.

So the two products don't share an architecture at all — they're two different applications with two different auth systems and two different data-access patterns, joined only by pointing at the same Supabase project and by a CareFind tab embedded inside CareHub's dashboard.

There's no service layer separating business logic from data access (lib/supabase.js mixes both), and no client-side caching/query layer (no React Query/SWR) — every screen fetches directly on mount.

---
3. Routing

- CareHub (App.jsx): a single top-level <Routes> with 5 routes. Auth-gating is done inline in the element prop (auth && !auth.isAdmin ? <BusinessDashboard/> : <Navigate/>). BusinessDashboard and AdminDashboard each presumably own their own nested routing for the dozens of dashboard pages (Inventory, POS, Staff, etc.) — reasonable structure, but there is no route-level code splitting; every dashboard page is bundled eagerly.
- CareFind (main.jsx): ~28 flat routes declared directly at the ReactDOM.createRoot call, bypassing App.jsx entirely. App.jsx (a full component with its own search implementation) is dead code — it's never imported by main.jsx or anything else. Only AdminPanel is lazy-loaded; everything else (Feed, Search, Dashboard, LiveSession, etc.) loads eagerly, which will hurt initial bundle size as the product grows.
- No route guards exist in CareFind's router. /dashboard, /business-dashboard, /professional-dashboard, /admin-panel are all reachable directly; whatever protection exists must live inside each component (not verified here, but the router itself enforces nothing — unlike CareHub's explicit gating).

---
4. Authentication — the most serious finding in this codebase

There are three separate, mutually inconsistent auth systems live in this "ecosystem," two of which are critically broken:

a) CareHub business/staff login (lib/supabase.js + pages/auth/Login.jsx)
Passwords are compared with a raw PostgREST equality filter: staff?email=eq.X&password=eq.Y. This means:
- Passwords are stored in plaintext in the businesses/staff tables (confirmed — Register.jsx sends password: data.password straight to the insert, no hashing anywhere client- or server-side).
- The password is sent as a URL query parameter to Supabase on every login attempt — plaintext credentials end up in server access logs, browser history, and any request logging/proxying layer.
- Authorization for every subsequent request relies on the anon/publishable key with no per-user JWT. Row-level access is presumably enforced by Supabase RLS policies (not present in this repo to verify), but since the anon key can read/write businesses, staff, patients, sales, etc. directly with only a business_id filter that the client supplies, any user of the app can potentially query or mutate any other business's data — including patient records — simply by changing the business_id in a hand-crafted request, unless RLS policies (which live only in the Supabase dashboard, outside this repo) genuinely lock this down. This cannot be verified from the codebase itself, which is itself a governance problem: security-critical policy lives entirely outside version control.
- A super-admin account is hardcoded directly in client-side source: ADMIN_EMAIL = 'admin@carehub.ng', ADMIN_PASS = 'Admin@2025' in Login.jsx, shipped in the JS bundle to every visitor.

b) CareFind admin login (api/admin-auth.js)
- hashPassword() is `cf_hashed_${password}` — string concatenation, not a hash. Trivially reversible and not a real credential protection at all.
- generateToken() is base64(adminId|role|timestamp) — not signed (no HMAC/JWT). Any client can forge a valid "session" for any admin ID and any role, including super_admin, by base64-encoding a string themselves. verifyToken() only checks that the base64 decodes into 3 parts and that the timestamp is <24h old — it does not verify authenticity at all. This is a full authentication bypass.

c) CareFind admin bootstrap (api/admin-setup.js)
- This is a live, deployed endpoint that creates or resets the super-admin account. It's gated only by a query-string key (?key=...) checked against process.env.ADMIN_SECRET_SALT, which falls back to a hardcoded literal 'carefind_admin_2024_secure' if the env var isn't set. It returns the plaintext admin password (CareFind@Admin2024!) in the JSON response. If this endpoint is still deployed and the env var was never overridden, anyone who finds the URL can create/reset super-admin access.
- Worse: this file hashes passwords correctly (real SHA-256 + salt via crypto.subtle.digest), which does not match the fake cf_hashed_ scheme used by admin-auth.js's login handler. As written, an admin account created via admin-setup.js would almost certainly fail to log in through admin-auth.js, or the two files represent divergent, never-reconciled iterations of the same feature. Either way it's evidence the admin auth path has not been exercised end-to-end.

d) CareFind consumer auth (lib/AuthContext.jsx)
This one is done correctly — thin wrapper around real supabase.auth.signUp/signInWithPassword/signOut with a session listener. This is the only auth path in the whole ecosystem that meets baseline standards.

Given the CLAUDE.md mandate ("Never weaken authentication. Never bypass permissions. Never expose secrets."), (a), (b), and (c) above are pre-existing violations of the project's own stated security bar, not hypothetical risks.

---
5. State Management

No global state library (Redux/Zustand/Context-heavy architecture) in either app.

- CareHub: one AuthContext (React Context) at the top of App.jsx holding { auth, login, logout, isAdmin }, persisted to localStorage['carehub_auth'] as a raw JSON blob (business + staff object + role). Everything else is local useState per page, fetched fresh on mount. There's a small offline-queue mechanism in lib/supabase.js (queueOfflineSale/syncOfflineSales) that buffers POS sales in localStorage when offline and replays them — a genuinely useful piece of the "Offline First" principle from PRODUCT_PRINCIPLES.md, and one of the better-engineered corners of the codebase.
- CareFind: AuthContext wraps real Supabase auth/session state; everything else (search results, feed, dashboards) is local component state, refetched per screen.

Predictable in the sense that there's little hidden global mutation, but there's also no caching, no request deduplication, and no optimistic-update pattern — every navigation re-fetches from scratch.

---
6. Services

There is no dedicated "services" layer as CLAUDE.md's philosophy calls for ("Business logic belongs in services"). In CareHub, lib/supabase.js is simultaneously the data-access layer and the business-logic layer — e.g. transferStock() and adjustStock() compute quantity diffs and write stock-movement audit rows inline; createOrder()/advanceOrder() embed notification-fan-out logic inline. It works, and the file is thoughtfully commented at the "why" level (good adherence to the comment philosophy), but at 680+ lines with zero separation between "talk to Postgres" and "domain rule," it will get harder to test and reuse as more modules are added. lib/email.js (356 lines) and lib/permissions.js are the only other quasi-services; lib/reviewAI.js is an empty file (0 bytes) — presumably a stub for a planned AI review-response feature that was never implemented, referenced by name in the roadmap's Phase 4 ("AI Features") but not built.

CareFind has no lib service layer to speak of beyond the Supabase client and small utilities (sentiment.js, articleFormat.js, imageResize.js) — most business logic lives directly inside 40+ page-level components.

---
7. Components

CareHub has a small, real shared UI kit (components/ui/index.jsx): Pill, Card, StatCard, TealBtn/DarkBtn/GhostBtn/RedBtn, SectionHead, Inp, etc. — all styled with inline style={} objects, no CSS modules/Tailwind/styled-components. This is consistent at least, but means no design tokens beyond the two gradient constants in lib/utils.js, no theming system, and larger components (dozens of dashboard pages) will carry a lot of repeated inline style objects.

CareFind has essentially no shared component library — each of its ~45 files is a self-contained page/feature component (e.g., GiftPanel.jsx, VoiceRecorder.jsx, SlideUploader.jsx, LiveSession.jsx) suggesting a broad, fast-growing consumer feature set (live streaming, gifting/wallet, playlists, news) with little cross-cutting reuse — very different in character from CareHub's operational-SaaS surface.

---
8. Utilities

lib/utils.js (CareHub) is small and clean: currency/date formatters (fmt, fmtDate), Nigeria-specific constants (NIG_STATES), and the BUSINESS_TYPES list that drives nav/theming per vertical. genId() generates transaction IDs via Math.random() — fine for a display label, but not safe as a unique identifier or idempotency key if it's relied on anywhere beyond cosmetic display (worth checking call sites before trusting it for anything transactional).

CareFind utilities are scattered rather than centralized (imageResize.js, sentiment.js, voiceCard.js, notify.js at the src root rather than in a lib/ or utils/ folder) — consistent with the flat-structure observation in §1.

---
9. Database Interactions

Both apps hit Postgres through PostgREST, but through different doors:

- CareHub: raw fetch() + hand-built query strings with the anon key, everywhere, for every table (~30+ tables referenced: businesses, staff, products, sales, clients, expenses, appointments, debts, purchases, patients, triage, consultations, prescriptions, business_settings, admin_team, staff_notifications, enterprise_locations, staff_claims, territories, rep_territories, internal_messages(+recipients/files), stock_batches, stock_movements, orders(+items/watchers/files/events), activity_fields, activity_default_viewers, field_activities(+viewers/reactions/comments)). That's a large, entirely undocumented schema with zero migration files or ERD anywhere in the repo — the true source of truth for the data model exists only inside the live Supabase project.
- CareFind: proper supabase-js query builder for consumer reads (businesses, products, joins via businesses(...) embedding) — a materially better pattern than CareHub's manual string concatenation, though string interpolation into .ilike()/.or() filters should still be reviewed for injection-style query manipulation (Supabase's client escapes values in most cases, but hand-built .or() filter strings like `name.ilike.%${query}%,generic_name.ilike.%${query}%` deserve a second look if query can contain PostgREST-special characters like commas or periods).
- File uploads (message attachments, order files, voice notes) go straight to Supabase Storage via raw REST calls with the anon key, sanitizing only the filename — no evident file-type/size validation before upload.

No migrations, no schema versioning, no seed data, no local dev database setup documented anywhere — a new engineer cannot stand up this project's data layer without already having access to the live Supabase project's dashboard.

---
10. Current Strengths

- Domain modeling in the knowledge base is genuinely useful: glossary (FEFO, Encounter, Dispensing), the master patient-journey workflow, and per-business-type nav/permission mapping (ALL_NAV_HOSPITAL vs ALL_NAV_ENTERPRISE vs default) show real healthcare-domain thinking, not generic CRUD scaffolding.
- Role/permission matrix (permissions.js) is centralized, declarative, and drives both navigation and capability checks (can(role, action)) from one source — a solid pattern, even though it's client-side only (see §4).
- Offline-first POS queueing in CareHub is a real, working implementation of a stated product principle, not just aspirational documentation.
- CareFind's payment webhook correctly verifies the Paystack HMAC signature and guards against double-processing via a reference lookup — this is the one piece of payment/security code in the repo done to a professional standard.
- CareFind's consumer auth correctly delegates to Supabase Auth rather than reinventing it.
- Inline code comments throughout lib/supabase.js follow the "explain why, not what" discipline well (e.g., the notification-swallowing comment, the FEFO-adjacent stock-transfer logic).

---
11. Current Weaknesses

- No enforced separation of concerns: data access, business rules, and side effects (notifications) are interleaved in the same functions throughout lib/supabase.js.
- Two entirely different tech/security postures between CareHub and CareFind for what's marketed as one ecosystem — a new contributor has to learn two different auth models, two different data-access idioms, and two different file-org conventions.
- No design system beyond inline styles — will not scale gracefully as the UI surface grows (already ~30 dashboard pages in CareHub alone).
- Dead code: CareFind's App.jsx is fully unused; reviewAI.js is an empty stub.
- No tests anywhere — neither package.json lists a test runner, and no __tests__/*.test.*/*.spec.* files were found in either app.
- No environment-based config — no .env files, no .env.example; Supabase URL and anon key are literal strings baked into multiple source files instead of import.meta.env.*, so rotating a key requires a code change and redeploy, not a config change.

---
12. Technical Debt

- Supabase anon key hardcoded and duplicated across at least 6+ files (lib/supabase.js, lib/realtime.js, Doctor.jsx, Imaging.jsx, Lab.jsx, CareFind's supabaseClient.js, plus the stray junk file) instead of one shared client module — classic violation of "Never duplicate code."
- CareHub's entire data layer bypasses supabase-js's query builder in favor of hand-rolled fetch + string concatenation, which is both a maintainability and a correctness risk (no client-side escaping guarantees on interpolated filter values).
- admin-auth.js vs admin-setup.js password-hashing mismatch (§4b/c) is a live functional bug, not just a security issue — the admin login path may not work at all against admin-setup-created accounts.
- Stray malformed directory in carefind-main from an accidental shell command — should be deleted.
- No schema/migrations under version control — the database is effectively unmanaged as code, contradicting the "Scalability" and "Maintainability" principles in PRODUCT_PRINCIPLES.md.
- planning/CODE_AUDIT.md is a template with every section empty — the audit this project claims to maintain has never actually been filled in.

---
13. Missing Documentation

- knowledge/modules/ is completely empty — there is no per-module documentation for any of CareHub's ~20 dashboard modules (POS, Inventory, Staff, Hospital sub-modules, etc.), despite MODULE_DOCUMENTATION_TEMPLATE.md existing specifically for this purpose.
- architecture/ and decisions/ directories are empty — no ADRs exist despite CLAUDE.md's instruction to "propose improvements before implementing" when architecture is weak, and despite the roadmap's Phase 1 explicitly calling for "complete architecture documentation."
- No database schema documentation/ERD anywhere, despite the data model being the single largest piece of undocumented surface area in the project (30+ tables inferred purely from reading query strings in lib/supabase.js).
- No documentation of the CareHub ⇄ CareFind relationship at the data level (e.g., what makes a product/business "visible" cross-platform — visible_on_carefind/list_on_carefind flags exist in the code but are undocumented).
- No auth/security model documentation — given the findings in §4, this is the most urgent documentation (and remediation) gap in the project.
- README.md for each individual app (apps/carehub/README.md exists but wasn't reviewed above) may fill in some app-specific detail; worth a follow-up pass if useful.

---

## Addendum — The Verified CareHub ↔ CareFind Relationship

This section was added after direct inspection of CareFind's live search/profile screens and admin panel, specifically to test the ecosystem's stated architecture philosophy ("CareFind consumes data originating from CareHub; it never owns business data") against implementation. The finding is more nuanced than either the docs or §2 above assumed at the time of writing, and full detail now lives in the dedicated documents this addendum points to:

1. **CareFind is not primarily a healthcare discovery platform in implementation.** Of ~48 source files and ~15,400 lines in `apps/carefind/carefind-main/src`, the overwhelming majority implement a social feed, live-streaming, creator-monetization, gifting, and wallet platform (`Feed.jsx` alone is 1,823 lines; `AdminPanel.jsx` is 1,868 lines). Only `Search.jsx`, `BusinessProfile.jsx`, and `DrugProfile.jsx` are genuinely "healthcare discovery" in the sense `docs/PROJECT_OVERVIEW.md` describes. See **CareFind-Architecture.md**.
2. **The data-ownership claim is partially false in both directions.** CareFind reads real CareHub-owned tables (`businesses`, `products`) correctly, but also owns real "business data" itself (`reviews` — ratings/comments tied to a `business_id`, authored via CareFind's own auth, with no CareHub awareness), and depends on `products` columns (`whatsapp`, `image_url`, `sale_type`, `min_purchase`, `seller_location`) that CareHub's own `Inventory.jsx` `ProductModal` has no field to ever set. See **Shared-Services.md**.
3. **One genuinely well-built cross-product workflow exists:** `staff_claims`. A CareFind end-user can claim to be a specific staff member listed in CareHub; CareHub's own `Staff.jsx` approves or rejects that claim. This is real, working, two-way integration through a shared table — the model the rest of the ecosystem's cross-product surfaces should be judged against, not an exception. `business_claims` (CareFind users claiming ownership of a CareHub business, approved via CareFind's own `AdminPanel.jsx`, which then writes back to CareHub's `businesses.visible_on_carefind` field) is the second such bridge. See **Shared-Services.md**.
4. **An unresolved, high-priority schema risk:** both products independently use a table named `consultations` for two unrelated concepts — CareHub's is a clinical record (diagnosis, exam notes); CareFind's is a paid-consultation-booking record for its creator-monetization feature. Whether these are the same physical table (a serious collision) or two logically separate tables sharing a name could not be determined from source code alone and should be the first thing verified against the live Supabase schema. See **Database.md** and **Security-Risks.md**.
5. **A striking cross-product echo:** both codebases contain an identically-named, identically-purposed `lib/reviewAI.js`. CareHub's is a 0-byte empty stub; CareFind's is a full, working (if possibly mis-configured — see Service-Catalog.md addendum) integration with the Anthropic API for AI-powered review analysis. The same feature was evidently planned for both products under the same filename and built in only one.

The 15-document set in this `architecture/` folder now covers each of these threads in dedicated detail — see **Ecosystem-Overview.md** for the current index.