# 10 — Improvement Roadmap

This is a time-horizon view of the same underlying findings documented throughout `docs/discovery/` and `architecture/`. See `architecture/Technical-Debt.md` for the dependency-ordered (Phase 0–4) version of this same material with per-item effort/risk scores; this document buckets the identical work into the four horizons requested.

## Quick Wins (1–2 Days)

See `09-quick-wins.md` in full. Summary: verify the four unresolved unknowns (consultations collision, webhook reachability, Locations crash, reviewAI functionality), rotate the exposed admin-setup key, fix the Locations crash and Modal CSS bug, consolidate `readAuth()`, wire POS's stock decrement, fix Doctor's Disposition selector, and clear out confirmed dead code and stale branding.

## Short-Term Improvements (1–2 Weeks)

- **Give the hospital pipeline a real discharge path** for Lab/Imaging-only visits — patients currently accumulate permanently stuck mid-pipeline.
- **Rebuild CareFind's admin authentication** on a real, signed-session mechanism, resolving the `admin-auth.js`/`admin-setup.js` hash-scheme incompatibility as a byproduct.
- **Fold the three hospital shadow services** (Doctor/Lab/Imaging's private Supabase clients) into `lib/supabase.js`.
- **Add pagination** to CareHub's ~17 unbounded list queries and CareFind's search/admin queries — the single highest-leverage performance fix relative to its effort.
- **Introduce a route-guard abstraction** (`<RequireRole>`/`<RequireBusinessType>`) and begin applying it, starting with the highest-exposure routes (Staff, Reports, Settings, and the hospital/enterprise verticals).
- **Reconcile Doctor's two "lab tests ordered" representations** and the drifted test-name catalogues between Doctor and Lab.
- **Promote `useToast`/`Toast` to a shared context**, collapsing 19 independent instances into one.
- **Introduce a `<DashboardPage>` wrapper** to collapse `BusinessDashboard.jsx`'s 17 duplicated `TopBar` fragments and extend headers to the 6 enterprise routes currently missing one.

## Medium-Term Improvements (1–2 Months)

- **Migrate CareHub's authentication onto Supabase Auth**, matching CareFind's own working consumer implementation. This is the single highest-leverage item in the entire roadmap — it's a prerequisite for real Row-Level Security, and it's what makes the Short-Term route-guard and service-consolidation work durable rather than provisional.
- **Introduce Row-Level Security policies** across both products' tables once real sessions exist from the above, prioritized by data sensitivity — clinical tables first, then financial, then everything else.
- **Document (and begin migrating toward) a real database schema** — even a hand-maintained schema doc is a large improvement over the current state of "reverse-engineer it from query strings," and the Supabase CLI's native migration support makes a fuller fix realistic within this horizon.
- **Resolve the `consultations` collision properly** — whatever verification in the Quick Wins phase reveals, this horizon is where the actual schema separation (if needed) happens.
- **Resolve the CareFind product-column gap** — decide where `whatsapp`/`image_url`/`sale_type`/`min_purchase`/`seller_location` are meant to be set, and build that path in CareHub's `Inventory.jsx`.
- **Start a test suite**, scoped initially to the highest-risk flows (checkout, authentication, the patient pipeline) rather than attempting broad coverage — begin this as early as capacity allows within this horizon rather than treating it as a final step, since it de-risks everything built during it.
- **Introduce ESLint + Prettier** with a shared config across both apps, enforced in CI once CI exists — this would have caught the enterprise vertical's style fork before it became five files' worth of diverged convention.
- **Break up CareFind's largest files** (`Feed.jsx`, `AdminPanel.jsx`) along the feature boundaries already identified in `knowledge/modules/`.

## Long-Term Improvements

- **A real backend/API boundary** for anything security- or integrity-critical — this doesn't require a full rewrite; even a handful of server-side functions validating writes for authentication, financial transactions, and clinical data would remove the current situation where the browser is the only thing enforcing any rule.
- **A formalized, documented CareHub↔CareFind contract** — which tables are shared, who owns writes to which columns, and a process (even a lightweight one, like an ADR) for either team to propose changes to shared data without discovering divergence after the fact, the way the `consultations` collision and the `products` column gap were discovered this engagement.
- **A single, deliberate extension pattern for adding a new business-type vertical** — today it requires touching at least four independent files by convention (`BUSINESS_TYPES`, a new `ALL_NAV_*` array, the `getNavItems` conditional, and a hardcoded fallback repeated across four components). A config-driven approach would turn this from a small research project into a bounded task.
- **Incremental typing** (TypeScript or at minimum systematic `PropTypes`) across both products, starting with the most-shared components and the `pageProps` shape every CareHub dashboard page receives.
- **A product decision on CareFind's actual scope** — whether its current, overwhelmingly social/live-streaming/creator-monetization implementation is an intentional direction the documentation simply hasn't caught up to, or scope that needs to be reconciled with the "healthcare discovery platform" framing. This isn't strictly an engineering task, but it should inform every other long-term item on this list, particularly the shared-contract work.
- **A meaningful test suite** covering both products broadly, built out from the Medium-Term starting point.
- **Multi-tenancy hardening at scale** — once RLS exists, revisit whether the current `business_id`-filtering model holds up as tenant count grows, or whether it needs to be paired with database-level partitioning or connection-level tenant isolation.

## How to Use This Roadmap

Start with `09-quick-wins.md` immediately — nothing there is blocked by anything else. The Short-Term and Medium-Term items are ordered so that authentication work (Medium-Term) precedes the items that depend on it being real (route guards, RLS) rather than provisional. If you can only commit to one Medium-Term item, make it the Supabase Auth migration — nearly everything else in this document either depends on it or becomes meaningfully safer once it exists.
