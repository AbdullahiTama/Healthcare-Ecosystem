# Care Ecosystem — UX Improvement Plan

- **Run:** 2026-08-15
- **Scope:** CareHub + CareFind (both apps)
- **Outcome:** Prioritized improvement plan for premium SaaS positioning
- **Stakes:** Pre-launch / finding product-market fit
- **Source of truth for identity:** `docs/design/` (20+ documents) — this plan exists to close the gap between that system and the shipped code, not to replace it.

---

## 1. Executive summary

The Care Ecosystem already has **the hard part**: a genuinely premium design system, documented and partially wired in. Both apps ship real tokens (`theme.js`), an accessibility-minded primitive library (`ui/index.jsx`), and at least one genuinely excellent screen (CareHub Landing, CareFind BusinessProfile). **The problem is not the vision — it is drift and unfinished wiring.** The implementation has quietly drifted from the documented system in ways that read as "templated": dead tokens, unshipped fonts, foreign palettes, duplicated components, and invisible failure states.

The single highest-leverage insight for pre-launch PMF: **the acquisition surfaces (auth screens, onboarding, landing pages) and the first-five-seconds surfaces (dashboards, search, profiles) decide whether a healthcare buyer believes this is enterprise-grade.** Those are where the plan concentrates effort first.

This plan is ordered as **Tiers**, each a coherent work package that can ship independently. Tier 1 is intentionally small and safe; Tier 4 is the structural work that makes the first three permanent.

---

## 2. The five premium tells to eliminate (before anything else)

These are the things an enterprise buyer or a skeptical patient will *feel* before they can articulate them. They are all cheap to fix and instantly raise perceived quality:

1. **Everything renders in system fonts** — CareFind declares "Geist" (`theme.js:46`, `global.css:60`) but never loads it. `apps/carefind/public/fonts/` contains only `lora-*.woff2`. Every screen silently falls back to `-apple-system/Segoe UI/Roboto`. A premium SaaS declares and ships its typeface.
2. **Token values re-typed by hand** — `#0E6F5A` appears as a literal in 21 CareFind files and `#f5b301`/`#fef9c3`/`#0f172a`/`#94a3b8` appear throughout, bypassing the token system the design docs mandate (`DESIGN_CHECKLIST.md`: "no ad hoc hex values").
3. **Radius inconsistency** — `theme.radius` says sm=6/md=10/lg=14/xl=20, but code uses 8, 9, 11, 12, 13, 16. The corner language is what makes a UI feel systematic; inconsistency is the #1 "AI-generated" tell (`DESIGN_VISION.md`).
4. **Invisible failures** — read errors are swallowed with `catch (e) {}` across core CareHub modules (RxInbox:20, Reception:51/59, Triage:40, Doctor:51, Lab:51) and CareFind surfaces roll ad-hoc error UI while the shared `ErrorState` component sits unused in both apps. A premium product never silently shows an empty list where data failed to load.
5. **The mobile app bar exists twice** — CareFind's Feed inlines it (Feed.jsx:1452-1512) and `DesktopHeader.jsx` re-implements it. Two sources of truth means the two will drift, and already disagree on the notification badge border (Feed.jsx:1484 vs DesktopHeader.jsx:91).

---

## 3. Tier 1 — Foundational polish (safe, high-visible-impact, ~2–4 days)

Fix the five tells above at the system level. **Nothing here changes layout or behavior — it changes perceived quality with near-zero regression risk.**

| # | Change | Files | Effort | Impact |
|---|---|---|---|---|
| T1.1 | **Ship Geist** — add `@font-face` for a self-hosted Geist woff2 (latin subset, following the Lora pattern), preconnect in both `index.html`s, keep `font-display: swap`. | `apps/carefind/public/fonts/`, `apps/carefind/src/styles/global.css`, `apps/carehub/src/styles/global.css`, both `index.html` | S | ★★★ |
| T1.2 | **Centralize the drifted literals as semantic tokens** in both `theme.js`s (e.g. `starAmber: '#f5b301'`, `amberWarn`, `amberBg`, `slateAlias`) and re-point the known offenders (Feed stars, News status pills, Live-now strip, AdminPanel) at them. | both `theme.js`, Feed.jsx, News.jsx, AdminPanel.jsx, AdminLogin.jsx | S | ★★★ |
| T1.3 | **Adopt the shared `ErrorState`** — wire it into the CareHub modules that currently `catch (e) {}` (show error + retry), and replace CareFind's three bespoke error treatments (toast / inline paragraph / banner) with it. | CareHub modules (RxInbox, Reception, Triage, Doctor, Lab, Appointments, Demand, BusinessDashboard); CareFind News, Login, Onboarding, AdminLogin | M | ★★★ |
| T1.4 | **Use the shipped skeletons** — replace bare spinner-only loading with `Skeleton`/`CardSkeleton` on the list-heavy surfaces (Inventory, Orders, Stock, Appointments; CareFind Search already uses them — extend to News, Wallet, BusinessProfile). | CareHub modules, CareFind modules | S | ★★ |
| T1.5 | **Delete CareFind's dead `PostCard.jsx` duplication decision** — either route Feed's inline card through a shared `PostCard` or delete the file and note the divergence. (Recommendation: extract — see T4.4.) | `apps/carefind/src/modules/social-feed/` | M | ★★ |
| T1.6 | **Consolidate the notification badge** border token to one value. | Feed.jsx:1484, DesktopHeader.jsx:91 | S | ★ |
| T1.7 | **Standardize radius** on the token scale across the known offenders (13→md, 11→md, 16→lg, 12→md, 9→md, 8→sm). | Search.jsx, Onboarding.jsx, Feed.jsx, PostCard.jsx | S | ★★ |

**Acceptance:** no ad-hoc hexes in the touched files; `ErrorState` has real call sites in both apps; Geist renders in both apps; `rg "catch \(e\) \{\}"` returns zero in core modules.

---

## 4. Tier 2 — Acquisition surfaces (the PMF lever)

Pre-launch, the screens that convert visitors → accounts → paying businesses are the highest-leverage pixels in the product. Three of the four weakest screens in the entire ecosystem live here.

| # | Change | Files | Effort | Impact |
|---|---|---|---|---|
| T2.1 | **Re-skin CareHub `Register.jsx`** — it is the most drifted, most hand-rolled screen in the product (slate `#0f172a`, `#888`, `#bbb`, `#555`, `#fafafa`, `#e5e7eb`, amber `#92400e`/`#fcd34d`). Rebuild on shared `Card`/`Inp`/`TealBtn`/`theme` and the Login page's visual language. | `apps/carehub/src/pages/auth/Register.jsx` | M | ★★★ |
| T2.2 | **Re-skin CareHub `AdminDashboard.jsx`** — imports `theme` yet hardcodes `#f9fafb`, `#fcd34d`, `#666`, `#ccc`, `#0f172a`; reads as a different product. | `apps/carehub/src/pages/admin/AdminDashboard.jsx` | M | ★★ |
| T2.3 | **Unify CareFind `Onboarding.jsx`** — delete the mobile/desktop form duplication (120-192 vs 197-289), adopt shared `Inp`/`TealBtn`, align radius, keep the live username check. | `apps/carefind/src/modules/account/Onboarding.jsx` | M | ★★★ |
| T2.4 | **De-duplicate the CareFind login font stack** — `Login.jsx:170,193` hardcode `system-ui` instead of `theme.fontFamily`. | `apps/carefind/src/modules/account/Login.jsx` | S | ★ |
| T2.5 | **Add the empty-state illustration language** to onboarding/auth (per `BRAND_GUIDELINES.md`: simple, geometric, brand-palette illustrations for empty states and onboarding only). | new shared component + onboarding | M | ★★ |
| T2.6 | **Consolidate marketing pages' third visual language** — `ForBusiness.jsx`/`About.jsx` are a separate bespoke system (scroll-animated hero, clamp() type, no primitives). Bring under `theme` at least for type/spacing/palette. | `apps/carefind/src/modules/marketing/` | M | ★★ |

**Acceptance:** acquisition screens use shared primitives and token values only; a visitor moving Landing → Login → Register sees one continuous brand.

---

## 5. Tier 3 — Enterprise trust surfaces (CareHub operational density)

CareHub's buyers are professionals who will judge density, speed, and reliability. The design docs demand real tables, sortable columns, result counts, and role-aware action bars (`SCREEN_PATTERNS.md` patterns 5–6, 13). Today every table is bespoke markup.

| # | Change | Files | Effort | Impact |
|---|---|---|---|---|
| T3.1 | **Build a shared `DataTable` primitive** (real `<table>`, sortable `aria-sort` headers, result count, empty/filtered states, row hover, row actions, mobile → card-list transform) and adopt it in the highest-traffic lists first (Inventory, Orders, Stock, Debts, Appointments, Clients). | new `ui/DataTable.jsx` + 6 module adoptions | L | ★★★ |
| T3.2 | **Consolidate `StatCard`/`StatTile`** — one component, delete the two `StatTile` duplicates (DashboardHome.jsx:25, Overview.jsx:17). | `ui/index.jsx`, DashboardHome.jsx, Overview.jsx | S | ★★ |
| T3.3 | **Consolidate `StatusBadge`** — one status→pill map with a `theme`-derived semantic color function, used by Reception, Triage, Doctor, Lab, Imaging, and the new DataTable. | new `ui/StatusBadge.jsx` + module adoptions | M | ★★ |
| T3.4 | **Standardize page chrome** — the copy-pasted back-arrow + title + subtitle header (Reception:43-46, Doctor:184-187, RxInbox:43-46, Triage:57-60) becomes one `DetailHeader` component. | new `ui/DetailHeader.jsx` + 4 adoptions | S | ★ |
| T3.5 | **Make stat cards clickable drill-downs** per `SCREEN_PATTERNS.md` pattern 5 ("clicking '3 low stock' goes to Inventory filtered to low-stock"). | DashboardHome, Overview | M | ★★ |
| T3.6 | **Add skeleton + error/retry to the table surfaces** (completes Tier 1 on the dense pages) and pagination to the remaining lists (only Inventory has it). | Inventory, Orders, Stock, Appointments | M | ★★ |
| T3.7 | **Audit & align spacing on dense pages** to the `theme.space` scale (the design docs mandate the 4px scale; the hand-picked 10/12/14/16/18/20/24/28/32 are mostly already on-scale — catch the off-scale values). | CareHub modules | M | ★★ |

**Acceptance:** the six busiest lists share one table implementation; no duplicate StatCard/StatusBadge; every stat card drills down; pagination + skeleton + error everywhere a list loads.

---

## 6. Tier 4 — Structural (makes Tiers 1–3 permanent)

| # | Change | Files | Effort | Impact |
|---|---|---|---|---|
| T4.1 | **De-monolith CareFind `Feed.jsx` (2,655 lines)** — extract the composer into the existing `PostComposer.jsx`, the post card into `PostCard.jsx`, the engagement bar, and the modals. The components mostly already exist; the file just isn't using them. | `apps/carefind/src/modules/social-feed/` | L | ★★★ |
| T4.2 | **De-monolith CareHub `LiveActivity.jsx` (1,097) and `POS.jsx` (883)** — split data-loading, presentation, and modals per the existing module conventions. | `apps/carehub/src/modules/` | L | ★★ |
| T4.3 | **Enforce token scales** — wire `theme.type`, `theme.space`, `theme.motion`, `theme.elevation` through screens (currently ~dead tokens); this is the permanent cure for drift. | both apps | L | ★★★ |
| T4.4 | **One source of truth for the mobile app bar** — reconcile Feed-inline vs DesktopHeader into one component. | CareFind | M | ★★ |
| T4.5 | **Add dashboard micro-interactions** — the only GSAP animation in the product is Landing. Add restrained list-transition, row-hover, and modal-entrance motion on the operational screens (≤320ms, `prefers-reduced-motion` respected — the global.css hook already exists). | CareHub modules | M | ★★ |
| T4.6 | **Introduce optimistic updates + pending-row states** for the highest-frequency saves (POS, consultations) instead of full reloads. | POS.jsx, consultation modules | L | ★★ |

**Acceptance:** no file over ~600 lines in the listed set; token scales have real call sites; one app-bar component.

---

## 7. What NOT to do (premium discipline — per `BRAND_GUIDELINES.md`)

- **No gold accents, no glassmorphism, no decorative gradients.** Premium here means precision, restraint, reliability — not luxury signifiers.
- **No serif faces inside the working product.** The Lora display serif stays on public marketing/landing pages only (already correct — keep it that way).
- **No celebratory confetti on clinical/financial outcomes** (`DESIGN_CHECKLIST.md` healthcare appropriateness).
- **No new one-off screens.** Every change above either uses an existing primitive or creates one deliberately with a documented reason (the `SCREEN_PATTERNS.md` rule).
- **Do not redesign everything at once.** This plan is ordered so the perceived-quality jump lands in Tier 1 before any structural work touches behavior.

---

## 8. Recommended execution order

```
Week 1   Tier 1 (T1.1 → T1.7)   → ship the "feels premium" pass
Week 2   Tier 2 (T2.1 → T2.6)   → fix the acquisition funnel
Week 3   Tier 3 (T3.1 → T3.7)   → enterprise density + trust
Week 4   Tier 4 (T4.1 → T4.6)   → structural, prevents regression
```

Each tier is independently shippable; Tier 1 alone delivers most of the perceived-quality gain for a fraction of the effort. Everything is verified against the `DESIGN_CHECKLIST.md` review gate before shipping.

---

## 9. Open questions (blocking nothing)

- [ ] **Geist licensing/font sourcing** — need the actual woff2 files before T1.1 ships (Geist is OFL-licensed by Vercel, freely self-hostable).
- [ ] **Priority within Tier 2** — if CareFind signups matter more than CareHub, T2.3/T2.4 come before T2.1/T2.2. Flagged for Joe.
- [ ] **Design handoff option** — if a visual reference for the acquisition screens would help, a Stitch handoff can render T2 key-screen mocks before implementation.