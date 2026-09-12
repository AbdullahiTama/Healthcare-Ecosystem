---
status: final
updated: 2026-08-18
---

# CareHub Reports Hub — EXPERIENCE.md

The behavioral contract for the CareHub Intelligence & Reporting surface. This document is the peer of `DESIGN.md` in the same run folder; visual values referenced as `{path.to.token}` resolve against that file. Where this document and the current implementation conflict, this document wins for new work; existing behavior is migrated toward it incrementally.

---

## 1. Foundation

### Summary

CareHub's reporting surface today is fragmented: two loosely-coupled pages (`Reports`, `ADR Reports`) under a "Intelligence" sidebar group, with no shared IA, no operational/client/compliance coverage, and no scheduled delivery. This spine reworks the surface into **one Reports Hub** — a single tabbed destination at `/dashboard/reports` with six tabs (Financial, Operational, Client & Sales, ADR, Compliance, Scheduled), role-aware defaults, deep-linkable tabs, and a must-have Scheduled Reports capability. It is built for a **regulated African healthcare market** (NAFDAC, PCN, FIRS): trust, traceability and audit-readiness are first-class constraints, not features.

Three named users drive the design:

| Persona | Context | Default tab | Signature moment |
|---|---|---|---|
| **Amara** — independent pharmacy owner (2 locations, 3 staff) | NAFDAC audit next month | Financial | Schedules monthly P&L + ADR summary; exports NAFDAC-compliant CSV |
| **Dr. Okafor** — hospital manager (50 beds, pharmacy+lab+imaging) | PCN compliance | Operational | Spots "3 critical stockouts", creates purchase orders straight from report rows |
| **Chidi** — chain manager (5 pharmacies, SW Nigeria) | Regional oversight, consolidated reporting | Financial (All Locations) | Drills from consolidated rollup into one underperforming branch |

### Form factors

| Screen | Primary use | Density | Layout |
|---|---|---|---|
| **Desktop** (1440px+, back office) | Multi-tab report building, schedule config, CSV review | High | Sticky tabs + context bar + KPI row + table |
| **Tablet** (768–1023, pharmacy counter) | Quick ADR submission, stockout glance, overdue alerts | Medium | 2-up KPI grid, scrollable tab row, container-scrolled tables |
| **Mobile** (<768, owner on the go) | KPI glance, deadline alerts, schedule status | Low | Summary cards → detail screens, pinned primary action |

### Hard constraints (regulatory floor)

1. **NAFDAC ADR**: 24-hour reporting window tracked per report; overdue is a distinct, prominent state.
2. **PCN**: prescription audit trail and controlled-substance register exportable from Compliance tab.
3. **FIRS**: VAT-compliant invoice/receipt data included in Financial exports.
4. **Auditability**: every report generation, export and schedule delivery is logged with a traceable reference ID; retention 7 years.
5. **RBAC**: Pharmacist sees ADR + Operational; Cashier sees nothing in Reports; Owner/Manager see all. (Extends existing `permissions.js` nav logic; security implications of any widening must be explained before implementation.)

---

## 2. Information Architecture

### URL map

```
/dashboard/reports                    → Hub (role-aware default tab)
/dashboard/reports/financial          → Financial (deep-linkable)
/dashboard/reports/operational        → Operational
/dashboard/reports/clients            → Client & Sales Analytics
/dashboard/reports/adr                → ADR (Pharmacovigilance)
/dashboard/reports/compliance         → Compliance & Audit
/dashboard/reports/scheduled          → Scheduled Reports (manager)
/dashboard/reports/builder            → Report Builder (owner/manager)
/dashboard/reports/templates          → My Templates (saved custom reports)
```

**Backward compatibility**: existing routes `reports` and `adr-reports` redirect to `/dashboard/reports/financial` and `/dashboard/reports/adr` respectively. No bookmarks break; existing detail routes (`adr-reports/:reportId/detail`) stay live.

### Sidebar mapping

Replace the two-item "Intelligence" group with a six-item group (labels below; icons per `docs/design/ICONS.md`, lucide):

```
Intelligence & Reporting
├── Financial Reports            (icon: Wallet / BarChart)
├── Operational Reports          (icon: Boxes / Package)
├── Client & Sales Analytics     (icon: Users)
├── Pharmacovigilance (ADR)      (icon: Shield / AlertTriangle)
├── Compliance & Audit           (icon: FileCheck)
└── Scheduled Reports            (icon: CalendarClock)
```

Naming rules: never bare "Reports"; every item states its domain so a pharmacist recognizes their own job (Principle: consistency + discoverability beat cleverness).

### Tab taxonomy & contents

| Tab | Data | Default export | Default period |
|---|---|---|---|
| **Financial** | Sales, expenses, purchases, VAT | NAFDAC/FIRS-compliant CSV | Month |
| **Operational** | Inventory turnover, stockouts, low stock, expiry, purchasing | Stockout alert CSV | Week |
| **Client & Sales** | Repeat clients, retention by location, top items, revenue per branch | Client retention CSV | Month |
| **ADR** | Status mix, seriousness, deadline compliance, history | E2B XML (industry standard) | Month |
| **Compliance** | ADR submission status, prescription audit, controlled substances | PCN register export | Quarter |
| **Scheduled** | Schedule list, next/last run, logs, pause/resume | — (manager of deliveries) | — |

### Role-aware default tab

`getNavGroups` in `permissions.js` already filters by role. The hub additionally computes the **default tab** from role + business type: Pharmacist → ADR; Owner → Financial; Hospital Manager → Operational; Chain Manager → Financial (All Locations). The default is a fallback — the explicit URL tab always wins.

---

## 3. Voice and Tone

### Personality
**Clinical, authoritative, calm.** This is software for professionals who answer to regulators. Never playful, never apologetic, never alarmist.

### Microcopy rules
- **Deadlines** state the requirement plainly: "ADR due within 24 hours." Overdue: "ADR-2026-0817-034 overdue by 3h." Not "Oops, you missed it!"
- **Status** uses regulatory vocabulary: Submitted / Pending / Due soon / Overdue / Exported / Paused / Failed. No invented whimsy ("Nice!", "On track! 🎉").
- **Errors** carry a reference ID and a next action: "Delivery failed (log #SCH-1042). Review the log or retry." Never a bare "Something went wrong."
- **Empty states** explain consequence: "No ADR reports this period. Deadlines apply once a report is created."
- **Numbers** are shown raw and precise; rounding is labeled. A KPI is "₦4,582,110" not "4.6m" unless explicitly labeled "≈".

### Do / Don't
- Do say "Scheduled for the 1st at 08:00 (Africa/Lagos)."
- Don't say "Your reports are coming soon!" — schedules show real next-run time or they show nothing.

---

## 4. Component Patterns

Reused units of behavior across all tabs. Visual spec in `DESIGN.md` (Components section); these are the interaction contracts.

### ReportsHub
The tabbed shell. Owns the context bar (period selector, branch selector, Export). Renders `{components.report-tab}` for each accessible tab; active tab is `{components.report-tab-active}`. URL-syncs tab state; unknown tab slug → 404 page with link back to default tab. *(Mock: `mockups/key-financial-hub.html` — Financial default tab at rest.)*

### ContextBar
Global to the hub (persists across tab switches within a session, restored on return). Contains: **Period selector** (This month / Last month / This quarter / Custom range), **Branch selector** (multi-select pills; "All locations" = rollup, persisted in localStorage), **Export button** (exports the *active tab's* current filtered dataset — format per tab taxonomy).

### KPIStrip
Row of up to 4 `{components.kpi-card}`. Each card: label → mono value → delta line (▲/▼ with % vs previous period) → semantic accent bar. Click/Enter on a card drills into the underlying list filtered to that KPI's meaning. On mobile: 1-up stack; tablet: 2-up.

### ReportDataTable
The tab's primary table. Header sticky within its container; numeric columns right-aligned in mono; rows hover with teal-mist tint; row click (where meaningful) opens the detail. Status is always a **pill column** (icon + text + color), never color alone. Container scrolls horizontally on tablet; full-width on desktop.

### ScheduleCard
Unit of the Scheduled tab (`{components.schedule-card}`). Toggle (optimistic UI), Edit (opens ScheduleEditor), Delete (confirm dialog — deleting a schedule is irreversible, Principle 9), Logs (opens delivery log). Status pill: Active / Paused / Failed (last delivery). *(Mock: `mockups/key-scheduled.html` — four cards incl. Failed state + delivery-error banner.)*

### ScheduleEditor
Modal (elevation 3) form: template picker → frequency (Daily 07:00 / Weekly Mon 07:00 / Monthly 1st 08:00 / Quarterly) → timezone (default Africa/Lagos) → recipients (Owner, Manager, Pharmacist, external accountant email list) → format (CSV/PDF) → test-send button. Progressive disclosure: template picker shows the common path; "Advanced" reveals custom cron-like fields.

### ReportBuilder
Full-screen flow (owner/manager only). Three-pane: left data-source tree → center canvas (report name, KPI/table blocks) → right properties panel. "Save as template" → My Templates. Guarded: RBAC check + confirm before save.

### ComplianceBadge
Read-only pill, per `DESIGN.md`. Always carries a micro mono reference ID. Clickable only when detail exists; when clickable it navigates to the record — never to a dead end. Overdue always links to the record.

---

## 5. State Patterns

Every screen ships all four states before code review (Principle 5). Skeletons mirror final layout; errors carry a retry + reference ID.

### Loading
- **Tabs/KPI**: KPI cards show skeleton blocks (mono-sized placeholders), tables show 6-row skeleton rows. Never a full-page spinner for tab content.
- **Scheduled**: ScheduleCards render skeletons; toggles disabled until hydrated.
- **Builder**: left/center panes skeleton; properties panel renders static.

### Empty
- **KPI**: a KPI with no data shows "—" and the card remains clickable-to-empty-its-own-empty-state (explaining the metric). Never 0-decorative.
- **Table**: `{components.empty-state}` with icon, explanation, one primary action (e.g. "Create first report"). Copy per Voice rules.
- **Scheduled**: empty-state + "Create your first schedule" primary action.

### Error
- **Load failed**: inline error panel in the affected region (not a toast) with Retry and a reference ID.
- **Export failed**: toast with reference ID; partial files are never presented as complete.
- **Delivery failed**: ScheduleCard flips to Failed pill; Logs is one click; retry is explicit.
- **Auth/RBAC denied**: not an error toast — a permission-empty-state ("Your role has no access to this report. Contact your administrator."), preserving the security boundary.

### Period / branch context
- Period and branch selection are **global context** — switching tabs preserves them; refresh restores period and "All locations" rollup branch from URL/localStorage. Never silently reset on tab switch.

### Scheduled report delivery lifecycle
Draft → Active (toggle on) → Running (transient) → Delivered / Failed. Each state persists in the schedule record and is surfaced in the pill + next/last run line. Toggle is optimistic; server sync failure reverts the toggle and toasts with a reference ID.

---

## 6. Interaction Primitives

Consistent low-level behaviors, applied identically on every tab.

- **Tab navigation**: tabs are real links — middle-click/⌘-click open new tab; browser back restores the previous tab; `aria-current="page"`. Keyboard: ←/→ arrows move between tabs when focus is in the tab strip.
- **KPI drill-down**: card is one focusable unit; Enter/Space activates the drill-down (same as click). Drill target is per-KPI: e.g. "3 critical stockouts" → Operational table pre-filtered to stockout status.
- **Table row actions**: primary row action via row click; secondary actions (Export row, View) appear on row hover at desktop, always visible in a trailing "⋮" menu on tablet/mobile (progressive disclosure).
- **Period selection**: dropdown with presets + custom range; applying it re-fetches the active tab's data with the table and KPIs animated at `{motion.base}` (200ms) — never a flash of empty.
- **Branch multi-select**: pill toggles; "All locations" acts as select-all/rollup; selection persists in localStorage.
- **Export**: one click exports the active tab's current filters; a toast confirms with file name + reference ID; large exports show inline progress (percent + row count), never a silent hang.
- **Undo**: toggles and non-destructive changes are undoable (toast + Undo). Destructive ops (delete schedule, delete report) use confirm dialogs with the reference ID.
- **Focus management**: after schedule save/delete, focus returns to the originating control or the first ScheduleCard; never to `<body>`. Modal opens trap focus, closes on Esc, restores focus to the trigger.

---

## 7. Accessibility Floor

WCAG 2.2 AA is a design constraint, not a pass (Principle 10). `docs/design/ACCESSIBILITY.md` applies; additions specific to this surface:

- **Contrast**: all semantic accent-on-surface pairs meet 4.5:1 (verified against `{colors.*}` pairs in `DESIGN.md`); mono micro text on neutrals meets AA.
- **Color is never the only signal**: every status (ADR overdue, stockout, schedule failure) = icon + text + color. A color-blind pharmacist still sees "Overdue · 3h late".
- **Keyboard**: full tab/table/schedule/editor traversal without a mouse; visible focus ring (`2px` primary offset outline) on every focusable element; skip-to-content link.
- **Screen readers**: tab list uses `role="tablist"` with correct `aria-selected`; tables use real `<th scope="col">`; KPIs read as "label, value, delta"; schedule toggles are labeled checkboxes with text states ("Active", "Paused").
- **Target size**: touch targets ≥ 40px on tablet/mobile (matches `{components.primary-button}` height scale); toggles are 44px hit areas regardless of visual size.
- **Motion**: reduced-motion respects `prefers-reduced-motion` — skeletons become static blocks, transitions drop to `{motion.instant}` (0ms).
- **Time pressure**: the 24h ADR window is **never** communicated by color alone; the compliance surface always shows a concrete deadline ("Due 17:00 today") so urgency is decipherable without color.

---

## 8. Key Flows

### 8.1 Amara schedules her monthly reports (owner, desktop)
1. Opens the hub → Financial tab is default. Context bar shows "Last month · All locations".
2. Clicks **Scheduled Reports** tab → empty-state: "No schedules yet." → primary action "Create your first schedule".
3. ScheduleEditor: picks template "Monthly P&L + ADR Summary", frequency "Monthly · 1st at 08:00", timezone Africa/Lagos, recipient = her email.
4. Clicks **Send test** → toast: "Test sent · ref #SCH-1001" → she verifies the inbox.
5. Clicks **Save** → optimistic toggle Active; card shows "Next run: 1 Aug 08:00 (Africa/Lagos)".
6. At audit time she opens Compliance tab → **Export** → NAFDAC CSV downloads with reference ID logged.

### 8.2 Dr. Okafor reacts to critical stockouts (hospital manager, desktop)
1. Default tab Operational. KPIStrip shows a **red** "3 critical stockouts" KPI (icon ⚠ + text "Critical").
2. Clicks the KPI → Operational table pre-filtered to stockout rows.
3. Row action "Create purchase order" → prefilled order opens in Inventory module (same business, cross-module navigation preserved).

### 8.3 Chidi reviews consolidated performance (chain manager, desktop)
1. Context bar branch selector set to "All locations" (persisted).
2. Financial tab shows rollup P&L; a per-branch column table lets him compare.
3. He drills into the underperforming branch via the branch selector → single-branch view, same tab.

### 8.4 Pharmacist files an ADR within the window (counter, tablet)
1. Mobile/tablet tab row → **Pharmacovigilance (ADR)** → KPI shows "1 due today" amber.
2. Opens the report form (existing `formEngine` flow, unchanged mechanics), submits → badge flips to **Submitted** (blue, reference ID ADR-2026-0817-034).
3. Compliance tab now shows the submission with its PCN/NAFDAC status. *(Mock: `mockups/key-adr-tablet.html` — due-today KPI + deadline shown as text, never color alone.)*

### 8.5 Handling a failed schedule delivery (owner, mobile)
1. Scheduled tab shows ScheduleCard with **Failed** pill (red) + log ref.
2. Opens **Logs** → sees delivery error with timestamp → **Retry** → card flips Active, next run recalculated.
3. If a schedule is permanently broken, **Delete** → confirm dialog states the reference ID and that this cannot be undone.

---

## Conventions

- URLs are lowercase kebab-case; tab slugs match sidebar labels for traceability.
- Export formats per tab taxonomy; every export and schedule delivery writes to the 7-year audit log with a reference ID.
- All date/times default to Africa/Lagos unless a business timezone is configured.
- New report categories are added as tabs only when they earn a distinct KPI strip + table; otherwise they are a filter within an existing tab.