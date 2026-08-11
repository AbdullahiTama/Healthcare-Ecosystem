# Complete Service Catalogue — Care Ecosystem

Every service in `apps/carehub` and `apps/carefind/carefind-main` — every module whose job is to talk to Supabase (REST or `supabase-js`), Storage, email, or a third-party API. This supersedes the prior version of this document; all prior analysis is preserved and reorganized under the newly-requested fields (Purpose / Responsibilities / Consumers / Database Access / Authentication / Business Logic / Weaknesses).

**Systemic note, stated once:** every service in this document — across both products, with the sole exception of CareFind's `lib/AuthContext.jsx` and the three Vercel serverless functions — authenticates to its backend using a single hardcoded, publicly-embedded Supabase key. None attach a per-request, per-user session token. Where "Authentication" below says "anon key only," this is what it means, and no service is exempted from this note unless stated otherwise.

---

## Part 1 — CareHub: `lib/supabase.js` (Primary Data Service)

One 682-line file, one internal `sbFetch()` transport (raw `fetch()` against Supabase's PostgREST endpoint), ~90 exported functions across 21 logical sub-services. Documented individually below because their consumers, tables, and risk profiles genuinely differ, even though they physically share one file and one transport.

### 1.1 Business / Auth Service
- **Purpose:** Business lookup, registration, and the app's entire login mechanism.
- **Responsibilities:** `loginBusiness`, `loginStaff`, `getBusinessById`, `getBusinesses`, `registerBusiness`, `updateBusiness`, `getBranches`, `addBranch`, `getAllLocations`.
- **Consumers:** `Login.jsx`, `Register.jsx`, `AdminDashboard.jsx`, `Locations.jsx`.
- **Database Access:** `businesses` table only.
- **Authentication:** This service *is* the authentication mechanism, and it has none of its own — login is `businesses?email=eq.X&password=eq.Y`, a plaintext-equality PostgREST filter, not a credential-verification call. Full detail in `architecture/Authentication.md`.
- **Business Logic:** Minimal in the service itself — `getAllLocations()` contains the one piece of real logic in this group (resolve parent business → fetch branches, a 3-step sequential chain). Password handling, session issuance, and role derivation all happen in the calling component (`Login.jsx`), not here.
- **Weaknesses:** No hashing, no session token, plaintext credentials as URL query params (logged in transit); `getAllLocations()`'s sequential chain is a minor N+1-adjacent inefficiency.

### 1.2 Staff Service
- **Purpose:** CRUD for a business's employee roster.
- **Responsibilities:** `getStaff`, `addStaff`, `updateStaff`, `deleteStaff`.
- **Consumers:** `Staff.jsx` (full CRUD); read-only `getStaff` calls from `Warehouses.jsx`, `Orders.jsx`, `Territories.jsx`, `Messages.jsx`, `LiveActivity.jsx` — five independent read-only consumers now confirmed (up from four in the prior pass), each building its own local staff-picker UI rather than sharing one.
- **Database Access:** `staff` table.
- **Authentication:** Anon key only.
- **Business Logic:** None in the service — `addStaff` is a pure insert. All role-assignment logic (which roles are offered, whether they make sense for the business type) lives in `Staff.jsx` and, separately and inconsistently, in `lib/permissions.js`.
- **Weaknesses:** Plaintext `password` field written directly; five separate components independently query and render "pick a staff member" UI with no shared hook.

### 1.3 Products (Inventory) Service
- **Purpose:** Product catalog CRUD — backs the Inventory domain.
- **Responsibilities:** `getProducts`, `addProduct`, `updateProduct`, `deleteProduct`, `deleteProductsBulk`.
- **Consumers:** `Inventory.jsx` (full CRUD), `BusinessDashboard.jsx` (owns the shared `products` state via `getProducts`), `Locations.jsx`/`Orders.jsx`/`Stock.jsx` (read-only), `CareFind.jsx` (`updateProduct` only, the duplicated visibility toggle).
- **Database Access:** `products` table, unpaginated.
- **Authentication:** Anon key only.
- **Business Logic:** None in the service itself — duplicate detection, category defaulting (`Services` category forces `stock: 999`), and price/stock coercion all live inline in `Inventory.jsx`'s component body, duplicated a second time inside `ProductModal`'s own `save()`. This is the clearest example in CareHub of business logic that should live in a service having leaked entirely into presentation code.
- **Weaknesses:** No pagination; `POS.jsx` never calls `updateProduct` to persist a sale's stock effect (the Inventory module's central defect); CareFind's marketplace-specific product columns have no write path through this service at all.

### 1.4 Sales (POS) Service
- **Purpose:** Record and retrieve point-of-sale transactions.
- **Responsibilities:** `getSales`, `addSale`, `updateSale`, `getTodaySales`.
- **Consumers:** `POS.jsx` (full flow), `DashboardHome.jsx`/`Locations.jsx` (stat tiles), `Reports.jsx` (aggregation).
- **Database Access:** `sales` table; `items` stored as a JSON-stringified blob, not normalized.
- **Authentication:** Anon key only.
- **Business Logic:** None — cart math, discount application, split-payment validation, and credit/debt triggering are all computed in `POS.jsx`, not here. The service is a pure persistence layer for whatever the component already decided.
- **Weaknesses:** No server-side total validation (a client could POST any `total`); line-item-level reporting is impossible without parsing every row's JSON blob client-side.

### 1.5 Clients Service
- **Purpose:** Generic CRM record CRUD.
- **Responsibilities:** `getClients`, `addClient`, `updateClient`, `searchClients` (dead — zero call sites).
- **Consumers:** `Clients.jsx` only.
- **Database Access:** `clients` table.
- **Authentication:** Anon key only.
- **Business Logic:** None.
- **Weaknesses:** `searchClients` was built and never wired in; `Clients.jsx` re-implements the same search client-side over an unpaginated fetch instead.

### 1.6 Expenses Service
- **Purpose:** Business expense tracking.
- **Responsibilities:** `getExpenses`, `addExpense`, `deleteExpense` — no update.
- **Consumers:** `Expenses.jsx` (full CRUD), `Reports.jsx` (read-only).
- **Database Access:** `expenses` table.
- **Authentication:** Anon key only.
- **Business Logic:** None in the service — the entire monthly-budget feature (`getBudgets`/`saveBudget`/`getBudget` in `Expenses.jsx` itself) is **not part of this service at all**; it's a parallel `localStorage`-only mechanism with no database table, confirmed during the component-catalogue pass. This service has no awareness that a budget concept exists.
- **Weaknesses:** No `updateExpense`, forcing delete-and-recreate for corrections; the budget feature's complete independence from this service means "expenses" and "expense budget" are two unconnected systems despite appearing as one feature to the user.

### 1.7 Appointments Service
- **Purpose:** Scheduling CRUD.
- **Responsibilities:** `getAppointments`, `addAppointment`, `updateAppointment`, `deleteAppointment` — full CRUD, the only generic-domain service with complete CRUD symmetry.
- **Consumers:** `Appointments.jsx` only.
- **Database Access:** `appointments` table.
- **Authentication:** Anon key only.
- **Business Logic:** None — status transitions (`pending→confirmed→completed/cancelled`) are plain string writes with no validation of legal transitions, decided entirely by which button the UI shows.
- **Weaknesses:** No link to the Reception/Patients pipeline — an appointment cannot become a registered patient without manual re-entry.

### 1.8 Debts Service
- **Purpose:** Bidirectional debt ledger.
- **Responsibilities:** `getDebts`, `addDebt`, `updateDebt`.
- **Consumers:** `Debts.jsx` (full CRUD); **also called directly by `POS.jsx` and `Purchases.jsx`**, each independently implementing its own "does a matching debt already exist" reconciliation logic before calling this service.
- **Database Access:** `debts` table.
- **Authentication:** Anon key only.
- **Business Logic:** None in the service — reconciliation logic (matching a debt to its originating sale/purchase via `source`/`source_ref`) is written twice, independently, in the two calling components rather than owned once here.
- **Weaknesses:** The duplicated reconciliation logic is the clearest case in CareHub of two callers needing to agree on business rules that only one shared service function should own.

### 1.9 Purchases Service
- **Purpose:** Supplier purchase records.
- **Responsibilities:** `getPurchases`, `addPurchase`, `updatePurchase`.
- **Consumers:** `Purchases.jsx` (full CRUD), `Reports.jsx` (read-only).
- **Database Access:** `purchases` table.
- **Authentication:** Anon key only.
- **Business Logic:** The "mark paid + reconcile matching debt" logic lives in `Purchases.jsx`'s `markPaid()`, calling both this service and the Debts service — not centralized here.
- **Weaknesses:** `product_name` is free text with no `product_id` FK — this service has no way to affect Inventory even if a caller wanted it to.

### 1.10 Patients / Hospital Pipeline Service
- **Purpose:** The clinical patient record and its state-machine transitions.
- **Responsibilities:** `getPatients`, `addPatient`, `updatePatient`, `getTriage`, `addTriage`, `addConsultation`, `getPrescriptions`, `addPrescription`, `updatePrescription`.
- **Consumers:** `Reception.jsx`, `Triage.jsx`, `Doctor.jsx`, `RxInbox.jsx`; imported but unused by `Lab.jsx` (dead import, confirmed in the Laboratory-module review).
- **Database Access:** `patients`, `triage`, `consultations` (write-only, never read back), `prescriptions`.
- **Authentication:** Anon key only — the most sensitive data category either product touches, protected identically to product prices.
- **Business Logic:** None in the service — the entire `patients.status` state machine (which status follows which action) is computed independently in each of the four consumer components, with no shared transition function or enumerated status list anywhere in this service.
- **Weaknesses:** Dead status values (`at_reception`, `admitted`) never written by anything; no method exists to read back `consultations`; no transaction wraps Doctor's multi-table submission.

### 1.11 Settings Service
- **Purpose:** Per-business configuration.
- **Responsibilities:** `getSettings`, `saveSettings` (manual check-then-write "upsert").
- **Consumers:** `Settings.jsx` (both), `POS.jsx` (read-only).
- **Database Access:** `business_settings` table, `businesses` (via a separate `updateBusiness` call also used by this page).
- **Authentication:** Anon key only.
- **Business Logic:** None.
- **Weaknesses:** `saveSettings`'s existence-check-then-branch is a read-then-write race under concurrent saves.

### 1.12 Admin Team Service
- **Purpose:** CareHub's own internal super-admin staff management.
- **Responsibilities:** `getAdminTeam`, `addAdminTeam`, `removeAdminTeam`.
- **Consumers:** `AdminDashboard.jsx` only.
- **Database Access:** `admin_team` table.
- **Authentication:** Anon key only — the platform's own back-office roster has no stronger protection than any tenant's product catalog.
- **Business Logic:** None.
- **Weaknesses:** See Authentication — this is arguably the single table in the whole ecosystem where anon-key-only access is least acceptable, since it gates who can approve every other business on the platform.

### 1.13 Notifications Service
- **Purpose:** In-app alert delivery.
- **Responsibilities:** `getMyNotifications`, `notify` (fan-out writer), `markNotificationRead`, `markAllNotificationsRead`.
- **Consumers:** `NotificationBell.jsx` (read/mark); `notify()` itself is called internally by `sendMessage`, `createOrder`, `advanceOrder`, `logActivity`, `commentOnActivity` — the one sub-service other sub-services in this file depend on.
- **Database Access:** `staff_notifications` table.
- **Authentication:** Anon key only.
- **Business Logic:** `notify()` deliberately swallows its own errors (documented in an inline comment as intentional, so a failed notification never blocks the action that triggered it) — this is a genuine, deliberate business rule, not an oversight.
- **Weaknesses:** The swallowed errors are entirely unmonitored — there is no way to know in production how often notifications silently fail.

### 1.14–1.20 Enterprise Vertical Services (Locations, Staff Claims, Territories, Messages, Stock, Orders, Field Activity)

Grouped for brevity; each now confirmed at the component level during the full component read-through, not just the service-signature level.

| Service | Responsibilities | Consumer | Database | Business Logic | Weaknesses |
|---|---|---|---|---|---|
| **Enterprise Locations** | `getEnterpriseLocations` CRUD | `Warehouses.jsx`; read-only from `Stock.jsx`/`Orders.jsx` | `enterprise_locations` | None in service — the "can't delete a location with children" guard is implemented in `Warehouses.jsx`'s `remove()`, not here | No shared location-picker despite 3 consumers |
| **Staff Claims** | `getStaffClaims` (uses one of only two embedded-join queries in CareHub), `approveStaffClaim`, `rejectStaffClaim` | `Staff.jsx` | `staff_claims` (also written from CareFind — see `architecture/Shared-Services.md`) | None in service | Cross-product contract not documented anywhere formally |
| **Territories** | `getTerritories` CRUD, `getRepAssignments`, `assignRepToTerritory`, `removeRepFromTerritory` | `Territories.jsx`; read-only from `Orders.jsx`/`LiveActivity.jsx` | `territories`, `rep_territories` | None — overlap-prevention logic (or lack thereof) lives in `Territories.jsx`'s `toggleRep()` | No conflict check on overlapping rep assignments |
| **Internal Messages** | 7 functions incl. `uploadMessageFile` | `Messages.jsx` only | `internal_messages` + 2 child tables + Storage | Thread/recipient/attachment fan-out logic lives in `Messages.jsx`, not the service | File uploads unvalidated by type; public Storage bucket |
| **Stock Batches** | `getStockBatches` CRUD, `getStockMovements`, `addStockMovement`, `transferStock`, `adjustStock` | `Stock.jsx` only | `stock_batches`, `stock_movements` | **The one enterprise service with real business logic inside it**: `transferStock`/`adjustStock` compute quantity diffs and write the audit-trail movement row as part of the same call — genuinely centralized, unlike every sibling service in this group | Entirely disconnected from the Products service's `products.stock` |
| **Orders** | 10 functions incl. `createOrder`, `advanceOrder` | `Orders.jsx` only | `orders` + 4 child tables + Storage | `advanceOrder`'s notification fan-out (who gets told what at each pipeline stage) is centralized in the service; but `canApprove()` (who is *allowed* to approve) is computed in `Orders.jsx`, not enforced here | No transaction across `createOrder`'s up-to-4-table write sequence |
| **Field Activity** | 15 functions incl. `reverseGeocode`, `uploadActivityVoice` | `LiveActivity.jsx` only | 6 tables + Storage | None in service — the entire dynamic custom-field system, date-range filtering, and CSV export are all in `LiveActivity.jsx` | `reverseGeocode` calls a third-party API (Nominatim) with no caching/rate-limiting |

### 1.21 Offline Cache Service
- **Purpose:** Local-first resilience for POS sales made without connectivity.
- **Responsibilities:** `cacheData`, `getCached`, `queueOfflineSale`, `getOfflineQueue`, `clearOfflineQueue`, `syncOfflineSales`.
- **Consumers:** `BusinessDashboard.jsx`, `POS.jsx`.
- **Database Access:** None directly — a `localStorage` wrapper; `syncOfflineSales` calls the Sales service's `addSale` once online.
- **Authentication:** N/A locally; anon key for the eventual sync call.
- **Business Logic:** Genuine and well-designed — this is the one service in CareHub whose business logic (queue, retry-on-reconnect, silent-fail-and-retry-later) is both real and correctly placed in a service rather than leaked into a component.
- **Weaknesses:** `syncOfflineSales` retries silently per item with no visibility into which specific sale failed — the one design flaw in an otherwise well-built service.

---

## Part 2 — CareHub: Hospital Station Shadow Services (fixed — kept for the business-logic history)

~~Three physically separate services, each embedded inside a page component rather than living in `lib/supabase.js`.~~ **Fixed**: all ten functions across Doctor.jsx/Lab.jsx/Imaging.jsx — `addLabRequest`, `addImagingRequest`, `getLabRequests`, `getLabResults`, `addLabResult`, `updateLabRequest`, `getImagingRequests`, `updateImagingRequest`, and the two functions all three files had triplicated identically (`getPatientMessages`, `addPatientMessage`) — now live in `lib/supabase.js`, imported normally by all three pages. No page-level file hardcodes `SB_URL`/`SB_KEY`/a local `sbFetch` anymore (verified by repo-wide grep). The domain-logic and functional findings below are untouched by this fix and remain accurate.

### 2.1 Doctor.jsx
- **Business Logic:** The doctor's "send to Pharmacy/Lab/Imaging" destination routing lives in `Doctor.jsx` itself, calling the now-shared Lab/Imaging/Messages functions plus the Patients service in the same submission.

### 2.2 Lab.jsx
- **Business Logic:** The `COMMON_TESTS` catalogue (18 tests, each with a declared input type) and the result-widget-selection logic live here — genuine domain logic, but trapped in a component file rather than a service, and independently drifted from Doctor's own 10-item quick-add list (see `knowledge/modules/laboratory.md`). `getLabResults` remains dead code — never called by anything, including this file (see `Technical-Debt.md` L3).
- **Weaknesses:** `submitResults()` never calls the Patients service's `updatePatient` — this service considers its job done at `lab_requests.status = 'completed'` regardless of what the patient's overall status should become.

### 2.3 Imaging.jsx
- **Business Logic:** None beyond report storage — no priority field exists at all here, unlike Lab's `routine`/`urgent`/`stat`.
- **Weaknesses:** Same discharge-pipeline dead-end as §2.2.

---

## Part 3 — CareHub: Cross-Cutting Services

### 3.1 `lib/realtime.js` (Realtime Subscription Service)
- **Purpose:** Live-update primitive over Supabase's websocket channel API.
- **Responsibilities:** `watchTable(tableName, businessId, onInsert)` → unsubscribe function.
- **Consumers:** `NotificationBell.jsx` (`staff_notifications`), `LiveActivity.jsx` (`field_activities`) — the only two of dozens of possible consumers that use it.
- **Database Access:** Generic/parameterized — any table.
- **Authentication:** A separate `supabase-js` client instance, `persistSession: false`, anon key — a third distinct Supabase client configuration in the codebase alongside `lib/supabase.js`'s raw-fetch approach.
- **Business Logic:** None — a thin, correctly-scoped wrapper.
- **Weaknesses:** Severely underused given how many polling/manual-refresh screens (all six hospital stations, Orders' approval queue) would benefit from exactly this pattern.

### 3.2 `lib/email.js` (Email Service)
- **Purpose:** HTML email templating and sending.
- **Responsibilities:** `emailStaffWelcome`, `emailBusinessApproved`, `emailBusinessRejected`, `emailAdminNewRegistration`.
- **Consumers:** `Staff.jsx`, `AdminDashboard.jsx`, `Register.jsx`.
- **Database Access:** None — takes plain JS objects, presumably relays through a third-party email API/SMTP not visible in the reviewed portion.
- **Authentication:** Not applicable in the Supabase sense; whatever email-provider credential this needs wasn't visible in the reviewed code.
- **Business Logic:** Template composition only.
- **Weaknesses:** `emailStaffWelcome` embeds the new hire's plaintext password directly in the email body; hardcoded `skincarepro.vercel.app` branding/links throughout, a leftover from the product's prior identity.

### 3.3 `lib/permissions.js` (Authorization / Navigation Logic Service)
- **Purpose:** Role → capability matrix and nav-item filtering by role and business type.
- **Responsibilities:** `getPerms(role)`, `can(role, action)`, `getNavItems(role, businessType)`; exports `ROLES`, `DEFAULT_STAFF_PERMS`, `ALL_NAV_DEFAULT`, `ALL_NAV_HOSPITAL`, `ALL_NAV_ENTERPRISE`, `ROLE_LIST`.
- **Consumers:** Only three files import it directly (`Sidebar.jsx`, `BusinessDashboard.jsx`, `Staff.jsx`) — every other page receives already-resolved `perms`/`role` as props, a genuinely good centralization pattern.
- **Database Access:** None — pure in-memory logic over hardcoded objects.
- **Authentication:** N/A (no I/O), but this service's output is what every other service and component *trusts* as the authorization boundary — and that boundary is UI-only; nothing in Part 1's services re-checks a `perms` value before executing a write.
- **Business Logic:** The entire role/business-type authorization model lives here — the most business-logic-dense "service" in CareHub, and also the most consequential, since its output is treated as authoritative everywhere despite enforcing nothing at the data layer.
- **Weaknesses:** `ROLES.Pharmacist.nav`/`Doctor.nav`/`Nurse.nav`/etc. grant nav ids that only exist in `ALL_NAV_HOSPITAL` — silently inert for every other business type, with no validation anywhere catching the mismatch (full detail in `knowledge/modules/pharmacy.md`).

### 3.4 The `readAuth()` Shadow Service (informal, cross-file)
- **Purpose:** Not a designed service, but a pattern consistent enough to document as one: reading the cached auth object directly from `localStorage['carehub_auth']`, bypassing `useAuth()`.
- **Responsibilities:** Parse and return `{ staffId, staffName, staffTitle, ... }` derived from the cached auth blob.
- **Consumers:** Confirmed, via the full component read-through, in **five** separate files: `NotificationBell.jsx`, `Messages.jsx`, `Stock.jsx`, `Orders.jsx`, `LiveActivity.jsx` — each with its own byte-identical copy of the function.
- **Database Access:** None — `localStorage` only.
- **Authentication:** This *is* an authentication-adjacent read, duplicated outside the one real `AuthContext`.
- **Business Logic:** None — a pure accessor, but its existence in five places is itself a business-logic risk: any future change to the shape of the cached auth object (e.g., adding real session tokens per `architecture/Authentication.md`'s recommendations) would need to be replicated in five places by hand, or four of them silently break.
- **Weaknesses:** The clearest, most mechanical duplication finding in this entire catalogue — a one-line fix (import from one shared location, or use `useAuth()` directly) resolves it everywhere at once.

---

## Part 4 — CareFind Services

### 4.1 `lib/supabaseClient.js`
- **Purpose:** The shared `supabase-js` client instance.
- **Responsibilities:** Client construction only.
- **Consumers:** Nearly every CareFind file.
- **Database Access:** None itself — the transport every other CareFind service/page uses.
- **Authentication:** Anon key, hardcoded in source — same posture as CareHub, but via the correct `supabase-js` construction pattern rather than raw `fetch()`.
- **Business Logic:** None.
- **Weaknesses:** None in the client construction itself — this is the one piece of shared infrastructure in either product built exactly the way it should be.

### 4.2 `lib/AuthContext.jsx`
- **Purpose:** Real Supabase Auth session provider for CareFind's consumer-facing accounts.
- **Responsibilities:** `signUp`, `signInWithPassword`, `signOut`, live session listener (`onAuthStateChange`).
- **Consumers:** Every page needing `user` — confirmed in `Search.jsx`, `BusinessProfile.jsx`, `BottomNav.jsx`, `ClaimBusiness.jsx`, `ClaimStaffPosition.jsx`, and by strong inference nearly every other CareFind screen.
- **Database Access:** Supabase Auth's own managed user store, not a CareFind-owned table.
- **Authentication:** This service *is* CareFind's real authentication — the only one of four authentication paths across the ecosystem that meets a normal production baseline (full comparison in `architecture/Authentication.md`).
- **Business Logic:** None beyond session state management — correctly thin.
- **Weaknesses:** None structural. The gap is not in this service but in the fact that CareFind's *own admin surface* (§4.8) doesn't use it.

### 4.3 `lib/reviewAI.js`
- **Purpose:** AI-powered review analysis (side effects, efficacy, sentiment) via the Anthropic API.
- **Responsibilities:** `analyzeReviews(reviews)` → structured JSON.
- **Consumers:** `BusinessProfile.jsx`/`DrugProfile.jsx` (by naming/purpose match).
- **Database Access:** None directly — takes already-fetched review rows.
- **Authentication:** Calls `https://api.anthropic.com/v1/messages` with only a `Content-Type` header — **missing the `x-api-key`/`anthropic-version` headers the Anthropic API requires.** As written, this call is likely non-functional unless a proxy or additional header injection exists elsewhere not visible in this file.
- **Business Logic:** The prompt engineering (structured JSON extraction schema for side effects/efficacy/sentiment) is genuine, real logic — assuming the call actually reaches the API.
- **Weaknesses:** Possibly non-functional as deployed (needs live verification); if functional, calls a paid third-party LLM directly from the browser, which would expose whatever key authorizes it in the client bundle. **Notable:** CareHub has an identically-named, identically-purposed `lib/reviewAI.js` that is a 0-byte empty stub — the same feature was planned for both products, built in only one.

### 4.4 `lib/sentiment.js`
- **Purpose:** Fast, non-AI positive/neutral/negative bucketing and theme extraction over review text.
- **Responsibilities:** `getSentimentSummary(reviews)` — confirmed via `BusinessProfile.jsx`'s import.
- **Consumers:** `BusinessProfile.jsx`.
- **Database Access:** None — pure function over already-fetched rows.
- **Authentication:** N/A.
- **Business Logic:** A rule-based (not LLM) sentiment classifier — the "always available" companion to the heavier, possibly-broken `reviewAI.js`.
- **Weaknesses:** None identified; a clean, self-contained utility.

### 4.5 `lib/activeIdentity.js`
- **Purpose:** Manages which posting identity (personal / claimed business / claimed staff position) a CareFind user is currently acting as.
- **Responsibilities:** `getActiveBusiness`/`setActiveBusiness`/`clearActiveBusiness`, `getActiveStaffIdentity`/`setActiveStaffIdentity`/`clearActiveStaffIdentity`, `getActiveIdentity` — mutual exclusivity enforced in code (setting one clears the other).
- **Consumers:** Inferred to be the posting/feed surfaces given the exported shape; downstream of the `staff_claims`/`business_claims` approval flow documented in `knowledge/modules/claims.md`.
- **Database Access:** None — `localStorage` only, structurally parallel to CareHub's offline-cache service.
- **Authentication:** N/A directly, though it only becomes meaningful once a claim has been approved via the Authentication-adjacent claims flow.
- **Business Logic:** Genuine and well-designed — the mutual-exclusivity rule and the `window.dispatchEvent(new Event('identity-changed'))` cross-component sync are deliberate, documented (in the source's own comments) design choices.
- **Weaknesses:** Relies on a custom DOM event for reactivity rather than a React context — any future consumer must remember to subscribe manually.

### 4.6 `notify.js`
- **Purpose:** CareFind's own notification fan-out helper.
- **Responsibilities:** `notify({ recipientId, actorId, type, message, link, postId })`; exports `NOTIF_MESSAGES` (like/comment/reply/gift/follow/profile_view/repost/mention/live/news_like/news_comment/product_available).
- **Consumers:** Inferred from the message-type map to be the Social Feed, Live Streaming, and News domains.
- **Database Access:** `notifications` table — entirely separate from CareHub's `staff_notifications`.
- **Authentication:** Anon key via `lib/supabaseClient.js`.
- **Business Logic:** Explicitly never-notify-yourself guard (`if (recipientId === actorId) return`); fails silently by design — the identical intentional-error-swallowing pattern CareHub's `notify()` independently arrived at, a genuine convergent-design point between two teams that otherwise shared no code.
- **Weaknesses:** Same monitoring gap as CareHub's equivalent — silent failures are invisible in production.

### 4.7 Lightly-verified utility services: `lib/articleFormat.js`, `voiceCard.js`, `imageResize.js`, `subscriptions.js`
- **Purpose (inferred from name/size/adjacency, not individually read line-by-line):** article/news content formatting; voice-post visual-card data preparation (paired with the `VisualCard.jsx` component's own comment referencing "the gradients here are deliberately identical to the ones in `voiceCard.js`" — confirming a real, intentional coupling between this service and that component); client-side image resizing before upload; subscription-tier business logic for the monetization domain.
- **Consumers:** Not individually re-verified this session.
- **Database Access:** Not confirmed.
- **Authentication:** Not confirmed.
- **Business Logic:** `imageResize.js` in particular is worth flagging: if it resizes/recompresses images client-side before upload (as its name implies) without the user being told, this could silently degrade image quality for anything where fidelity matters (e.g., a verification document uploaded through a flow this service is shared with) — not confirmed either way, flagged for a dedicated follow-up.
- **Weaknesses:** This entire group is the least-verified in the catalogue; treat any specific claim about them as provisional pending a direct read.

### 4.8 Vercel Serverless Functions (`api/*.js` + `paystack-webhook.js`)

| Service | Purpose | Consumers | Auth | Business Logic | Weaknesses |
|---|---|---|---|---|---|
| **`api/admin-auth.js`** | CareFind admin login | `AdminLogin.jsx` (inferred) | Fake hash (`cf_hashed_`), unsigned base64 token | Login/verify/create-staff/list-staff/toggle-staff actions, all gated by the same unsigned token | **Full authentication bypass** — any client can forge a valid admin session (`architecture/Authentication.md`) |
| **`api/admin-setup.js`** | Bootstrap/reset the super-admin account | Presumably a one-time manual setup call | Query-string key, defaults to a hardcoded literal if `ADMIN_SECRET_SALT` unset | Correctly uses real SHA-256+salt hashing — **incompatible with `admin-auth.js`'s fake hash**, meaning an account created here likely cannot log in there | Live, deployed skeleton-key endpoint; returns the plaintext admin password in its response |
| **`api/initiate-payment.js`** | Start a Paystack transaction | `Wallet.jsx` (inferred) | `PAYSTACK_SECRET_KEY`, correctly kept server-side | Straightforward proxy to Paystack's initialize endpoint | None significant — correctly built |
| **`paystack-webhook.js`** | Verify and credit a completed Paystack payment | Paystack's servers (webhook callback) | Correct HMAC-SHA512 signature verification | Idempotent crediting via `transactions.reference` lookup before crediting `wallets.balance` — the single best-built piece of security-sensitive code in either product | **Deployment location anomaly**: sits at the project root, not inside `api/`, where Vercel's file-based routing expects functions to live; `vercel.json` only rewrites `/api/(.*)`. Whether this is reachable in production could not be confirmed from source — see `architecture/Database.md`'s Wallet & Payments entry |

---

## Cross-Ecosystem Summary

1. **No service in either product performs server-side authorization.** Every read/write across Parts 1–4 is scoped only by a client-supplied `business_id`/`user_id`, trusted at face value.
2. **Business logic is inconsistently placed.** A minority of services (Offline Cache, Stock Batches, Notifications' error-swallowing, `activeIdentity.js`) correctly own real business rules. The majority are pure CRUD wrappers with all actual logic — validation, state transitions, reconciliation — living in the calling component instead, meaning the same rule is frequently reimplemented per caller (Debts reconciliation in both POS and Purchases; the patient status machine across four hospital pages).
3. **At least seven independent hardcoded copies of the Supabase anon key remain** (down from ten — the three hospital shadow services in Part 2 were consolidated into `lib/supabase.js` and no longer count separately) across the two products when the realtime client and the Vercel functions' environment-variable fallbacks are counted alongside the main data-access modules. Note this is specifically the anon key, which is designed to be public in Supabase's model — the actual issue is duplication (key rotation touches every copy), not exposure; `SUPABASE_SERVICE_ROLE_KEY` is handled correctly everywhere, always server-side.
4. **The `readAuth()` shadow service (§3.4) and the enterprise vertical's shared conventions** are evidence that CareHub itself was built by more than one hand with more than one convention, not just evidence of divergence between CareHub and CareFind.
5. **Exactly two services in the entire ecosystem are built to a standard that would pass an external security review as-is:** CareFind's `lib/AuthContext.jsx` and `paystack-webhook.js`. Every other service in this catalogue has at least one weakness worth remediating before being trusted with production healthcare or payment data at scale.
