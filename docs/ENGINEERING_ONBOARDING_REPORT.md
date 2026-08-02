# Engineering Onboarding Report — Care Ecosystem

Prepared as a first-pass understanding exercise. Every claim below is grounded in a specific file read during this review — documentation, source code, package manifests, and deployment configuration for both repositories. Where something could not be confirmed from the workspace, it is listed in Section 8 as an open question rather than assumed.

---

## 1. What Products Exist

The workspace contains two independent applications under `apps/`:

- **CareHub** — `apps/carehub`
- **CareFind** — `apps/carefind/carefind-main`

Both are referred to collectively as the "Care Ecosystem" in the root-level documentation (`README.md`, `docs/PROJECT_OVERVIEW.md`). No third product, service, or shared package was found anywhere in the workspace.

---

## 2. Purpose of Each Product

### As documented

`README.md` and `docs/PROJECT_OVERVIEW.md` state:

- **CareHub** is an internal SaaS operating system for healthcare businesses — pharmacies, hospitals, clinics, laboratories, imaging centres, medical stores, wellness centres — covering inventory, POS, billing, patients, staff, reports, hospital/laboratory/imaging workflow, finance, multi-location management, and subscriptions.
- **CareFind** is described as a public healthcare discovery platform allowing patients to search providers, medicines, laboratories, and hospitals; view provider profiles; and (in future) book appointments.

### As implemented

CareHub's source matches its documented purpose closely: its ~20 dashboard pages and six-screen hospital clinical pipeline (`pages/dashboard/hospital/`) map directly onto the modules listed above.

CareFind's source only partially matches its documented purpose. Its `src/` directory contains 48 files totaling roughly 15,400 lines. Of these, three files implement healthcare discovery as described — `Search.jsx` (product/business/professional search), `BusinessProfile.jsx` (business listing and reviews), and `DrugProfile.jsx`. The remaining files implement a social feed (`Feed.jsx`, 1,823 lines), live streaming (`LiveSession.jsx`, `LiveShow.jsx`, `LiveDashboard.jsx`, `GoLive.jsx`, `UserGoLive.jsx`), a wallet and gifting system (`Wallet.jsx`, `GiftPanel.jsx`), creator monetization (`ProfessionalMonetization.jsx`), news/article publishing (`News.jsx`, `NewsArticle.jsx`, `ArticleEditor.jsx`), playlists, and an administrative back office (`AdminPanel.jsx`, 1,868 lines — the largest single file in either repository). This is stated as an observation of what the code contains, not a judgment of whether it should.

---

## 3. Repository Structure

The root `HealthCare-Ecosystem` directory is **not itself a git repository**. It contains:

```
HealthCare-Ecosystem/
├── docs/                    PROJECT_OVERVIEW.md, PROJECT_ONBOARDING.md, SESSION_WORKFLOW.md, FEATURE_SPEC_TEMPLATE.md
├── knowledge/                business/, glossary/, workflows/, modules/ (modules/ is empty)
├── planning/                 roadmap.md, CODE_AUDIT.md (audit sections are empty checklists)
├── prompts/                  9 numbered prompt templates
├── templates/                architecture and module documentation templates
├── architecture/              architecture documentation (populated during a prior review pass)
├── decisions/                 empty
├── .claude/                   agent/command configuration for AI-assisted development
└── apps/
    ├── carehub/                has its own nested .git repository (remote: github.com/AbdullahiTama/skincarepro)
    │   └── src/{pages,components,lib}
    └── carefind/carefind-main/  no .git repository found within this workspace
        └── src/                flat — 48 files directly in src/, no subfolders
```

**CareHub's internal structure:** `src/pages/{auth,admin,dashboard}`, `src/pages/dashboard/hospital/` (the six clinical station screens), `src/components/{ui,layout}`, `src/lib/` (data access, permissions, email, realtime, utilities).

**CareFind's internal structure:** no `pages/` or `components/` subfolder — every screen component sits directly in `src/`. A `src/lib/` folder exists with a smaller set of shared modules (`supabaseClient.js`, `AuthContext.jsx`, `reviewAI.js`, `sentiment.js`, `activeIdentity.js`, `theme.js`, `articleFormat.js`). A `src/api/` folder contains three Vercel serverless functions: `admin-auth.js`, `admin-setup.js`, `initiate-payment.js`. One file, `paystack-webhook.js`, sits at the project root (`apps/carefind/carefind-main/paystack-webhook.js`) rather than inside `api/` — see Section 8.

**One anomalous artifact:** a directory exists inside `apps/carefind/carefind-main/` whose name is the literal text of a pasted code snippet (`import { createClient } from '@supabase/supabase-js' ...`), containing a nested copy of `supabaseClient.js`. This is consistent with a shell command having been run against unescaped pasted text rather than a file being saved normally.

---

## 4. Technology Stack

Confirmed directly from each app's `package.json`, `vite.config.js`, and `vercel.json`:

| | CareHub | CareFind |
|---|---|---|
| Build tool | Vite ^5.0.0 | Vite ^5.4.0 |
| Framework | React ^18.2.0 / react-dom ^18.2.0 | React ^18.3.1 / react-dom ^18.3.1 |
| Routing | react-router-dom ^6.22.0 | react-router-dom ^6.26.0 |
| Backend/data | @supabase/supabase-js ^2.45.0 | @supabase/supabase-js ^2.45.0 |
| Vite plugin | @vitejs/plugin-react ^4.2.0 | @vitejs/plugin-react ^4.3.1 |
| Module type | ESM (`"type": "module"`) | ESM (`"type": "module"`) |
| Deployment | Vercel (`vercel.json`: static Vite build, SPA rewrite to `index.html`) | Vercel (`vercel.json`: SPA rewrite to `index.html`, plus explicit `/api/(.*)` → `/api/$1` rewrite for serverless functions) |
| Backend compute | None — no `api/` directory | Three Vercel serverless functions under `api/`: `admin-auth.js`, `admin-setup.js`, `initiate-payment.js` |
| Payment provider | None referenced | Paystack (`PAYSTACK_SECRET_KEY` referenced in `initiate-payment.js` and `paystack-webhook.js`) |

No test runner is listed in either `package.json` (no Jest, Vitest, Playwright, or similar). No linter or formatter configuration (`.eslintrc`, `.prettierrc`) was found in either app. Neither app declares environment variable requirements anywhere (`.env.example` does not exist in either repository) — variables referenced in source (`process.env.SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, `ADMIN_SECRET_SALT`) are only discoverable by reading the serverless function source directly.

---

## 5. High-Level Architecture

Both products are client-heavy single-page applications with no dedicated application backend of their own, connecting directly to what the shared table names (Section 6) indicate is one Supabase/Postgres project.

**CareHub** talks to Supabase entirely through hand-written `fetch()` calls constructed in `src/lib/supabase.js` (a single ~682-line file exporting roughly 90 functions), building PostgREST query strings directly (e.g. `products?business_id=eq.<id>`) and authenticating every request with a Supabase anon/publishable key present in the client source. The `@supabase/supabase-js` package is a listed dependency but is used only for one realtime-subscription helper (`src/lib/realtime.js`), not for CRUD. Three files under `src/pages/dashboard/hospital/` (`Doctor.jsx`, `Lab.jsx`, `Imaging.jsx`) each contain their own independent copy of this fetch/credential pattern rather than importing the shared one.

**CareFind** talks to Supabase through the `@supabase/supabase-js` query builder (`supabase.from('table').select(...)`), instantiated once in `src/lib/supabaseClient.js` and imported throughout. Authentication for end-users goes through Supabase Auth (`src/lib/AuthContext.jsx`), a different mechanism from CareHub's approach (Section 6/7). CareFind additionally has three small pieces of server-side compute (the Vercel functions in `src/api/`) that CareHub has no equivalent of — used for its own admin login/bootstrap and for initiating a Paystack payment server-side (keeping the Paystack secret key out of the browser for that specific call).

Neither application has a database migration file, schema definition, or entity-relationship diagram anywhere in the workspace. The data model for both products, and the 70+ tables referenced between them, exist only as strings inside application source code and (presumably) inside the live Supabase project itself, which is outside this workspace.

---

## 6. How CareHub and CareFind Interact

No shared code package, shared type definitions, or shared service layer exists between the two repositories. The only connection found is at the database level — both products' source code references identical table names, which was verified directly rather than assumed:

- **`businesses`** — written by CareHub (`Register.jsx`, `Settings.jsx`, admin approval flow); read by CareFind's `Search.jsx` and `BusinessProfile.jsx`, filtered on a `visible_on_carefind` boolean column; also written by CareFind's own `AdminPanel.jsx` (`approveClaim()` sets `visible_on_carefind = true` on a `businesses` row when approving a business-ownership claim).
- **`products`** — written by CareHub's `Inventory.jsx`; read by CareFind's `Search.jsx`/`BusinessProfile.jsx`, filtered on a `list_on_carefind` boolean column. CareHub's `ProductModal` and CareFind's `ProductUpload.jsx` both write the marketplace columns `sale_type`/`price_unit`/`min_purchase`, validated against the shared `@care-ecosystem/shared-marketplace` rules (allowed unit per sale type). `whatsapp`, `image_url` and `seller_location` are authored from CareFind's seller flow.
- **`staff_claims`** — a CareFind user can browse to `/claim-staff-position` and submit a claim to be a specific staff member CareHub created; CareHub's `Staff.jsx` displays and approves/rejects the same rows. Both sides of this workflow were read and confirmed to reference the identical table and row shape.
- **`business_claims`** — a CareFind user can claim ownership of a `businesses` row via `ClaimBusiness.jsx`; CareFind's own `AdminPanel.jsx` approves or rejects the claim and, on approval, writes the `visible_on_carefind` flag back onto CareHub's `businesses` table.

Beyond these four tables, each product has its own independent set of tables with no cross-reference found in the other's source: CareHub has (among others) `patients`, `triage`, `consultations`, `prescriptions`, `sales`, `clients`, `staff`, `orders`; CareFind has (among others) `reviews`, `profiles`, `posts`, `stories`, `live_sessions`, `wallets`, `transactions`, `notifications`, `admin_users`, `admin_teams`, and a table also named `consultations` whose selected columns (`professional_id`, `patient_id`, `type`, `fee`, `status: 'setup'/'paid'`) describe a paid-consultation-booking record for CareFind's monetization feature — a different concept from CareHub's clinically-named table of the same name. Whether these are the same physical table in the shared database could not be determined from source code and is listed as an open question in Section 8.

No shared identity system was found: CareHub's login (Section 7) and CareFind's Supabase Auth login are independent, and no code path maps one to the other except through the opt-in `staff_claims` workflow above.

---

## 7. Current Implementation Status

**CareHub** — all documented modules have corresponding, functioning-looking source: Inventory, POS, Clients, Staff, Reports, Settings, and the six-screen hospital pipeline (Reception, Triage, Doctor, Rx Inbox, Lab, Imaging) are all present and wired into routing. Two things were found to be explicitly incomplete as written:
- `pages/dashboard/ConsultationRouter.jsx` (the "Consultations" screen for non-hospital business types) renders only the text "Consultation forms for {businessType} coming in the next update."
- `src/lib/reviewAI.js` exists as a 0-byte empty file.

**CareFind** — the consumer-facing screens read as functionally complete implementations (Feed, Search, BusinessProfile, Wallet, live-streaming screens, AdminPanel). Two things were found that appear incomplete or non-functional as written, without live-environment access to confirm:
- `src/App.jsx` defines a full, self-contained search page but is never imported by `main.jsx` or any other file — the application's actual entry point renders `Feed.jsx` at `/` instead.
- `src/lib/reviewAI.js` (fully implemented, unlike CareHub's empty file of the same name) calls `https://api.anthropic.com/v1/messages` with only a `Content-Type` header set — no `x-api-key` or `anthropic-version` header is present in the fetch call as written, both of which the Anthropic API requires.

**Authentication** — three distinct implementations were found and read in full:
- CareHub's business/staff login compares plaintext password values via a PostgREST equality filter (`staff?email=eq.X&password=eq.Y`) and issues no session token; a hardcoded email/password pair for a super-admin account is present directly in `Login.jsx`.
- CareFind's admin login (`api/admin-auth.js`) hashes passwords as `` `cf_hashed_${password}` `` (string concatenation) and issues a token that is base64-encoded but not cryptographically signed; `api/admin-setup.js` (a separate endpoint that creates/resets the super-admin account) hashes passwords with real SHA-256, a different scheme from `admin-auth.js`'s login check.
- CareFind's consumer login (`src/lib/AuthContext.jsx`) uses Supabase Auth's `signUp`/`signInWithPassword`/`signOut` methods directly, with no custom password handling in application code.

**Payments** — `api/initiate-payment.js` is correctly placed under CareFind's `api/` directory and will be picked up by Vercel's file-based function routing. `paystack-webhook.js`, which contains the logic to verify a completed payment and credit a user's wallet, sits at the project root rather than inside `api/` — see Section 8.

---

## 8. Questions That Remain Unanswered

Each of these could not be resolved by reading the workspace and would need to be answered by someone with access to the live deployment/database:

1. ~~Do CareHub and CareFind point at the same physical Supabase project?~~ **Resolved during a later review pass.** Yes, confirmed directly: `apps/carehub/src/lib/supabase.js` and `apps/carefind/carefind-main/src/lib/supabaseClient.js` both contain the identical project URL and identical anon key. This was originally listed as an open question inferred only from matching table names; it no longer is.
2. **Is CareHub's `consultations` table the same physical table as CareFind's `consultations` table?** Given question 1 is now resolved (one shared Postgres database, one default `public` schema, which cannot contain two same-named tables), this is now very likely "yes" rather than a genuine toss-up — but the two products' queries still describe unrelated schemas (a clinical record vs. a paid-booking record) for that one table, and this specific point still needs direct verification against the live database rather than being assumed from the reasoning alone.
3. ~~**What actually writes `products.whatsapp`, `image_url`, `sale_type`, `price_unit`, `min_purchase`, and `seller_location`?**~~ **Resolved during a later review pass.** `sale_type`/`price_unit`/`min_purchase` are written by CareHub's `ProductModal` (inventory) and CareFind's `ProductUpload.jsx`, validated against the shared `@care-ecosystem/shared-marketplace` rules. `whatsapp`/`image_url`/`seller_location` are authored on CareFind's seller side.
4. **Is `paystack-webhook.js` actually reachable in production?** It is not located inside CareFind's `api/` directory, and the project's `vercel.json` rewrite rule only routes `/api/(.*)`. Whether an additional Vercel project setting (not present in this repository) makes it reachable, or whether it is effectively dead code, could not be determined here.
5. **Is `api/admin-setup.js` still deployed and reachable?** It is a live-looking endpoint capable of creating/resetting CareFind's super-admin account, gated by a key that defaults to a hardcoded literal if an environment variable is unset. Whether that environment variable is actually set in the production deployment is unknown from this workspace.
6. **Does any Row-Level Security policy exist on any table in either product?** No RLS policy, migration, or schema file exists in either repository. All authorization observed in both codebases happens in client-side application logic.
7. **Why do `admin-auth.js` and `admin-setup.js` use two different password-hashing schemes?** As written, an account created by one cannot authenticate through the other. Whether this reflects two different points in time, two different authors, or an intentional-but-undocumented design is unknown.
8. **Does `apps/carefind/carefind-main` have a git history anywhere?** No `.git` directory was found for it within this workspace, unlike CareHub. Whether it exists elsewhere (a separate clone, a different remote) is unknown.
9. **Is the Anthropic API call in CareFind's `lib/reviewAI.js` currently functioning in production?** The fetch call as written appears to be missing headers the Anthropic API requires. Whether a proxy, a different deployed version, or a header injected elsewhere makes this work in practice is unknown from source alone.
10. **What is the intended relationship between CareHub's `clients` table and its `patients` table?** Both represent a person the business serves; the hospital-business-type UI labels the `clients` screen "Patients," but no shared identifier or code path connects a row in one table to a row in the other. Whether this is intentional (two deliberately separate concepts) or an oversight is unknown.
11. **Is CareFind's current scope (social feed, live streaming, wallet, creator monetization) an intentional product direction beyond what `docs/PROJECT_OVERVIEW.md` describes, or has the documentation simply not been updated to reflect it?** Nothing in the workspace states which.
12. **Do the nav permissions granted to roles like Pharmacist, Doctor, and Nurse in `lib/permissions.js` (which reference hospital-only screens such as `rx_inbox`, `doctor`, `lab`) reflect an intended future state, or are they leftover from a different point in the product's design?** These permissions currently have no effect for any business type other than `hospital`.

This report does not propose resolutions to any of the above — per the scope of this engagement, it records only what was found and what remains open.
