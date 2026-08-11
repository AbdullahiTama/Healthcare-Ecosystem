# 03 — Folder Structure

## Workspace Root

```
HealthCare-Ecosystem/                 (not itself a git repository)
├── docs/
│   ├── PROJECT_OVERVIEW.md, PROJECT_ONBOARDING.md, SESSION_WORKFLOW.md   (real, thin)
│   ├── ENGINEERING_ONBOARDING_REPORT.md                                  (produced this engagement)
│   ├── ENGINEERING_OPERATING_SYSTEM.md                                   (real content — engineering philosophy)
│   ├── Business Domains.md, Engineering Bible.md, PRD.md                 (EMPTY)
│   ├── CARE_ECOSYSTEM_OPERATING_MANUAL/                                  (mostly EMPTY — see below)
│   └── discovery/                                                        (this document set)
├── knowledge/
│   ├── business/, glossary/, workflows/       (real content — vision/principles/glossary)
│   └── modules/                                (38 per-domain files, produced this engagement)
├── planning/          roadmap.md (real), CODE_AUDIT.md (empty checklist)
├── architecture/       15 documents, produced this engagement — the deep-dive reference set
├── decisions/          empty — no ADRs
├── prompts/, templates/, .claude/
└── apps/
    ├── carehub/                        own nested .git, remote: github.com/AbdullahiTama/skincarepro
    │   └── src/{pages,components,lib}
    └── carefind/carefind-main/          no .git repo found within this workspace
        └── src/                          flat — ~48 files, no pages/ or components/ subfolder
```

## `docs/CARE_ECOSYSTEM_OPERATING_MANUAL/` — Detailed Breakdown

This tree looks comprehensive from its folder structure alone (Executive summaries, per-domain deep-dives, a full software-architecture book, an operating-system constitution). **20 of its `.md` files are 0 bytes.** Only these have real content:

| File | Bytes | Nature |
|---|---|---|
| `OPERATING_SYSTEM/00-CONSTITUTION.md` | 1,826 | Pure philosophy/mission statement, no technical content |
| `BOOK-02-SOFTWARE/00-System-Architecture.md` | 2,273 | Aspirational 5-layer architecture, does not match implementation |
| `BOOK-02-SOFTWARE/01-Ecosystem-Architecture.md` | 2,918 | Not read in full this pass |
| `00-Executive/00-Executive-Summary.md` | 4,053 | Not read in full this pass |
| `00-Executive/00-Business-Domain-Model.md` | 5,869 | Business-language glossary (Organisation, Branch, Patient, Batch, Invoice, Subscription, etc.) — useful vocabulary, not an implementation description |
| `00-Executive/01-Vision-and-Mission.md` | 5,056 | Not read in full this pass |
| `00-Executive/02-Product-Principles-and-Engineering-Philosophy.md` | 5,305 | Not read in full this pass |
| `02-Domains/00-Domain-Map.md` | 533 | ASCII diagram of intended domain relationships |
| `02-Domains/00-Domain-Driven-Architecture.md` | 2,956 | Not read in full this pass |
| `02-Domains/01-Identity-Domain.md` | 4,129 | The only domain doc with real content — **self-admits "Current State: (Custom Authentication — update after code audit)"** |
| `02-Domains/02-Organisation-Domain.md` | 4,284 | Not read in full this pass |
| `03-Language/00-Ubiquitous-Language.md` | 4,791 | Not read in full this pass |
| `03-Workflows/00-Healthcare-Workflow-Model.md` | 2,958 | Not read in full this pass |

**Empty (0 bytes):** all 10 remaining domain docs (`03` through `12` — Patient-Care, Inventory, Clinical, Laboratory, Imaging, Finance, Marketplace, Notification, Reporting, Shared-Platform), and all of `BOOK-02-SOFTWARE/02` through `09` (Repository, Frontend, Backend, Database, Service, State Management, Security, Deployment Architecture).

**Practical implication:** if you need to know how authentication, the database, or any specific domain actually works, this manual will not tell you — use `docs/discovery/`, `architecture/`, and `knowledge/modules/` instead, all three of which were built by reading source code directly.

## CareHub Internal Structure

```
apps/carehub/src/
├── pages/
│   ├── auth/            Login.jsx, Register.jsx
│   ├── admin/            AdminDashboard.jsx
│   └── dashboard/
│       ├── (~20 flat page files: Inventory, POS, Clients, Staff, Reports, ...)
│       └── hospital/     Reception, Triage, Doctor, RxInbox, Lab, Imaging
├── components/
│   ├── ui/index.jsx      the app's only shared UI kit (19 exports)
│   └── layout/            Sidebar, TopBar, NotificationBell
└── lib/                   supabase.js, permissions.js, utils.js, email.js, realtime.js
```

`hospital/` is the only business-type vertical with its own subfolder — the enterprise (manufacturer/wholesale) vertical's six pages (`Warehouses.jsx`, `Territories.jsx`, `Messages.jsx`, `Stock.jsx`, `Orders.jsx`, `LiveActivity.jsx`) sit flat alongside the generic pages, and are further distinguished by a visibly different code style (`function(e){}` throughout instead of arrow functions, a hand-built bottom-sheet modal system instead of the shared `Modal`) — strong evidence of a different author/era than the retail/hospital pages, never reconciled.

## CareFind Internal Structure

```
apps/carefind/carefind-main/src/
├── (~45 flat top-level .jsx/.js files, no pages/ or components/ subfolder)
├── lib/                   supabaseClient.js, AuthContext.jsx, reviewAI.js, sentiment.js,
│                          activeIdentity.js, theme.js, articleFormat.js
└── api/                   admin-auth.js, admin-setup.js, initiate-payment.js (Vercel functions)
    (paystack-webhook.js sits at the project ROOT, not inside api/ — see 07-api.md)
```

No subfolder structure at all despite being the larger of the two codebases by line count (~15,400 lines vs. CareHub's smaller total). No shared component library — the closest things to reusable components (`Logo.jsx`, `BottomNav.jsx`, `VisualCard.jsx`, `richText.jsx`) are ordinary root-level files that happen to be imported by multiple screens, not a deliberate design system the way CareHub's `components/ui/` is.

## Known-Bad Artifact

A stray directory exists inside `apps/carefind/carefind-main/`, literally named after a pasted code snippet run as a shell command:

```
apps/carefind/carefind-main/import { createClient } from '@supabase/supabase-js' ...
```

Inert but should be removed — see `08-technical-debt.md`.
