# Complete Component Catalogue — Care Ecosystem

Every React component in `apps/carehub` and `apps/carefind/carefind-main`, read directly from source. This supersedes the prior version of this document (which covered only CareHub's 22-component shared UI kit); that analysis is preserved and folded in below under §1–2, now alongside every page-level component in both products.

**Confidence note:** components marked **[Full read]** were read in their entirety for this catalogue (or an earlier session this engagement). Components marked **[Partial]** are confirmed to exist, with size/table-references verified via grep, but were not read line-by-line — their entries are scoped to what can be said reliably from that evidence, and this is stated explicitly rather than inferred as fact. This distinction matters most in §5 (CareFind pages).

---

## 1. CareHub — Shared UI Kit (`components/ui/index.jsx`)

*(19 exports, all **[Full read]**. Usage counts are exact grep counts across `apps/carehub/src`, not estimates.)*

### Pill
- **Purpose:** Small rounded status/category label, 7-color palette (gray/green/amber/red/blue/purple/teal).
- **Props:** `label`, `type = 'gray'`.
- **Dependencies:** None beyond inline styling.
- **Reusability:** High — the most cleanly generic component in the kit, used in 15 files.
- **Weaknesses:** Color map is hardcoded per call rather than a shared semantic name (`type={rx.status === 'pending' ? 'amber' : 'green'}` repeated near-identically in RxInbox, Lab, Imaging).
- **Duplicate implementations:** Several pages build inline colored `<span>` badges instead of using this.
- **Potential improvements:** A `STATUS_COLOR_MAP` per domain so callers stop re-deriving `type` from a status string inline.

### Card
- **Purpose:** Base white/rounded/bordered/shadowed container — the visual atom of the app.
- **Props:** `children`, `style = {}`, `onClick`.
- **Reusability:** Maximal — used in 28 files, the single most-used component in either codebase.
- **Weaknesses:** `onClick` makes the card clickable with no keyboard/focus affordance (no `role`, `tabIndex`, `onKeyDown`) — an accessibility gap on every clickable-card usage.
- **Duplicate implementations:** None — nothing re-implements this.
- **Potential improvements:** Fix the accessibility gap once here.

### StatCard
- **Purpose:** Dashboard metric tile (icon, value, label, optional alert border, optional click-through).
- **Props:** `icon`, `label`, `value`, `sub`, `alert`, `onClick`.
- **Reusability:** High — 13 files.
- **Weaknesses:** None in the component itself; correctness bugs (e.g. Reception's mislabeled "Total Today") are caller bugs.
- **Potential improvements:** A `<StatRow items={[...]}/>` wrapper to remove the repeated grid-wrapper style copy-pasted around every group.

### TealBtn
- **Purpose:** Primary CTA button (teal gradient).
- **Props:** `children`, `onClick`, `style = {}`, `disabled`.
- **Reusability:** High in principle — 24 files — but undermined by widespread duplication (below).
- **Duplicate implementations — significant:** Nearly every hospital-station page hand-rolls its own full-width primary button with the identical inline gradient (`linear-gradient(135deg,#0f766e,#14b8a6)`) instead of `<TealBtn style={{width:'100%',...}}>`: Reception, Triage, Doctor, Lab, Imaging, plus Inventory's upload/cleanup confirm buttons. **Also confirmed this session:** the six enterprise-vertical components (Warehouses, Territories, Messages, Stock, Orders, LiveActivity) run an entirely separate, parallel bottom-sheet-modal system (`position:fixed, alignItems:'flex-end'`, hand-built dialogs) that does reuse `TealBtn`/`GhostBtn`/`Inp`/`Card` for buttons and text fields, but never uses the shared `Modal` component for the dialog shell itself — every one of their ~15 modal-like panels across those six files is a hand-rolled bottom sheet, structurally distinct from the centered `Modal` every other CareHub page uses.
- **Potential improvements:** A `<PrimaryActionBtn full>` variant; and either adopt `Modal` in the enterprise vertical or promote the bottom-sheet pattern to a second shared component (`BottomSheet`) so it stops being reinvented per file.

### DarkBtn
- **Purpose:** Secondary-emphasis button, dark navy gradient.
- **Props:** `children`, `onClick`, `style = {}`.
- **Reusability:** Low — 1 file (`Register.jsx`) only, despite living in the shared kit.
- **Potential improvements:** Inline it in `Register.jsx` or find it a second real consumer.

### GhostBtn
- **Purpose:** Low-emphasis bordered "Cancel" button, always paired with `TealBtn`.
- **Reusability:** High — 18 files, consistently used.
- **Weaknesses:** None.
- **Potential improvements:** A `<ModalActions>` composite to remove the repeated Cancel/Save footer pair copy-pasted into nearly every `Modal`.

### RedBtn
- **Purpose:** Destructive/delete action button.
- **Reusability:** Narrow but consistent — 4 files (Staff, Inventory, Expenses, Appointments).
- **Weaknesses:** Each of its 4 call sites independently wraps the handler in its own `window.confirm(...)` string rather than the component owning confirmation.
- **Potential improvements:** Accept a `confirmMessage` prop and own the confirm internally.

### SectionHead
- **Purpose:** Page header — title, subtitle, one optional action button.
- **Reusability:** 10 files.
- **Duplicate implementations:** `Inventory.jsx`, `RxInbox.jsx`, `Lab.jsx`, `Imaging.jsx` hand-build their own header block instead — `Inventory.jsx` specifically needs multiple action buttons, which `SectionHead`'s single `btn`/`onBtn` pair can't express.
- **Potential improvements:** Widen the action slot to an array/children.

### Avatar
- **Purpose:** Circular initial-letter badge.
- **Reusability:** 7 files. Clean, no issues found.

### Toast / useToast
- **Purpose:** Fixed-position transient message + the hook that drives it.
- **Reusability:** 19 files each — but structurally weak: every one of the 19 call sites instantiates an **independent** toast state and renders its own `<Toast/>`, so a toast fired from a nested modal only surfaces if that exact component also renders `<Toast/>`.
- **Duplicate implementations:** 19 parallel instances of the same pattern — a duplication problem even though it's "one hook, reused."
- **Potential improvements:** The single strongest case in the whole kit for promotion to a `ToastProvider` context, collapsing 19 local states into one shared queue.

### Modal
- **Purpose:** Generic centered dialog shell.
- **Reusability:** 10 files directly; `Inventory.jsx` alone renders 4 separate instances.
- **Weaknesses — confirmed bug:** The footer is styled `borderBottom` instead of `borderTop` (`components/ui/index.jsx:117`), producing a stray border under the action buttons on every modal with a footer, app-wide.
- **Duplicate implementations:** The entire enterprise vertical (§ TealBtn above) never uses this — six files hand-roll a parallel bottom-sheet dialog system instead.
- **Potential improvements:** Fix the one-line CSS bug; extend `Modal` (or formalize the bottom-sheet as a sibling component) so the enterprise vertical stops reinventing dialogs.

### Inp
- **Purpose:** Labeled text input with required-asterisk and read-only styling.
- **Reusability:** Highest of any form primitive — 22 files.
- **Weaknesses:** No `error`/`hint` prop — every page needing field validation messaging builds its own ad hoc banner instead.

### Sel
- **Purpose:** Labeled `<select>`, accepts plain strings or `{value,label}` objects.
- **Reusability:** 10 files. No issues in the component itself.

### Textarea
- **Purpose:** Labeled multi-line field.
- **Reusability:** 9 files.
- **Weaknesses:** Unlike `Inp`, has no `required`/asterisk support — a prop-shape inconsistency between two parallel primitives.
- **Potential improvements:** Merge `Inp`/`Textarea` into one `Field` component with a `multiline` flag.

### Toggle
- **Purpose:** Labeled on/off switch with description line.
- **Reusability:** Only 3 files (Settings, Inventory's `ProductModal`, Register) use the actual component.
- **Duplicate implementations — confirmed:** Both `Inventory.jsx`'s product-table row toggle and `CareFind.jsx`'s (the dashboard page) listing-table row toggle hand-build a visually identical switch for the exact same `list_on_carefind` field, rather than using `<Toggle>` directly. The same boolean field's UI is implemented three separate ways across two files.
- **Potential improvements:** A compact-size `Toggle` variant for row-level use, replacing both hand-rolled switches.

### OfflineBanner
- **Purpose:** Intended online/offline status bar with a "Sync Now" action.
- **Reusability:** **Zero** — confirmed via grep, never imported anywhere.
- **Weaknesses — critical:** Calls `require('../lib/supabase')` inside a `useEffect`; `require` does not exist in a Vite/ESM bundle and will throw the moment this is ever wired in. The `businessId` prop is declared but unused in the body.
- **Duplicate implementations:** `BusinessDashboard.jsx` has its own separate, working inline offline banner — this component's purpose is already covered elsewhere, just not by this component.
- **Potential improvements:** Fix or delete.

### Loading / Empty
- **Purpose:** Loading spinner placeholder / empty-state block with optional CTA.
- **Reusability:** 15 and 14 files respectively. `Empty` is a good example of correct internal composition (reuses `TealBtn` rather than hand-styling its own button). No issues found in either.

---

## 2. CareHub — Layout Components (`components/layout/*`)

### Sidebar
- **Purpose:** Persistent left nav — brand header, role/business-type-filtered nav list, embedded `NotificationBell`, sign-out.
- **Props:** `brand`, `role`.
- **Reusability:** N/A by nature — mounted once, in `BusinessDashboard.jsx`; correctly a singleton.

### TopBar
- **Purpose:** Per-route header — page title, role badge, avatar.
- **Props:** `title`, `brand`, `role`.
- **Reusability:** Genuinely reused — 17 inline call sites in `BusinessDashboard.jsx`'s route table.
- **Weaknesses:** The 6 enterprise-vertical routes render with no `TopBar` at all — an inconsistency confirmed again this session by direct reads of `Warehouses.jsx`/`Territories.jsx`/`Messages.jsx`/`Stock.jsx`/`Orders.jsx`/`LiveActivity.jsx`, none of which import or render it.
- **Duplicate implementations:** All 17 call sites repeat the identical wrapper shape (`<><TopBar .../><div style={{padding:'24px'}}>...</div></>`).
- **Potential improvements:** A `<DashboardPage title="X">` wrapper collapsing all 17 fragments to one-line routes, and trivially extending the same header to the 6 currently-bare enterprise routes.

### NotificationBell
- **Purpose:** Sidebar-embedded bell — unread count, slide-out panel, live updates via `watchTable`.
- **Props:** `brand`.
- **Reusability:** N/A (singleton, mounted once inside `Sidebar.jsx`).
- **Weaknesses — confirmed, and now shown to be part of a much larger pattern (see §6):** Reads the logged-in user via a private `readAuth()` → `localStorage.getItem('carehub_auth')` parse rather than `useAuth()`. This session found the identical `readAuth()` helper — same name, same body — independently redefined in **five** files total: `NotificationBell.jsx`, `Messages.jsx`, `Stock.jsx`, `Orders.jsx`, and `LiveActivity.jsx`. None of them import it from a shared location; each is a separate copy-paste.
- **Potential improvements:** Extract one shared `readAuth()` (or better, route all five through `useAuth()`), eliminating five duplicated implementations of the same six lines.

---

## 3. CareHub — Page Components (`pages/`)

*All entries below are **[Full read]**.*

### Auth & Landing

**Landing.jsx** — Purpose: marketing/pricing page. Props: none (top-level route). Dependencies: `lib/utils.js` only. Reusability: N/A (one-off page). Weaknesses: pricing tiers (₦10,000–₦60,000/month) are entirely static marketing copy with **no backend connection at all** — no plan-selection state, no payment integration, every CTA just navigates to `/register`; this is the clearest evidence that CareHub's documented "Subscription Management" responsibility has no implementation anywhere in the codebase (see `knowledge/modules/billing.md`).

**Login.jsx** — Purpose: business/staff/admin sign-in. Props: none. Dependencies: `lib/supabase.js` (`loginBusiness`/`loginStaff`/`getBusinessById`), `App.jsx`'s `login()`. Weaknesses: hardcoded super-admin credential in source; plaintext password comparison (full detail in `architecture/Authentication.md`).

**Register.jsx** — Purpose: 5-step business signup wizard. Props: none. Dependencies: `lib/supabase.js` (`registerBusiness`), `lib/email.js` (`emailAdminNewRegistration`), `lib/utils.js` (`BUSINESS_TYPES`, `NIG_STATES`). Components: step-switched inline render blocks, no sub-components extracted despite 5 distinct steps. Weaknesses: password captured with no client-side hashing; every business type gets an identical generic wizard with no type-specific follow-up (confirmed again: step 3's "Years in Business"/"Staff Count" fields are collected but not sent in the `registerBusiness()` payload at all — **dead form fields**, the same class of bug documented for `Doctor.jsx` in the Patients-module review).

### Admin

**AdminDashboard.jsx** — Purpose: CareHub's internal back office — business approval/rejection, admin team management. Props: none. Dependencies: `lib/supabase.js`, `lib/email.js`. Polls every 30 seconds (`setInterval(load, 30000)`) — the same polling interval independently chosen in `RxInbox.jsx` with no shared constant. Weaknesses: `isAdmin` gate is entirely client-side (full detail in `architecture/Security-Risks.md`).

### Core Retail / Business Operations

**Inventory.jsx, POS.jsx, Clients.jsx, Staff.jsx, Purchases.jsx** — previously catalogued in depth in this engagement's module reviews (`knowledge/modules/inventory.md`, `point-of-sale.md`, `clients.md`, `staff-management.md`, `purchases.md`); not repeated here.

**Appointments.jsx** — Purpose: booking CRUD with status workflow (pending→confirmed→completed/cancelled). Props: `brand, role, perms`. Dependencies: `lib/supabase.js` full CRUD, `lib/utils.js`. Reusability: N/A (single-purpose page). Weaknesses: no link to the Patients/Reception domain — confirmed again this session, no `patient_id` or cross-reference field anywhere in its payload. Duplicate implementations: its inline status-pill coloring logic (`a.status === 'confirmed' ? 'green' : ...`) is the same repeated pattern documented for `Pill` above.

**Expenses.jsx** — Purpose: expense logging **plus a genuinely novel monthly budget tracker** not previously documented. Props: `brand, role, perms`. Dependencies: `lib/supabase.js` (`getExpenses`/`addExpense`/`deleteExpense` — no update function), `lib/utils.js`. **Notable finding:** the budget feature (`getBudgets`/`saveBudget`/`getBudget`) is entirely `localStorage`-backed (`BUDGET_KEY = 'carehub_expense_budget'`), keyed by `businessId` + month, with **no corresponding Supabase table** — a budget set on one device/browser is invisible on any other device or to any other staff member, and is lost if browser storage is cleared. This is a third distinct client-only-persistence pattern in CareHub (alongside the offline-sales queue and the `carehub_auth` cache), not previously catalogued. Weaknesses: no `updateExpense` (can only delete/re-add); the budget's device-locality is a real limitation given the UI text ("All staff can see the budget") **overpromises what the implementation actually does** — the budget is not actually visible to "all staff," only to whoever is using the same browser it was set in.

**Debts.jsx** — Purpose: bidirectional debt ledger, reconciliation hub for POS/Purchases. Props: `brand, role, perms`. Dependencies: `lib/supabase.js` full CRUD. Duplicate implementations: none in this file itself, but it is the target of duplicated reconciliation logic written independently in `POS.jsx` and `Purchases.jsx` (see `knowledge/modules/debts.md`).

**Settings.jsx** — Purpose: business profile + receipt customization, with a live receipt preview. Props: `brand, role, perms`. Dependencies: `lib/supabase.js` (`getSettings`/`saveSettings`/`updateBusiness`), `lib/utils.js`. Weaknesses: `saveSettings`'s manual check-then-write is a read-then-write race under concurrent saves. **Positive note:** this is the one CareHub page that correctly gates its *entire* render behind a role check (`if (!isOwner) return <lockscreen>`) rather than only hiding individual buttons — a stronger, more consistent enforcement pattern than `Staff.jsx`'s (which still exposes the full roster to non-Owners) or `Reports.jsx`'s.

**Reports.jsx** — Purpose: cross-domain financial summary with a well-built client-side CSV export. Props: `brand, role, perms`. Dependencies: `lib/supabase.js` (`getSales`/`getExpenses`/`getPurchases`, read-only). Reusability: N/A. Weaknesses: all aggregation client-side over unbounded fetches (see `architecture/Performance-Risks.md`); `perms.canExportReports` gates only the export *button*'s visibility, not whether the underlying data was already fetched into the page.

**CareFind.jsx** (the CareHub dashboard page, not the other product) — Purpose: business's public CareFind listing preview + per-product visibility toggle. Props: `brand, products, setProducts, loadProducts`. Dependencies: `lib/supabase.js` (`updateProduct` only), `lib/utils.js`. **Confirmed duplicate:** its `toggleCareFind()` function and row-toggle UI are near-byte-identical to `Inventory.jsx`'s own implementation of the same feature — see `Toggle` above and `knowledge/modules/carefind-listing.md`.

**Locations.jsx** — Purpose: multi-branch view, branch creation, and cross-branch stat aggregation. Props: `brand, role`. Dependencies: `lib/supabase.js` (`getAllLocations`, `addBranch`, plus read-only `getSales`/`getTodaySales`/`getProducts` per branch), `useAuth()`. **Weaknesses — new, critical finding:** `switchToLocation()` destructures `const { auth, setAuth } = useAuth()` and calls `setAuth(newAuth)` to switch the active branch context — but `App.jsx`'s `AuthContext.Provider` only exposes `{ auth, login, logout, isAdmin }`. **`setAuth` is not part of the context value CareHub provides.** Calling `setAuth(newAuth)` will throw `TypeError: setAuth is not a function` at runtime. This means the "Switch to this branch →" button — the entire point of this multi-branch feature for an Owner managing several locations — is very likely broken as deployed. This was not caught in any prior review pass and should be verified directly against the running application. A secondary weakness: `saveBranch()` passes the parent's plaintext `password` into the new branch's `businesses` row, propagating the same plaintext-credential pattern to every branch created.

### Hospital Clinical Pipeline

**Reception.jsx, Triage.jsx, Doctor.jsx, RxInbox.jsx, Lab.jsx, Imaging.jsx, ConsultationRouter.jsx** — fully catalogued in `knowledge/modules/hospital.md`, `patient.md`, `laboratory.md`, `pharmacy.md`, `imaging.md`; not repeated here.

### Enterprise Vertical (manufacturer/wholesale)

*All six read in full this session — previously only known via service/table inventory, not component-level detail.*

**Warehouses.jsx** — Purpose: warehouse/branch CRUD with parent/child hierarchy and manager assignment. Props: `brand, showToast`. Dependencies: `lib/supabase.js` (`getEnterpriseLocations` CRUD, `getStaff`). Components: page + inline bottom-sheet form, no `Modal` usage. Weaknesses: deletion correctly blocks if child locations exist (`remove()` checks `locations.filter(l => l.parent_location_id === loc.id)`) — a genuinely good guard not present in most other CareHub delete flows.

**Territories.jsx** — Purpose: sales-territory CRUD + rep assignment via a toggle-picker UI. Props: `brand, showToast`. Dependencies: `getTerritories` CRUD, `getStaff`, `getRepAssignments`/`assignRepToTerritory`/`removeRepFromTerritory`. Weaknesses: no conflict check preventing a rep from being assigned to overlapping territories (confirmed by reading `toggleRep()` — it only checks existence in the current territory, not overlap with siblings).

**Messages.jsx** — Purpose: internal threaded correspondence with To/Cc, file attachments, read receipts. Props: `brand, showToast`. Dependencies: `lib/supabase.js` (7 functions), local `readAuth()` (see §6). Weaknesses: 20MB per-file limit enforced client-side only; **duplicate helper functions** `fmtStamp`/`fmtSize`/`refFor` are independently redefined here and in `Orders.jsx` almost identically.

**Stock.jsx** — Purpose: batch-level stock receiving, transfer, and adjustment with expiry-date tone-coding (expired/expiring-soon/ok). Props: `brand, showToast`. Dependencies: `lib/supabase.js` (`getStockBatches` CRUD, `transferStock`, `adjustStock`, `getEnterpriseLocations`, `getProducts`), local `readAuth()`. This is the most functionally complete of the enterprise pages — genuine audit-trail semantics (every transfer/adjustment records `moved_by`). Weaknesses: entirely disconnected from the generic `products.stock` field (see `knowledge/modules/stock-batches.md`).

**Orders.jsx** — Purpose: LPO submit→approve→process→dispatch→deliver pipeline with a visual stepper, audit trail, and file attachments. Props: `brand, showToast`. Dependencies: `lib/supabase.js` (11 functions), local `readAuth()`. This is the single most complex CareHub page after `LiveActivity.jsx` — a full approval workflow with role-computed `canApprove()` logic. Weaknesses: `submitOrder()`'s multi-step sequence (file uploads → `createOrder`) has no transaction; **duplicate helpers** `fmtStamp`/`fmtSize` shared verbatim with `Messages.jsx`.

**LiveActivity.jsx** — Purpose: the single most feature-dense component in either codebase — dynamic custom-field-driven activity logging, GPS + reverse-geocoding, in-browser audio recording via `MediaRecorder`, a live real-time feed (`watchTable`), reactions/comments, and a configurable-column CSV export. Props: `brand, showToast`. Dependencies: 13 `lib/supabase.js` functions, `lib/realtime.js`, local `readAuth()`. Components: no sub-component extraction at all despite covering field-config, activity-logging, and a social feed within one 1,226-line file — the largest CareHub file read this session. Weaknesses: the sheer breadth of responsibility in one file is itself the primary maintainability weakness; `pickAudioType()`'s browser-codec-detection logic and the `MediaRecorder` lifecycle handling is genuinely well-engineered (mirrors the quality of CareFind's `VoiceRecorder.jsx`, discussed in §4, despite the two being written independently in different products).

**Ecosystem-level observation on the enterprise vertical:** all six components share a consistent internal style distinct from the rest of CareHub — `function(e) {}` syntax instead of arrow functions almost throughout, the bottom-sheet modal pattern instead of `Modal`, and the duplicated `readAuth()` helper. This is strong evidence the enterprise vertical was built as a distinct, later effort by someone following different conventions than whoever wrote the retail/hospital pages, without a shared style guide reconciling the two.

---

## 4. CareFind — Reusable / Shared Components

*All **[Full read]** this session. Unlike CareHub, these are not organized into a `components/` folder — they are ordinary files at the `src/` root that happen to be imported by multiple screens.*

### Logo
- **Purpose:** The CareFind wordmark/icon, parameterized by size/tone/mark-only mode. Explicitly commented as existing "so the logo is identical everywhere it appears."
- **Props:** `size = 32`, `markOnly = false`, `tone = 'light'`, `style = {}`.
- **Reusability:** High — the closest thing to a deliberately-designed shared component in CareFind.
- **Duplicate implementations — confirmed:** `VisualCard.jsx` hand-builds its own near-identical circular "C" logo mark from scratch (same gradient colors, same shape) instead of rendering `<Logo markOnly />`. The one component explicitly built to prevent exactly this kind of drift is bypassed by another file in the same codebase.
- **Potential improvements:** Replace `VisualCard.jsx`'s inline logo markup with `<Logo markOnly size={26}/>`.

### BottomNav
- **Purpose:** Fixed mobile bottom tab bar (Home/MedMarket/Compose/News/Profile) with a live unread-news badge.
- **Props:** `onCompose`.
- **Dependencies:** `lib/supabaseClient.js`, `lib/AuthContext.jsx`, `lib/theme.js`.
- **Reusability:** High — mounted on most consumer screens (confirmed on `Search.jsx`).
- **Weaknesses:** The unread-news badge logic (`profiles.news_last_seen` vs. `news.published_at`) is a real, working feature but has no equivalent anywhere in the badge/notification patterns documented for CareHub — the two products solved "unread count" in structurally unrelated ways.

### SupportPrompt
- **Purpose:** A once-per-session, delayed, dismissible bottom banner nudging users toward gifting/support.
- **Props:** `onGift`, `creatorName`, `delay = 12000`.
- **Dependencies:** `theme.js`, browser `sessionStorage` only.
- **Reusability:** Well-scoped, single-purpose, cleanly written — a genuinely good small component.
- **Weaknesses:** None significant. `sessionStorage`-based "show once" is appropriate for its purpose (unlike the Expenses budget tracker's misuse of `localStorage` for data that should be server-persisted).

### VisualCard
- **Purpose:** Renders a styled "quote card" (5 gradient templates) for text/voice/image/video posts, used both on-screen and as the source of truth for exported PNG/video generation (per its own comment).
- **Props:** `templateKey`, `content`, `preview`, `hasVoice`, `imageUrl`, `videoUrl`, `username`.
- **Reusability:** Used across post-creation flows (Feed-adjacent, per file naming).
- **Duplicate implementations:** The Logo-markup duplication noted above.
- **Potential improvements:** See Logo.

### richText.jsx (`RichTextInput`, `renderRichText`, `stripMarkers`, `previewText`)
- **Purpose:** A hand-built, mobile-friendly rich-text system using bracket markers (`{h:yellow}...{/h}`) instead of HTML/markdown — a deliberate choice given the code comment explains it's "reliable on mobile: user selects text... we wrap it."
- **Props (RichTextInput):** `value`, `onChange`, `placeholder`, `rows`.
- **Reusability:** Confirmed used by `ArticleEditor.jsx`/`NewsArticle.jsx` (by naming/purpose match, not individually re-verified this session).
- **Weaknesses:** The marker regex (`renderRichText`) is recursive with a 500-iteration guard (`guard < 500`) — a defensive but slightly unusual safety valve suggesting a past infinite-loop concern with malformed/nested marker input.
- **Potential improvements:** None significant — this is one of the better-designed pieces of either codebase, including the thoughtful `previewText()` function that strips a JSON block-array down to readable preview text without ever dumping raw JSON to the user.

### VideoRecorder / VideoUploader / VoiceRecorder / SlideUploader
- **Purpose:** Four parallel media-capture/upload components for live-show content — record video, upload video, record voice, and convert a PDF into postable slide images respectively.
- **Props:** All take `showId` + an `onRecorded`/`onUploaded`/`onPostSlide` callback.
- **Dependencies:** All four independently call `supabase.storage.from('live-media').upload(...)` + `.getPublicUrl(...)`.
- **Reusability:** Each is purpose-specific but shares a near-identical shape.
- **Duplicate implementations — significant:** All four re-implement the same upload-to-`live-media`-bucket-then-callback pattern independently, with separate `uploading`/`error` state and separate error messaging ("Upload failed. On a weak connection, try a shorter clip." appears near-verbatim in three of the four). `VoiceRecorder.jsx` additionally has more sophisticated audio-constraint handling (an `hq` prop for podcast-grade capture vs. lightweight live-show audio) that `VideoRecorder.jsx` doesn't mirror for video quality tiers, despite being conceptually parallel.
- **Potential improvements:** Extract a shared `useMediaUpload(bucket, prefix)` hook covering the upload/error/callback plumbing common to all four, leaving only the capture-specific logic (camera vs. mic vs. PDF rendering) in each component.
- **Notable external dependency:** `SlideUploader.jsx` loads PDF.js from `cdnjs.cloudflare.com` via a dynamically-injected `<script>` tag at runtime — a real external dependency that appears nowhere in `package.json` and would fail silently offline or under a restrictive Content-Security-Policy.

---

## 5. CareFind — Page Components

*Marked **[Full read]** or **[Partial]** per the confidence note at the top of this document.*

**Search.jsx** [Full read] — Purpose: the product/business/professional search surface — CareFind's genuine "healthcare discovery" screen. Props: none (route). Dependencies: `supabase-js` direct queries, `lib/AuthContext.jsx`, `lib/theme.js`, `BottomNav`. Weaknesses: background search-logging failure surfaces as a blocking `alert()` (see `knowledge/modules/healthcare-discovery.md`).

**BusinessProfile.jsx** [Full read] — Purpose: public business listing, reviews, sentiment analysis. Props: none (route, `:id` param). Dependencies: `lib/sentiment.js`, `lib/reviewAI.js`, `lib/AuthContext.jsx`. Full detail in `knowledge/modules/business-profiles-reviews.md`.

**AuthContext.jsx** [Full read] — Not a page but the app's sole context provider; correctly implemented Supabase Auth wrapper (see `architecture/Authentication.md`).

**Feed.jsx** [Partial — 1,823 lines, largest file in either product] — Purpose: home social feed. Confirmed via targeted reads: writes `unclaimed_entities` for crowdsourced directory entries, integrates `lib/activeIdentity.js` for posting-as-business/staff. Not read in full; internal component structure and full table interaction list not independently verified.

**AdminPanel.jsx** [Partial — 1,868 lines, largest file in either product] — Purpose: CareFind's back office — verification requests, business/staff claims, content reports, transactions, tasks, two admin rosters (`admin_teams`/`admin_users`). Confirmed via targeted reads: `approveClaim()` writes back into CareHub's own `businesses.visible_on_carefind` field (the clearest cross-product write found in either codebase — see `architecture/Shared-Services.md`). Sits behind the authentication weaknesses documented in `architecture/Authentication.md`.

**ProfessionalMonetization.jsx** [Partial — 383 lines] — Purpose: subscriber pricing, consultation setup, task browsing/submission, wallet balance. Confirmed via targeted reads: writes the `consultations` table under a schema (`professional_id, patient_id, type, fee, status`) that collides in name with CareHub's unrelated clinical `consultations` table — the ecosystem's single highest-priority unresolved question (`architecture/Database.md`).

**ClaimBusiness.jsx, ClaimStaffPosition.jsx, BusinessDashboard.jsx (CareFind)** [Partial, confirmed via targeted reads] — the `business_claims`/`staff_claims` bridge to CareHub; full detail in `knowledge/modules/claims.md`.

**Wallet.jsx** [Partial — 277 lines] — Purpose: balance display, funding, transaction history, paired with the correctly-built `api/initiate-payment.js`/`paystack-webhook.js`. Full detail in `knowledge/modules/wallet-payments.md`.

**AdminLogin.jsx, AdminStaff.jsx, AdminTeams.jsx** [Not read this session] — Purpose inferred from name/route only: admin sign-in and two admin-roster management screens supporting `AdminPanel.jsx`. Not individually verified.

**Dashboard.jsx, ProfessionalDashboard.jsx, Onboarding.jsx, Profile.jsx, PublicProfile.jsx, SavedPosts.jsx, VerifyProfessional.jsx, DrugProfile.jsx** [Not read this session] — Confirmed to exist via file listing and, for `Profile.jsx`, one targeted grep confirming it reads `staff_claims` (see `claims.md`). Purpose, props, and internal structure not independently verified — flagged for a dedicated follow-up pass rather than described speculatively here.

**LiveSession.jsx, LiveShow.jsx, LiveDashboard.jsx, GoLive.jsx, UserGoLive.jsx, DrawingBoard.jsx, GiftPanel.jsx** [Not read this session] — The live-streaming/gifting cluster, ~1,900 lines combined, consuming the media components in §4. Not individually read; this remains the largest unverified surface in either codebase, as already flagged in `knowledge/modules/live-streaming.md`.

**News.jsx, NewsArticle.jsx, ArticleEditor.jsx** [Not read this session] — Confirmed to exist and to depend on `richText.jsx` by naming convention; not individually verified.

**PlaylistCreate.jsx, PlaylistView.jsx, Stories.jsx** [Not read this session] — Confirmed to exist; not individually verified.

---

## 6. Ecosystem-Wide Cross-Cutting Findings

Patterns visible only by reading across both products' component sets together:

1. **`readAuth()` — a five-times-duplicated helper, all in CareHub.** Identical implementations in `NotificationBell.jsx`, `Messages.jsx`, `Stock.jsx`, `Orders.jsx`, `LiveActivity.jsx` — all parsing `localStorage.getItem('carehub_auth')` directly rather than using `useAuth()`. This is more extensive than previously documented (earlier passes had only caught `NotificationBell.jsx`'s case).
2. **Two unrelated "logo" duplications**, one per product: CareFind's `VisualCard.jsx` re-implements `Logo.jsx`'s mark instead of importing it; CareHub has no equivalent single-source logo component at all — its brand mark is inline JSX repeated across `Login.jsx`, `Landing.jsx`, `AdminDashboard.jsx`, and `Sidebar.jsx` independently (never centralized the way CareFind at least attempted with `Logo.jsx`).
3. **Two unrelated "bottom sheet vs. centered modal" splits.** CareHub's enterprise vertical (6 files) uses a hand-rolled bottom sheet instead of the shared `Modal`. CareFind has no shared modal component at all to diverge from — every dialog-like UI across its ~48 files is independently built.
3. **Convergent good engineering, arrived at independently:** `LiveActivity.jsx`'s (CareHub) and `VoiceRecorder.jsx`'s (CareFind) `MediaRecorder` handling — codec detection, `onstop` blob assembly, stream cleanup — are both genuinely well-written and structurally similar, despite being authored in unrelated codebases with no shared library. Neither team appears to know the other solved the same problem.
4. **Three distinct client-only-persistence patterns**, none backed by the database: CareHub's offline-sales queue (`localStorage`, legitimate use), CareHub's expense budget tracker (`localStorage`, likely a gap — data that should be shared across staff/devices isn't), and CareFind's `SupportPrompt` session-dismissal (`sessionStorage`, legitimate use) and `activeIdentity.js` (`localStorage`, legitimate use). Two of the four uses are appropriate; one (the budget tracker) misrepresents itself to the user as shared data when it isn't.

## Summary Table — Highest-Priority Items From This Pass

| Finding | Component(s) | Severity |
|---|---|---|
| ~~`setAuth` is not provided by `AuthContext` but is called~~ — **Fixed**: `setAuth` now exposed on the context provider value | `Locations.jsx` | ~~Critical — likely runtime crash on "Switch to this branch"~~ Resolved |
| `readAuth()` duplicated 5×, bypassing `useAuth()` | NotificationBell, Messages, Stock, Orders, LiveActivity | High |
| Landing page pricing has zero backend/payment wiring | `Landing.jsx` | Medium (confirms `billing.md`'s finding) |
| Register.jsx step-3 fields captured but never submitted | `Register.jsx` | Medium |
| Budget tracker is device-local but UI claims it's shared | `Expenses.jsx` | Medium |
| 4 media-upload components duplicate the same upload/error plumbing | VideoRecorder, VideoUploader, VoiceRecorder, SlideUploader | Low–Medium |
| `VisualCard.jsx` reinvents `Logo.jsx`'s mark | CareFind | Low |
| `Modal`'s footer border bug (carried over) | `components/ui/index.jsx` | Low, high-visibility |
