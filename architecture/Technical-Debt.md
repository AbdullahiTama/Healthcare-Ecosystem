# Technical Debt Report — Care Ecosystem

Prioritized synthesis across both products, current as of the full component/service/routing catalogue passes. Every item is grounded in a specific file already read during this engagement — see the cross-referenced documents for full evidence per item.

## Methodology

**Effort** (cost to remediate, one engineer familiar with the codebase):
`XS` <1 day · `S` 1–2 days · `M` 3–5 days · `L` 1–2 weeks · `XL` 3+ weeks / requires architectural change

**Risk** (consequence of leaving it as-is):
`Severe` — data breach, clinical harm, financial loss, or core function silently broken · `High` — significant user-facing failure or security exposure under realistic conditions · `Moderate` — degraded UX or maintainability drag · `Low` — cosmetic/hygiene

---

## Critical

| # | Item | Effort | Risk | Reference |
|---|---|---|---|---|
| C1 | CareHub has no real auth session (`auth.uid()` is always null on every request), which makes meaningful per-tenant RLS structurally impossible under the current auth model — not merely "unconfirmed," but architecturally ruled out until C2 lands. No RLS policy is visible in either repo's source (policies live in the database, not the codebase), so CareFind's situation — where real sessions at least make RLS *possible* — still needs direct verification against the live project. **Status: mechanism now in place for both auth state and data requests.** `App.jsx` bootstraps `auth` state from a real Supabase session when one exists (`lib/authClient.js`), and `lib/supabase.js`'s `sbFetch()` now forwards that session's token on every data request too (C10, fixed same session as H11) — so `auth.uid()`/`auth.email()` populate for any account that has migrated and is currently logged in. Still gated on the same two things as before: (1) migration progress (unmigrated accounts have no session to forward — see C2), and (2) the grants-check flagged in C10 (untested whether Postgres role `authenticated` has equivalent access to `anon` today, pre-RLS) | **XL** (depends on C2–C4 first) | **Severe** | `Security-Risks.md` §1 |
| C2 | CareHub passwords stored/compared in plaintext, no session tokens. **Status: migration path shipped, not complete.** `Login.jsx`/`Register.jsx`/`App.jsx` now support real Supabase Auth sessions with a "silent migration on next login" strategy (no forced reset) — see `Authentication.md` §1. Two things remain open: (1) migration only completes for accounts that actually log in again — there's no sweep for dormant accounts, and (2) even after an account migrates, its old plaintext password **stays in `businesses.password`/`staff.password`** — nothing removes it, since the legacy column is still read as the fallback check for not-yet-migrated accounts. A full close-out needs a way to tell "fully migrated" apart from "not yet," and a plan to null out plaintext passwords once safe to do so | **L → S remaining** (see above) | **Severe → High**, pending full rollout | `Authentication.md` §1 |
| C3 | CareFind `api/admin-auth.js` — full authentication bypass (unsigned token); note `AdminPanel.jsx` does run a client-side guard on mount, but it only checks that the same forgeable token is present, never verifies it server-side, so it doesn't reduce this item's severity. **Status: not yet fixed** — this specific item (the token itself being unsigned/forgeable) is Phase 1 work (real Supabase Auth for admin accounts); see C9 for a related, more severe item that *has* been fixed in code | **S** | **Severe** | `Authentication.md` §2 |
| C4 | `api/admin-setup.js` — skeleton-key endpoint, hardcoded fallback, returns plaintext password; confirmed reachable in production via `vercel.json`'s default `api/*.js` routing, so this is a live exposure, not a theoretical one | **XS** (rotate/remove) | **Severe** | `Authentication.md` §3 |
| C5 | POS never persists stock decrements — `updateProduct()` is never called on checkout | **S** | **Severe** | `knowledge/modules/point-of-sale.md` |
| C6 | Hospital pipeline dead-ends for Lab/Imaging-only visits — patients never discharged | **M** | **High** | `knowledge/modules/laboratory.md`, `imaging.md` |
| C7 | `Locations.jsx` calls `setAuth`, which `AuthContext` does not expose — branch-switching likely crashes. **Fixed**: `setAuth` added to the context's provider value in `App.jsx`; `Locations.jsx`'s existing `switchToLocation()` needed no changes, since its spread-and-preserve logic (`{ ...auth, brand: loc }`) was already correct — it just had nothing to call | **XS** | **High** | `Component-Catalog.md` §3 |
| C8 | `consultations` table name collision between CareHub (clinical) and CareFind (paid booking) — now that both products are confirmed to share one physical Postgres project/schema (identical URL and anon key found in both codebases), "two separate tables that happen to share a name" is no longer a plausible resolution; treat as very likely a genuine single-table collision pending final live-schema confirmation | **XS to verify, XL if confirmed** | **Severe** | `Database.md`, `Shared-Services.md` |
| C9 | Discovered during C3 remediation: `AdminLogin.jsx` and `AdminPanel.jsx` (`createStaff`/`createTeam`) queried `admin_users`/`admin_teams` **directly from the browser via the public anon key**, bypassing `api/admin-auth.js` entirely (confirmed zero references to it anywhere in `src/`) — meaning the `admin_users` table, including `password_hash`, had to be readable/writable by anon with no RLS for the app to function at all. More severe than C3 alone, since it doesn't require forging a token — just querying the table directly. **Status: code fixed** — both files now call `api/admin-auth.js` exclusively (extended with `list_teams`/`create_team` actions); **RLS not yet applied** — the table-level hole remains open until `ALTER TABLE admin_users/admin_teams ENABLE ROW LEVEL SECURITY` is run against the live project (see `Security-Risks.md` "What to do first" #5) | **Done (code) / XS remaining (SQL, manual)** | **Severe until RLS is applied** | `Security-Risks.md` Finding #2 |

| C10 | ~~Discovered while fixing H11, corrects C1's "Status" note above: `apps/carehub/src/lib/supabase.js`'s `sbFetch()` — the function underlying essentially every CareHub data read/write — sent a hardcoded anon key as its `Authorization` header on every request, always, regardless of login state, never consulting `lib/authClient.js`'s real Supabase Auth session.~~ **Fixed**: `sbFetch()` and the three storage-upload functions (`uploadMessageFile`/`uploadOrderFile`/`uploadActivityVoice` — also had this bug independently, each hardcoding the anon key inline; consolidated into one shared `sbUpload()` helper in the process, removing a triplication) now call a shared `authToken()` that reads `authClient.auth.getSession()` and forwards the real `access_token` when one exists, falling back to the anon key otherwise — the exact fallback behavior every call already had, so pre-login flows (login itself, `Register.jsx`'s duplicate-email check) are unaffected by construction, no per-call-site audit needed. Verified with a clean `vite build`. **One live-verification item this fix cannot self-check, flagged in `REMEDIATION-STATUS.md`**: this switches logged-in users' requests from Postgres role `anon` to `authenticated`. RLS isn't enabled yet, so today access is gated purely by role-level grants — if `authenticated` doesn't have the same grants as `anon` on these 40 tables (never directly inspected against the live project), logged-in users could see failures immediately on deploy, independent of RLS. Needs a quick grants check or a post-deploy smoke test before/after shipping | **Done (code) — S, far less than the original L–XL estimate once the actual code was read: all ~90 functions funnel through one shared function, so no per-call-site work was needed** | **Resolved in code, pending the grants verification above** | `REMEDIATION-STATUS.md` |
| C11 | Discovered during the architecture-conformance discovery pass (not a security engagement finding): CareFind's `GiftPanel.jsx:74-119` (gifting) and `Wallet.jsx:33-68` (Paystack top-up return handler) both do non-atomic, client-side wallet crediting — read balance, compute new balance in the browser, then two separate writes, no DB transaction/RPC. `Wallet.jsx`'s path duplicates what `paystack-webhook.js` already does server-side with signature verification and DB-level idempotency, guarded only by a client-side query-param check instead — two independent paths can credit the same top-up. Contrast: `subscriptions.js:49` already does the equivalent operation correctly, atomically, via `supabase.rpc('pay_creator_subscription', ...)` — the codebase knows the right pattern, it just wasn't applied to gifting or wallet top-ups | **M** (needs an atomic RPC for both paths, mirroring `pay_creator_subscription`) | **Severe — real money, two racing/duplicable write paths** | Architecture-conformance report, 2026-07-17 |
| C12 | Mirror image of C5, found the same pass: CareHub's `Purchases.jsx` records `quantity` on the purchase row but never calls `updateProduct`/`addStockBatch` on receipt — inventory replenishment via Purchases doesn't flow anywhere. Combined with C5 (POS never decrements stock either), `products.stock`/`stock_batches` are not kept correct by either side of the inventory lifecycle today | **S** | **Severe** | Architecture-conformance report, 2026-07-17 |

C1's effort is listed as XL because it is not independently fixable — it requires C2 and C3 (real, server-verified sessions) to exist first before RLS keyed to `auth.uid()` is possible. **C10 is now fixed** — `auth.uid()` can reach Postgres for logged-in users again, pending the grants check noted there.

**Worth noting separately, since it's easy to lose in the "hardcoded credentials" framing above:** `SUPABASE_SERVICE_ROLE_KEY` — the credential that actually bypasses RLS and matters most for security — is handled correctly everywhere it appears, always read server-side via `process.env.*` inside Vercel functions, never hardcoded or shipped to a client bundle. The hardcoded credential referenced throughout this report is the **anon key**, which is designed to be public in Supabase's model; its repeated hardcoding across 5+ files is a maintainability issue (key rotation requires touching every copy), not a leak — the real severity driver is C1 (no RLS), not the key's visibility.

---

## High

| # | Item | Effort | Risk |
|---|---|---|---|
| H1 | ~~Three hospital pages (Doctor/Lab/Imaging) each hardcode Supabase credentials and re-implement a private data layer instead of using `lib/supabase.js`~~ — **Fixed**: all 10 functions (2 of which were triplicated identically across all three files: `getPatientMessages`/`addPatientMessage`) moved into `lib/supabase.js`; the 3 pages now import from there like every other page. Verified via repo-wide grep that no page-level file references `SB_URL`/`SB_KEY`/a local `sbFetch` anymore | **M** | ~~High~~ Resolved |
| H2 | `readAuth()` duplicated identically across 5 files, bypassing `useAuth()` | **XS** | **Moderate** |
| H3 | ~~No route-level access control — ~25 CareHub routes and all 29 CareFind routes reachable by URL regardless of role/business type~~ — **Both halves fixed.** CareHub: `BusinessDashboard.jsx`'s 26 nested routes now individually check `lib/permissions.js`'s role/business-type matrix (reusing `getNavItems()`, not a reimplementation) before rendering, redirecting to `dashboard` otherwise. CareFind: new `RequireAuth.jsx` wraps the 16 of 27 routes that need a logged-in consumer session (`Dashboard`, `Profile`, `Wallet`, `SavedPosts`, etc.), redirecting to `/login`; the other 11 are genuinely public (search, business/drug/news pages, viewing a live session or playlist) and left unguarded on purpose, not by omission. **Found in the process, not just hardened**: `PlaylistCreate.jsx` and `ProfessionalMonetization.jsx` (`/earn`) had *no* internal check at all and used `user.id` directly — an unauthenticated visitor submitting either form would have crashed the page. The route guard fixes that, it isn't just defense-in-depth like it is for the other 14 routes. `/admin-panel` intentionally excluded — it runs on a separate `admin_token` mechanism, not the consumer `user` session `RequireAuth` checks. | **L** | **Resolved** (both products) |
| H4 | `paystack-webhook.js` sits outside `api/`, likely unreachable under Vercel's routing convention — confirmed via `vercel.json`, which has no `functions` entry for it and only the default SPA catch-all rewrite, so a request to it almost certainly returns `index.html` rather than executing | **S to fix** | **High** |
| H5 | `admin-auth.js` and `admin-setup.js` use incompatible password-hashing schemes | **S** | **High** |
| H6 | ~~No schema, migration, or ERD exists for either product despite sharing one database~~ — **CareHub documented**: `architecture/Schema-Reference-CareHub.md` now exists, table-by-table, reconstructed from `lib/supabase.js` and cross-referenced against `knowledge/modules/*.md` where full form-level detail lives. Explicitly scoped to CareHub only — CareFind's ~40 tables remain undocumented at this level of detail, and no column *types*/constraints are knowable without live database access regardless | **M** to document (done for CareHub) / **XL** for real migrations (not started — still no actual migration files) | CareHub: **Resolved** (documentation). CareFind: **High** (unchanged) |
| H7 | CareHub's enterprise vertical (6 files) never uses the shared `Modal`, running a parallel bottom-sheet dialog system | **M** | **Moderate** |
| H8 | Doctor's Disposition selector (Admit/Refer/Emergency Transfer) has no effect on `patients.status` | **S** | **High** |
| H10 | `AdminPanel.jsx`'s `loadAll()` destructures a 12-item `Promise.all` by name, but positions 8–12 of the array don't correspond to their variable names' apparent intent (e.g. `withdrawRes` is actually bound to the `admin_users` query result, not `withdrawal_requests`; `bizRes` is actually bound to `consultations`, not `businesses`). Discovered incidentally while fixing C3 below — not caused by that fix, and deliberately left unchanged (array positions were preserved exactly) to keep that fix scoped to auth only. Practical effect: the Withdrawals, Businesses, and Task Submissions admin tabs, and the "new consultation booking" notification, are very likely silently showing the wrong data or empty results | **S to fix** (remap 5 destructured names to their correct positions and re-verify each tab), **but needs a human to confirm intended behavior per tab first** | **Moderate — silent data-display bug in an internal admin tool, not a security or data-integrity issue since nothing is written incorrectly** |
| H9 | ~~CareFind's `products` marketplace columns have no confirmed write path in CareHub~~ — **Resolved, not fixed**: grepped all of `apps/carehub/src` for `image_url`/`sale_type`/`price_unit`/`min_purchase`/`seller_location` — zero matches anywhere, confirming (not just "not found in the one file previously checked") that CareHub has no write path to these columns at all. This is a finding, not a code change — the gap itself is still open, a product/design decision (build the write path, or accept the marketplace fields are decorative for CareHub-originated products) | **M** to actually build the write path (unchanged, not attempted) | **Moderate** |
| H11 | ~~Discovered while designing `apps/carehub/sql/phase2_rls_pilot.sql`'s `staff_claims`/`business_claims` policies: CareFind's `AdminPanel.jsx` approves/rejects claims — including writing `businesses.visible_on_carefind` directly — using the plain anon key, no Supabase Auth session at all.~~ **Fixed**: `approveClaim()`/`rejectClaim()` in `AdminPanel.jsx` now call new `approve_claim`/`reject_claim` actions on `api/admin-auth.js` (mirrors the C9 fix pattern exactly — service-role client, `verifyToken()` gate, no role restriction beyond "valid admin session," matching the UI's existing lack of per-role tab gating). Scope correction from the original finding: `AdminPanel.jsx` only ever touched `business_claims`/`businesses`, never `staff_claims` — that table's approval path lives entirely in CareHub's `Staff.jsx`/`approveStaffClaim()`/`rejectStaffClaim()`, a different codebase and a different problem (see **C10**, discovered while verifying this fix) | **Done** | **Resolved for `business_claims`/`businesses`. staff_claims's equivalent gap is now tracked as C10 — it's more severe than this item was, not a leftover of it** |

---

## Medium

| # | Item | Effort | Risk |
|---|---|---|---|
| M1 | No pagination on ~17 of 20 CareHub list queries; CareFind search/admin capped at one page | **M** | **Moderate, growing** |
| M2 | 19 independent `useToast`/`Toast` instances, no shared provider | **S** | **Low–Moderate** |
| M3 | `TopBar` duplicated 17× inline; 6 enterprise routes render with no `TopBar` | **S** | **Low** |
| M4 | `Modal`'s footer border is `borderBottom` instead of `borderTop` | **XS** | **Low, high-visibility** |
| M5 | `Register.jsx`'s "Years in Business"/"Staff Count" fields captured but never submitted | **XS** | **Low** |
| M6 | Expenses' monthly budget is `localStorage`-only despite UI claiming it's shared across staff | **M** | **Moderate** |
| M7 | Doctor.jsx maintains two disconnected "lab tests ordered" representations | **M** | **Moderate** |
| M8 | Doctor's 10-item lab quick-add list has drifted from Lab's 18-item catalogue | **S** | **Moderate** |
| M9 | Debt reconciliation logic duplicated independently in `POS.jsx` and `Purchases.jsx` | **S** | **Moderate** |
| M10 | CareFind's `lib/reviewAI.js` Anthropic call is missing required auth headers | **XS to verify, S to fix** | **Moderate (unverified)** |
| M11 | CareHub's `lib/reviewAI.js` is a 0-byte stub for a feature CareFind fully built | **M** if pursued | **Low** |
| M12 | Four CareFind media components independently reimplement the same upload/error plumbing | **M** | **Moderate** |
| M13 | "Billing"/"Subscription Management" documented as a CareHub responsibility with zero implementation | **XL** if real gap / **XS** if docs-only fix | **Moderate — needs a product decision first** |

---

## Low

| # | Item | Effort | Risk |
|---|---|---|---|
| L1 | Stale `skincarepro.vercel.app` branding in staff welcome emails | **XS** | **Low, visible to every new hire** |
| L2 | Stray accidentally-created directory in `apps/carefind/carefind-main/src/lib/` | **XS** | **Low** |
| L3 | Dead code: CareFind `App.jsx`, `searchClients`, `getLabResults`, `OfflineBanner` (would crash if wired in), and — newly confirmed via import grep — `AdminStaff.jsx`/`AdminTeams.jsx` (never imported by any route or component; not part of the shipped bundle) | **XS each** | **Low, except OfflineBanner is a landmine** |
| L4 | `VisualCard.jsx` reinvents `Logo.jsx`'s mark instead of importing it | **XS** | **Low** |
| L5 | No test suite in either product | **XL** for meaningful coverage | **Moderate, compounding** |
| L6 | No `.env.example` / documented environment variables | **S** | **Low** |
| L7 | `planning/CODE_AUDIT.md`, `architecture/decisions/` were empty | Addressed by this document set | — |

---

## Suggested Order of Execution

Sequenced by dependency and leverage, not strictly by tier.

**Phase 0 — Verify (days):** C8 (schema check), H4 (webhook reachability), C7 (crash repro), M10 (Anthropic call). Pure verification; each result changes how urgently its paired fix matters.

**Phase 1 — Stop the bleeding (cheap, no architecture change):** C4 (rotate key), C7, C5, C6+H8 (patient pipeline), H2 (readAuth consolidation), plus the near-zero-effort batch (M4, M5, L1–L4) opportunistically.

**Phase 2 — Real authentication (highest-leverage single investment):** C2 (CareHub → Supabase Auth), C3+H5 (CareFind admin auth rebuilt on the same real mechanism), then C1 (RLS, clinical tables first). Deliberately before Phase 3 — a route guard or consolidated service is only as strong as the auth underneath it.

**Phase 3 — Structural consolidation (now safe to build on real auth):** H3 (route guards), H1 (shadow-service consolidation), H6 (schema documentation/migrations), H9 (resolve alongside H6).

**Phase 4 — Everything else:** Remaining Medium items in listed order; Low-tier hygiene opportunistically; pull L5 (test suite) earlier than "last" if capacity allows — starting it alongside Phase 1–2 changes de-risks every phase after it.
