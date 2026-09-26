---
name: CareHub Reports Hub
description: Visual identity for the CareHub Intelligence & Reporting surface — extends the Care Ecosystem unified design system (packages/design-system/src/theme.js) for a regulated healthcare market.
status: final
updated: 2026-08-18
colors:
  primary: "#0E6F5A"
  primary-strong: "#0B4A3E"
  on-primary: "#FFFFFF"
  accent-submitted: "#2563EB"
  accent-attention: "#D97706"
  accent-risk: "#DC2626"
  neutral-bg: "#F7F5EF"
  neutral-surface: "#FBFAF6"
  neutral-border: "#ECEAE0"
  neutral-hairline: "#E7E4D9"
  text-primary: "#182722"
  text-secondary: "#3C4B44"
  text-tertiary: "#8B978F"
  text-disabled: "#9AA69F"
  teal-mist: "#E3EEE8"
  success-surface: "#F0FDF4"
  warning-surface: "#FFFBEB"
  danger-surface: "#FEF2F2"
  info-surface: "#EFF6FF"
typography:
  page-title:
    fontFamily: Geist
    fontSize: 21px
    fontWeight: 900
    lineHeight: 1.25
    letterSpacing: -0.02em
  section-title:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: 800
    lineHeight: 1.3
    letterSpacing: -0.015em
  card-title:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: 800
    lineHeight: 1.35
    letterSpacing: -0.01em
  body:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.5
  body-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontFamily: Geist
    fontSize: 11px
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: 0.02em
  micro:
    fontFamily: Geist Mono
    fontSize: 10.5px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: 0.04em
  kpi-value:
    fontFamily: Geist Mono
    fontSize: 24px
    fontWeight: 900
    lineHeight: 1.2
    letterSpacing: -0.02em
rounded:
  sm: 6px
  md: 10px
  lg: 14px
  xl: 20px
  full: 9999px
spacing:
  1: 2px
  2: 4px
  3: 6px
  4: 8px
  5: 10px
  6: 12px
  7: 14px
  8: 16px
  9: 18px
  10: 20px
  11: 24px
  12: 32px
components:
  report-tab:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: 10px
  report-tab-active:
    backgroundColor: "{colors.teal-mist}"
    textColor: "{colors.primary-strong}"
  kpi-card:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: 16px
  kpi-accent-teal:
    backgroundColor: "{colors.primary}"
  kpi-accent-attention:
    backgroundColor: "{colors.accent-attention}"
  kpi-accent-risk:
    backgroundColor: "{colors.accent-risk}"
  kpi-accent-submitted:
    backgroundColor: "{colors.accent-submitted}"
  data-table:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
  table-header:
    textColor: "{colors.text-secondary}"
    typography: "{typography.caption}"
  schedule-card:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: 12px
  schedule-card-status-active:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.primary-strong}"
  schedule-card-status-paused:
    backgroundColor: "{colors.warning-surface}"
    textColor: "{colors.text-secondary}"
  schedule-card-status-failed:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.accent-risk}"
  compliance-badge-submitted:
    backgroundColor: "{colors.info-surface}"
    textColor: "{colors.accent-submitted}"
  compliance-badge-overdue:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.accent-risk}"
  compliance-badge-due-soon:
    backgroundColor: "{colors.warning-surface}"
    textColor: "{colors.accent-attention}"
  empty-state:
    textColor: "{colors.text-tertiary}"
    rounded: "{rounded.lg}"
  primary-button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
    padding: 10px
  primary-button-hover:
    backgroundColor: "{colors.primary-strong}"
  secondary-button:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: 10px
---

# CareHub Reports Hub — DESIGN.md

## Overview

The Reports Hub is the intelligence layer of CareHub — the operating system for pharmacies, hospitals, clinics and laboratories in a **regulated African healthcare market** (NAFDAC, PCN, FIRS). Its users are professionals doing skilled work under deadline pressure: a pharmacist filing an ADR before the 24-hour window closes, an administrator closing month-end books, a chain manager reviewing consolidated P&L across five locations.

This spine extends the Care Ecosystem unified design system (single source of truth: `packages/design-system/src/theme.js`, documented in `docs/design/`). It does **not** replace it. Every token below resolves to an existing canonical value or a documented semantic extension. The guiding quality bar is that of `docs/design/DESIGN_VISION.md`: *restraint over decoration, speed as a feature, confidence without arrogance* — with the added constraint that every screen in this surface must read as trustworthy enough for regulatory scrutiny.

### Brand & Style

- **Voice in pixels**: calm competence, like a cockpit — dense but organized, teal as functional accent against a neutral, data-forward UI. Never sterile blue-and-white, never anxious emergency-room red. Never "templated AI dashboard."
- **Identity of its own**: deep teal + navy on a warm limestone base (`#F7F5EF`). The warmth is deliberate — healthcare software that feels like a spreadsheet erodes trust, even among professionals.
- **Semantic discipline** (Principle 2 — *color is meaning, not decoration*): saturated color is reserved for a closed set of meanings. No decorative gradients on operational surfaces. See Colors.

## Colors

The palette extends the unified system. Three accent families carry all meaning on this surface; neutrals carry the structure.

### Neutrals (warm limestone base)

- **Neutral background `{colors.neutral-bg}`** (#F7F5EF): page background, warm enough to avoid clinical sterility.
- **Neutral surface `{colors.neutral-surface}`** (#FBFAF6): cards, tables, schedule panels, tab rails.
- **Neutral border `{colors.neutral-border}`** (#ECEAE0): default borders, dividers, inputs.
- **Neutral hairline `{colors.neutral-hairline}`** (#E7E4D9): subtle separators inside dense tables.
- **Text primary `{colors.text-primary}`** (#182722): headings, KPI values, table cell text.
- **Text secondary `{colors.text-secondary}`** (#3C4B44): labels, helpers, table headers.
- **Text tertiary `{colors.text-tertiary}`** (#8B978F): muted notes, empty-state copy.
- **Text disabled `{colors.text-disabled}`** (#9AA69F): placeholders, disabled toggles.

### Brand (functional accent, never decoration)

- **Primary `{colors.primary}`** (#0E6F5A): the one interaction color — primary buttons, active tabs, active nav.
- **Primary strong `{colors.primary-strong}`** (#0B4A3E): hover/emphasis, selected-tab text.
- **On primary `{colors.on-primary}`** (#FFFFFF): text on primary fills.
- **Teal mist `{colors.teal-mist}`** (#E3EEE8): teal-tinted surface for selected rows and the active tab.

### Semantics (the closed meaning set for this surface)

| Accent | Token | Value | Meaning on this surface |
|---|---|---|---|
| **Operational / safe** | `{colors.primary}` / success surface | #0E6F5A / #F0FDF4 | KPIs and tables in good standing; active schedules |
| **Attention / pending** | `{colors.accent-attention}` | #D97706 | Due-soon compliance deadlines, paused schedules, low stock |
| **Risk / overdue** | `{colors.accent-risk}` | #DC2626 | Overdue ADR windows, failed schedule deliveries, stockouts |
| **Submitted / regulatory** | `{colors.accent-submitted}` | #2563EB | Submitted to regulator — neutral, factual, "filed" state |

Each semantic accent ships with a matching surface tint (`success-surface`, `warning-surface`, `danger-surface`, `info-surface`) for badges and pill backgrounds. **Never** pair a semantic color with itself; always use accent-on-surface.

## Typography

Type does the hierarchy work (Principle 1). One family (`Geist`) carries nearly everything; `Geist Mono` is reserved for two honest uses: **KPI values** (numbers that are read, compared, audited) and **micro footnotes** (timestamps, reference IDs). This is where the surface earns its "Stripe-grade precision" feel — correct scale, weight and letter-spacing, not boxes and shadows.

- **Page title `{typography.page-title}`** (21px/900): hub page titles — "Financial Reports", "Scheduled Reports".
- **Section title `{typography.section-title}`** (18px/800): section headers within a tab.
- **Card title `{typography.card-title}`** (15px/800): schedule card titles, KPI card labels.
- **Body `{typography.body}`** (13px/500): default text, table cells.
- **Body sm `{typography.body-sm}`** (12px/600): metadata, secondary table columns.
- **Caption `{typography.caption}`** (11px/700, +0.02em): table headers, pills, timestamps.
- **Micro `{typography.micro}`** (10.5px/700 mono, +0.04em): reference IDs, file hashes, dense table footnotes.
- **KPI value `{typography.kpi-value}`** (24px/900 mono): the number itself — set in mono so a column of KPIs aligns and reads as data, not decoration.

Rules: never letter-space body text; never set an entire table in mono; KPI values only on KPI cards. Error messages never use micro — they must stay readable at `body-sm` minimum.

## Layout

The hub is a **tabbed master-detail** surface on the CareHub desktop canvas (1440px+), collapsing through tablet (768–1023) to mobile (<768) as documented in `docs/design/RESPONSIVENESS.md`. Layout follows the GitHub principle — one consistent page template reused across all six tabs so that learning one tab teaches all six.

### Desktop (default)
- **Sticky tab bar** under the page header: six tabs (Financial, Operational, Client & Sales, ADR, Compliance, Scheduled). Tab state lives in the URL (`/dashboard/reports/financial`) so deep links and browser back work.
- **Context bar** (right of tabs): global period selector + branch selector + "Export" — the same position on every tab, per the Figma principle of fixed, predictable control placement.
- **Content region**: KPI row (up to 4 cards) → data table → optional secondary panel. Density is earned by hierarchy: a trained user finds anything in <2s.

### Tablet (768–1023)
- Tab bar wraps to a horizontal scroll row; KPI cards drop to 2-up grid; tables keep working (horizontal scroll on the container, not the page).

### Mobile (<768)
- Different job, not a shrunk desktop (Principle 11): tabs become a horizontal scroll row; KPI cards stack 1-up; tables give way to **summary cards** with a "View details" row → full table screen. Primary actions (New Report, Schedule) stay pinned at bottom of viewport as a floating action region.

## Elevation & Depth

Elevation is earned, never decorative (IBM Carbon stance adopted in `docs/design/ELEVATION.md`). Hierarchy comes from typography first; shadow only separates layered surfaces.

- **Resting**: cards, tables, schedule panels sit flat at elevation 1 (`0 1px 4px rgba(15,23,42,0.05)`).
- **Interactive**: hovered cards / raised menus at elevation 2.
- **Overlay**: modals (schedule editor, report builder) at elevation 3; full-screen critical flows at elevation 4.
- **Never**: elevated KPI cards. The number and its accent carry the hierarchy — a shadow on every card is how templates read as "AI-generated."

## Shapes

Corner language is soft-but-own (not Material's heavy fill, not Carbon's sharp square). Defined in `{spacing}`/radius scale:

- **Rounded sm `{rounded.sm}`** (6px): buttons, inputs, badges, pills.
- **Rounded md `{rounded.md}`** (10px): tables, schedule cards, tab rail container.
- **Rounded lg `{rounded.lg}`** (14px): KPI cards, empty-state panels, sheets.
- **Rounded xl `{rounded.xl}`** (20px): hero moments, full-screen sheet headers.
- **Rounded full** (9999px): status dots, toggle switches, avatars.

The single most common shape — the card/panel — is `md` (10px). KPI cards are the one deliberate `lg` for separation from the tables below.

## Components

### ReportTab
The tab strip. Inactive: surface fill, secondary text. **Active `{components.report-tab-active}`**: teal-mist fill + primary-strong text, with a 2px primary underline — the one place teal signals "you are here." Icons at `md` (20px) beside each label.

### KPICard
Surface card, `lg` radius, 16px padding. Anatomy: caption label (body-sm, secondary) → **mono value** (kpi-value) → optional delta line → 3px accent bar on the left edge. The accent bar is the semantic color (teal/amber/red/blue) — the number stays neutral so the accent reads as meaning, not decoration.

### DataTable
Surface panel, `md` radius. Header row: caption, secondary text, sticky on scroll. Cells: body text; numeric columns right-aligned with mono values; row hover = teal-mist tint. Semantic states live in a dedicated **Status pill** column (never color alone — always icon + text, per `theme.js` healthcare semantics). Zebra striping only inside ADR detail tables (dense compliance data), never on top-level tables. Container scrolls horizontally on tablet.

### ScheduleCard
The unit of the Scheduled Reports tab. Anatomy: title (card-title) + status pill (top row) → schedule line ("Monthly · 1st at 08:00 Africa/Lagos") → next-run + last-run timestamps (caption, mono time) → toggle + edit + delete + logs actions. Status pills: **Active** (success surface/primary text), **Paused** (warning surface), **Failed** (danger surface, always with a reference to the delivery log).

### ComplianceBadge
Read-only regulatory status: **Submitted** (info surface, blue), **Due soon** (warning surface, amber), **Overdue** (danger surface, red). Each carries a micro reference ID (e.g. ADR-2026-0817-034). Used in ADR and Compliance tabs.

### EmptyState
First-run / no-data state, per Polaris actionable-empty-state principle. Anatomy: teal icon (40px), title (card-title, primary text), body line (body-sm, tertiary text), one primary action. Copy is specific and regulatory-aware: "No ADR reports this period. Deadlines only apply once a report is created." Never decorative.

### PrimaryButton / SecondaryButton
Primary: teal fill, white text, `sm` radius, height 40/44/48 per scale. **One primary action per screen** (Principle 3) — on each tab, exactly one. Secondary: surface fill, primary text, border, used for Export/New/Schedule actions that aren't the tab's primary. Destructive actions are `accent-risk` text on a danger-surface button, never a big red fill unless the action is irreversible (delete a schedule).

## Do's and Don'ts

**Do**
- Do let typography and spacing carry hierarchy; color and shadow only reinforce it.
- Do keep saturated color inside the closed semantic set — if a color has no meaning here, it doesn't belong on this surface.
- Do put reference IDs in micro mono so audits can trace every row, every export, every schedule.
- Do make every tab deep-linkable and every status pill icon+text, never color alone.
- Do design the loading, empty and error states for every screen before the happy path ships (Principle 5).
- Do preserve existing URLs (`/dashboard/reports`, `/dashboard/adr-reports`) via redirects during rollout.

**Don't**
- Don't use marketing gradients, purple accents, or decorative hero illustrations on any operational surface.
- Don't put a shadow on every card — KPI cards stay flat; elevation is earned by layering, not habit.
- Don't set an entire table in mono, or letter-space body text.
- Don't overload one screen with two primary actions; if two things are both primary, the screen is doing two jobs.
- Don't make ComplianceBadge or status pills the only indicator of a problem — always pair color with icon and text.
- Don't silently "grow" the palette; any new semantic color must be proposed in this document first.