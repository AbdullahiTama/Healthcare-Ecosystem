# 01 — Overview

## What This Document Set Is

A complete, implementation-verified discovery pass over the Care Ecosystem, produced by reading every source file in both repositories directly — not by trusting existing documentation. This distinction matters: `docs/` already contains an extensive-looking document tree (`CARE_ECOSYSTEM_OPERATING_MANUAL/`) that describes an idealized target architecture, and **20 of its files are completely empty**, including every domain deep-dive except Identity and Organisation, and the entire technical architecture series (Database, Security, Frontend, Backend, Service, State Management, Deployment) except two high-level overview files. The one populated domain document (`02-Domains/01-Identity-Domain.md`) contains a literal placeholder — *"Current State: (Custom Authentication — update after code audit)"* — confirming it was written as a target state and never reconciled against the actual codebase. Treat that manual as a statement of intent, not a description of what exists. This `docs/discovery/` set is the description of what exists.

## What Products Exist

Two independent applications under `apps/`:

- **CareHub** (`apps/carehub`) — an internal SaaS platform for healthcare businesses (pharmacies, hospitals, clinics, labs, imaging centres, wellness centres). Covers inventory, POS, billing-adjacent workflows, staff, hospital clinical workflow, multi-location/enterprise management.
- **CareFind** (`apps/carefind/carefind-main`) — publicly described as a healthcare discovery platform, but implemented overwhelmingly as a social feed / live-streaming / creator-monetization platform, with a comparatively small genuine healthcare-search surface.

## The Single Most Important Fact About This Ecosystem

**Both products are client-heavy single-page applications with no backend of their own**, talking directly to what appears to be one shared Supabase/Postgres project through a publicly-embedded key. There is no application server, no domain layer, no service layer in the sense the aspirational manual describes — CareHub hand-builds PostgREST query strings via raw `fetch()`; CareFind uses the proper `supabase-js` query builder. The only real backend compute in either product is three small Vercel serverless functions in CareFind. Nearly every architecture, security, and data-integrity finding in this document set traces back to this one fact.

## How To Use This Document Set

| File | Covers |
|---|---|
| `01-overview.md` | This file |
| `02-architecture.md` | Overall architecture, layers (actual vs. aspirational), tech stack, diagrams |
| `03-folder-structure.md` | Directory layout of both repos and the docs tree |
| `04-business-modules.md` | Every business module, how each currently works |
| `05-authentication.md` | All four authentication systems, contrasted against the aspirational Identity Domain doc |
| `06-database.md` | Every table, shared vs. product-owned, the one unresolved schema collision |
| `07-api.md` | The API layer — PostgREST, `supabase-js`, serverless functions, third-party integrations |
| `08-technical-debt.md` | Code quality audit — dead code, duplication, coupling, performance, security, missing tests |
| `09-quick-wins.md` | Everything fixable in 1–2 days |
| `10-roadmap.md` | Quick wins → short-term → medium-term → long-term |

This set draws on a much larger body of verified detail already produced this engagement in `architecture/` (15 documents) and `knowledge/modules/` (38 per-domain files) — this discovery set is the onboarding-shaped summary; those are the reference-shaped deep dives. Cross-references are given throughout rather than duplicating content wholesale.

## Origin Story, Briefly

CareHub's own git remote (`github.com/AbdullahiTama/skincarepro`), its default business type, and stale `skincarepro.vercel.app` branding still present in production email templates are all consistent with CareHub having started as a skincare-spa POS product later generalized into a multi-vertical healthcare platform. This explains several structural oddities documented throughout this set — most notably that the hospital clinical pipeline reads as a substantial later addition to a retail data model, not a ground-up clinical design.
