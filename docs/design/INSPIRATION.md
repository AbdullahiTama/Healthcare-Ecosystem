# Inspiration

`DESIGN_PRINCIPLES.md` documents *what to adopt and what to avoid* from each reference product, organized by principle. This document is organized differently: by **which specific screen or interaction to look at** when you're stuck on a concrete design problem, and **which of our own screen patterns it maps to**. Use `DESIGN_PRINCIPLES.md` to understand why something works; use this document to know where to go look when you need a concrete reference point.

As stated throughout this system: extract principles, never copy visuals, copy, or brand assets. Nothing here is a license to replicate a specific product's UI — it's a pointer to a specific *idea* worth studying.

---

## When you're designing a dashboard → look at Linear + Stripe

- **Linear's** issue-list-plus-cycle-view balances density with calm — worth studying for how it avoids the generic-dashboard trap: nothing on screen is decorative, every panel answers a specific question.
- **Stripe's** payments dashboard shows how a KPI-plus-chart pairing states a conclusion before asking the user to interpret a graph themselves — directly relevant to `SCREEN_PATTERNS.md` pattern 5 (Dashboard) and pattern 22 (Analytics).
- Maps to: Dashboard, Analytics.

## When you're designing a data table → look at Linear + Notion + Carbon

- **Linear's** table density (compact rows, hover-revealed actions, no unnecessary chrome) is the reference for CareHub's high-density admin tables.
- **Notion's** table-to-card view toggle is a useful mental model for *why* a table becomes a card list on mobile — it's a legitimate alternate view of the same data, not a degraded one.
- **IBM Carbon's** data-table spec (documented, not just observed) is the most rigorous public reference for column-hiding, batch actions, and inline-edit patterns at enterprise scale.
- Maps to: List/Table Page, Inventory, Pharmacy, Laboratory, Billing.

## When you're designing a form → look at Stripe + Linear

- **Stripe's** checkout and account-settings forms are the reference for validation timing, inline error placement, and smart defaults — study how errors appear without ever making the form feel like it's scolding the user.
- **Linear's** issue-creation modal is a reference for progressive disclosure in a compact create flow (title/description visible immediately, everything else behind "more options").
- Maps to: Create Form, Edit Form, Multi-Step Wizard.

## When you're designing a command palette or keyboard-first flow → look at Linear + GitHub

- **Linear's** `⌘K` is the direct reference for `SCREEN_PATTERNS.md` pattern 12 (Global Search) — grouped results, fuzzy match, actions mixed with data.
- **GitHub's** keyboard shortcut system (`?` for a shortcut overlay, single-letter shortcuts for common actions) is the reference for `NAVIGATION.md`'s discoverability rule.
- Maps to: Global Search, Navigation (command palette).

## When you're designing empty/loading/error states → look at Notion + Slack

- **Notion's** empty states (a new database, a new page) consistently pair a short honest sentence with one clear action — never over-illustrated, never guilt-tripping.
- **Slack's** "you're all caught up" empty state is the reference for `SCREEN_PATTERNS.md` pattern 30's "genuinely, positively empty" case — treating an empty state as good news when it is good news.
- Maps to: Empty State, Loading State, Error State.

## When you're designing verification/trust signals → look at Airbnb-style marketplaces + Slack's verified badges (via Atlassian/Slack enterprise trust patterns)

- The core lesson (documented in `DESIGN_PRINCIPLES.md` Principle 12) is that trust indicators must be inseparable from identity — sit directly next to the name, not demoted to a small icon elsewhere.
- Maps to: Provider Profile, Search Results (verification badge on result cards).

## When you're designing a booking / scheduling flow → look at Calendly-style scheduling UX (as referenced via Google Calendar's "suggest time" pattern) and Apple's Calendar app on iOS

- The lesson: show the full schedule (including unavailable slots, visibly disabled) rather than only showing what's available — a schedule that only shows options feels arbitrary; one that shows the whole picture feels trustworthy.
- Maps to: Appointment Workflow.

## When you're designing role-based navigation → look at Atlassian (Jira's per-project-type navigation) and Salesforce-style enterprise app switching

- The lesson: navigation that adapts to the *type* of work being done (a Jira software project's nav differs from a service-desk project's nav) rather than showing every possible module to every user is exactly CareHub's `getNavItems(role, businessType)` pattern, validated at enterprise scale elsewhere.
- Maps to: Navigation (CareHub sidebar).

## When you're designing for low-connectivity / mobile-first contexts → look at Google's "Lite" product family design philosophy (e.g., the design lessons behind YouTube Go / Search Lite — referenced conceptually, not visually) and WhatsApp's resilience under poor networks

- The lesson: progressive loading, aggressive skeleton use, and never blocking the whole UI behind one slow request — directly informs `RESPONSIVENESS.md`'s CareFind mobile-first strategy and `MOTION.md`'s loading-state rules.
- Maps to: Loading State, CareFind's overall responsive strategy.

## When you're designing status/badge systems → look at GitHub's PR/Issue state labels and Linear's issue-status pills

- Both use a small, closed set of consistently-colored, text-paired pills rather than an open-ended, ad hoc color system — the direct reference for `COLORS.md`'s semantic palette and `COMPONENT_LIBRARY.md`'s Status Indicators & Badges component.
- Maps to: Status Indicators & Badges (used throughout Patient Profile, Inventory, Billing, Laboratory).

## When you're designing accessibility-first interaction → look at Apple's Human Interface Guidelines and IBM Carbon's accessibility documentation

- Apple HIG's touch-target and clarity guidance, and Carbon's rigorously documented WCAG compliance per component, are the two most complete public references behind `ACCESSIBILITY.md`.
- Maps to: every pattern — accessibility is cross-cutting, not screen-specific.

## When you're designing onboarding for an anxious, first-time user → look at Notion's and Figma's first-run experiences

- Both introduce complexity gradually — a near-empty canvas with one clear first action, not a feature tour dumped on the user before they've done anything. Relevant to CareFind's first-time patient experience specifically, where anxiety (someone searching for care, possibly urgently) is a real design constraint, not a hypothetical persona note.
- Maps to: Search Results, Global Search, Empty State (first-run case).

---

## A note on healthcare-specific references (Epic, Cerner, Athenahealth)

These are referenced throughout `DESIGN_PRINCIPLES.md` primarily as **cautionary** references — dense, clinically necessary information architectures that succeed functionally but are broadly regarded, including within clinical UX literature, as difficult to learn and visually dated. The one thing worth adopting from them is genuine: an acknowledgment that clinical data density is sometimes real and necessary (a lab result panel, a medication list, cannot always be simplified away). The lesson for the Care Ecosystem is to earn density the way Linear does — through clear typographic hierarchy and spacing — rather than earning it the way legacy EHR systems do, through cramped, undifferentiated grids. See `DESIGN_PRINCIPLES.md` Principle 4 ("Density is earned, not avoided") for the full treatment.

## How to keep this document honest

Every entry above names a specific, verifiable product behavior, not a vague "clean and modern" gesture. When adding a new entry: name the specific screen or flow, state the one lesson it teaches, and map it to a specific pattern in `SCREEN_PATTERNS.md`. An inspiration entry that can't be mapped to an actual pattern in this system isn't actionable — it's decoration for this document, which is exactly what the rest of the system exists to avoid.
