# Folder Structure — Care Ecosystem

```
HealthCare-Ecosystem/                    (not itself a git repository)
├── .claude/                             agents, commands; context/rules/checklists/templates empty
├── docs/                                PROJECT_OVERVIEW, ONBOARDING, SESSION_WORKFLOW, spec template
├── knowledge/
│   ├── business/                        vision, product principles
│   ├── glossary/                        domain terms (FEFO, Encounter, Dispensing, ...)
│   ├── workflows/                       master patient-journey workflow
│   └── modules/                         EMPTY — no per-module docs exist
├── planning/                            roadmap.md, CODE_AUDIT.md (every section an empty checklist)
├── prompts/                             9 numbered prompt templates for an AI-driven dev process
├── templates/                           architecture/module doc templates
├── architecture/                        this document set (was empty at the start of this engagement)
├── decisions/                           empty — no ADRs
└── apps/
    ├── carehub/                         own nested .git, remote: github.com/AbdullahiTama/skincarepro
    │   └── src/
    │       ├── pages/
    │       │   ├── auth/                Login.jsx, Register.jsx
    │       │   ├── admin/               AdminDashboard.jsx
    │       │   └── dashboard/
    │       │       ├── (≈20 flat page files: Inventory, POS, Clients, Staff, ...)
    │       │       └── hospital/        Reception, Triage, Doctor, RxInbox, Lab, Imaging
    │       ├── components/
    │       │   ├── ui/index.jsx         the app's only shared UI kit (19 exports)
    │       │   └── layout/              Sidebar, TopBar, NotificationBell
    │       └── lib/                     supabase.js, permissions.js, utils.js, email.js, realtime.js
    └── carefind/carefind-main/          no git repo of its own found
        └── src/
            ├── (≈45 flat top-level .jsx/.js files, no pages/ or components/ subfolder)
            ├── lib/                     supabaseClient.js, AuthContext.jsx, reviewAI.js, sentiment.js,
            │                            activeIdentity.js, theme.js, articleFormat.js
            └── api/                     admin-auth.js, admin-setup.js (Vercel functions)
                                         + paystack-webhook.js at the src root
```

## Structural asymmetry between the two products

CareHub is organized (`pages/`, `components/{ui,layout}`, `lib/`); CareFind is entirely flat — ~48 files directly in `src/` with no subfolder structure at all, despite being roughly 4x CareHub's line count. This is a real, consistent asymmetry documented throughout this session's findings, not a cosmetic difference: it correlates directly with CareFind having no shared component library (`Component-Catalog.md` addendum) and no centralized service file (`Service-Catalog.md` addendum) the way CareHub at least partially has.

## Known-bad artifacts

**A stray, accidentally-created directory** sits inside `apps/carefind/carefind-main/`, literally named after a pasted code snippet:

```
apps/carefind/carefind-main/import { createClient } from '@supabase/supabase-js'  const supabaseUrl = 'https_/src/lib/supabaseClient.js
```

This is the unmistakable result of a code block being run as a shell command (unescaped `mkdir`/redirection) rather than saved as a file through an editor. It's inert — nothing imports from it — but pollutes the repository and should be removed. It is the one item in this entire document set that is purely destructive to leave in place with no offsetting information value, unlike every other finding here.

## Documentation folders that exist but are empty

`knowledge/modules/`, `architecture/` (as of the start of this engagement — now populated by this document set), `decisions/` — all empty despite `planning/roadmap.md`'s own Phase 1 explicitly calling for "complete architecture documentation" and templates existing specifically for this purpose (`templates/MODULE_DOCUMENTATION_TEMPLATE.md`, `templates/ARCHITECTURE_REVIEW_TEMPLATE.md`). Full detail in `Missing-Documentation.md`.

## Version control gap worth flagging here specifically

The root `HealthCare-Ecosystem/` folder is not a git repository. `apps/carehub` has its own nested `.git`. `apps/carefind/carefind-main` has none found. This means: CareFind's history, if it exists, is not visible from within this workspace; the root-level docs/knowledge/planning content has no version history at all; and the two apps cannot be said to share a single source-of-truth repository despite being described as "one ecosystem."
