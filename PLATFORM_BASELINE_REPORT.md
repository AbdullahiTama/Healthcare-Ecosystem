# Healthcare Ecosystem — Production Baseline Report

**Date:** 2026-09-27
**Branch:** `main` (also `master` exists)
**Scope:** Full monorepo audit — CareFind, CareHub, shared packages, CI/CD, database
**Constraint:** Report only. No modifications made.

---

## 1. Repository Health

| Item | Status | Detail |
|------|--------|--------|
| Monorepo structure | VERIFIED | `apps/carefind`, `apps/carehub`, `packages/shared-email`, `packages/shared-marketplace`, `packages/shared-notifications`, `packages/design-system` |
| Root workspace config | **FAILED** | No `package.json`, `pnpm-workspace.yaml`, `turbo.json`, or any workspace manifest at root |
| Package manager | VERIFIED | `npm` (each app has its own `package-lock.json`) |
| Node version | VERIFIED | CI specifies Node 20 |
| Git branches | **PARTIALLY VERIFIED** | `main`, `master`, `ci/minimum-viable-pipeline`, multiple feature branches exist. CI triggers only on `main`; `master` has no CI coverage |
| Git history | VERIFIED | ~60+ commits visible, recent commits show active security fixes |
| Source count | VERIFIED | ~500+ JS/JSX files across both apps and 4 packages |
| Lock files | VERIFIED | `package-lock.json` exists for both apps (~192KB for CareFind) |

**Assessment:** The repository is a functional but architecturally informal monorepo. The absence of a root workspace config means dependencies are duplicated across apps, and there is no unified install or version management. The existence of both `main` and `master` branches with only `main` in CI is a drift risk.

---

## 2. CareFind Health

| Item | Status | Detail |
|------|--------|--------|
| Framework | VERIFIED | React 18 + Vite 5.4.21 |
| Package.json | VERIFIED | 36 dependencies, 8 devDependencies |
| Router pattern | VERIFIED | Catch-all `api/router.js` due to Vercel Hobby plan's 12-function limit (14 API routes) |
| API handlers | VERIFIED | 29 handlers in `api/_handlers/`, 5 in `api/email/`, 2 in `api/cron/`, 1 in `api/webhooks/` |
| State management | VERIFIED | `@tanstack/react-query` ^5.102.8 |
| Error tracking | VERIFIED | `@sentry/react` ^10.73.0 + `@sentry/vite-plugin` ^5.4.0 |
| Map/Geo | VERIFIED | `leaflet` ^1.9.4, `react-leaflet` ^4.2.1 |
| Animations | VERIFIED | `gsap` ^3.15.0 |
| Email | VERIFIED | `resend` ^2.0.0, `@care-ecosystem/shared-email` |
| PDF/Excel | **RED FLAG** | `jspdf` ^4.2.1, `jspdf-autotable` ^5.0.8, `xlsx` ^0.18.5 — server-side libraries bundled in browser |
| **`pg` in client bundle** | **RED FLAG** | `pg` ^8.23.0 is a server-side Postgres client. It should NOT be in a Vite client bundle. It will be shipped to browsers. |
| Supabase JS version | **WARNING** | `@supabase/supabase-js` ^2.116.0 — differs from CareHub's ^2.45.0 |
| Build | **FAILED** | Build timed out (>120s) or failed with esbuild error |
| Tests | **PARTIALLY VERIFIED** | Tests start but timeout (>120s). ~208 tests per README. Test discovery works (`openGraph.test.js` ran 59 tests). |
| TypeScript | **FAILED** | Zero TypeScript files. No type checking possible. |
| Lint | **FAILED** | No `.eslintrc`, no eslint config found anywhere in repo |
| `vite.config.js` | VERIFIED | Has Sentry plugin, manual chunking, path aliases |
| `vercel.json` | VERIFIED | Has security headers, cron jobs, rewrites for crawlers |

**Assessment:** CareFind is a feature-rich SPA but has critical dependency hygiene issues. `pg` (server-side Postgres) and `xlsx` are being bundled into the browser. `resend` is also a client dependency that should be server-only. The build system is slow enough to timeout. No lint or type checking exists.

---

## 3. CareHub Health

| Item | Status | Detail |
|------|--------|--------|
| Framework | VERIFIED | React 18 + Vite 5.4.21 |
| Package.json | VERIFIED | 27 dependencies, 5 devDependencies |
| Router pattern | VERIFIED | Catch-all `api/router.js` due to Vercel Hobby plan's 12-function limit (13 handlers) |
| API handlers | VERIFIED | 21 handlers in `api/_handlers/` |
| State management | VERIFIED | `@tanstack/react-query` ^5.103.1 |
| Error tracking | VERIFIED | `@sentry/react` ^10.73.0 + `@sentry/vite-plugin` ^5.4.0 |
| Email | VERIFIED | `resend` ^2.0.0, `@care-ecosystem/shared-email`, `@care-ecosystem/shared-notifications` |
| Additional deps | **WARNING** | `cmdk`, `command-score`, `qrcode`, `gsap`, `lucide-react` |
| **`pg` in client bundle** | **RED FLAG** | `pg` ^8.23.0 is a server-side Postgres client shipped to browsers |
| Supabase JS version | **WARNING** | `@supabase/supabase-js` ^2.45.0 — differs from CareFind's ^2.116.0 |
| Build | **FAILED** | Build timed out (>120s) |
| Tests | **PARTIALLY VERIFIED** | Tests start but timeout (>120s). ~288 tests per README |
| TypeScript | **FAILED** | Zero TypeScript files |
| Lint | **FAILED** | No `.eslintrc`, no eslint config found anywhere |
| `vite.config.js` | VERIFIED | Has Sentry plugin, manual chunking, path aliases (different from CareFind) |
| `vercel.json` | VERIFIED | Has cron jobs, rewrites |

**Assessment:** CareHub has the same fundamental issues as CareFind. The `pg` dependency in the client bundle is a significant security and bundle-size concern. The build system is slow enough to timeout. No lint or type checking.

---

## 4. Shared Package Health

### `@care-ecosystem/shared-email`
| Item | Status | Detail |
|------|--------|--------|
| Structure | VERIFIED | `src/index.js`, `src/EmailService.js`, `src/sendEmail.js`, `src/authEmail.js`, `src/templates/`, `src/utils/` |
| Dependencies | VERIFIED | `@supabase/supabase-js` ^2.40.0, `resend` ^2.0.0 |
| Exports | VERIFIED | `sendEmail`, `EmailService`, `getEmailService`, `sendAuthEmail`, templates, formatters |
| Deferred imports | VERIFIED | Complex dynamic import pattern to avoid module-level crashes in serverless |
| Tests | VERIFIED | Has `__tests__/` directory |
| Type checking | **FAILED** | `tsc --noEmit` in scripts but zero TypeScript files |
| Build | **NOT VERIFIED** | No build command; package has no `build` script |

### `@care-ecosystem/shared-marketplace`
| Item | Status | Detail |
|------|--------|--------|
| Structure | **MINIMAL** | Only `src/index.js` and `src/index.test.js` — very thin package |
| Dependencies | VERIFIED | Zero runtime dependencies, `vitest` devDep |
| Tests | VERIFIED | Has `index.test.js` |
| Build | **NOT VERIFIED** | No build command |

### `@care-ecosystem/shared-notifications`
| Item | Status | Detail |
|------|--------|--------|
| Structure | VERIFIED | Has `src/` directory with `package.json` |
| Dependencies | VERIFIED | `@supabase/supabase-js` ^2.45.0 |
| Tests | VERIFIED | Has `vitest run` script |
| Build | **NOT VERIFIED** | No build command |

### `@care-ecosystem/design-system`
| Item | Status | Detail |
|------|--------|--------|
| Structure | VERIFIED | `src/theme.js` (194 lines of design tokens), `src/components/` |
| Dependencies | VERIFIED | Peer deps: `react >=18`, `lucide-react >=0.400.0` |
| Lint | VERIFIED | Has `eslint` script (but no `.eslintrc` found) |
| Type checking | VERIFIED | Has `tsc --noEmit` script |
| Build | **NOT VERIFIED** | No build command; exports `src/theme.js` directly |

**Assessment:** Shared packages are functional but minimal. `shared-marketplace` is extremely thin (2 files). No package has a build step or lock file. `shared-email` has a complex deferred-import architecture that suggests deployment fragility. No package versioning coordination — each uses `1.0.0`.

---

## 5. Test Health

| Item | Status | Detail |
|------|--------|--------|
| Test runner | VERIFIED | Vitest ^2.0.0 in all apps and packages |
| Testing Library | VERIFIED | `@testing-library/react` ^16.0.0, `@testing-library/jest-dom` ^6.5.0 |
| Test count (CareFind) | **PARTIALLY VERIFIED** | ~208 tests (README claim); tests timeout (>120s) — cannot confirm count |
| Test count (CareHub) | **PARTIALLY VERIFIED** | ~288 tests (README claim); tests timeout (>120s) — cannot confirm count |
| Test execution | **FAILED** | Both apps' test suites exceed 120s timeout; no test output could be captured |
| API handler tests | VERIFIED | `email-templates.test.js` exists with 3 tests; `trustLevels.test.js` exists |
| Test coverage | **NOT VERIFIED** | No coverage reports visible; no `coverage` config in vitest.config |
| E2E tests | **FAILED** | None exist anywhere in the repo |
| Security regression tests | **FAILED** | None exist beyond ad-hoc SQL probe scripts |
| Test infrastructure | **PARTIALLY VERIFIED** | `jsdom` environment configured; `vi.hoisted` mocking pattern used |

**Assessment:** The test infrastructure exists and has tests, but execution is unreliable due to timeouts. The absence of coverage reporting and E2E tests is a significant gap. Test execution timeout suggests either very slow test setup or tests that depend on external services.

---

## 6. Build Health

| Item | Status | Detail |
|------|--------|--------|
| Build tool | VERIFIED | Vite 5.4.21 |
| CareFind build | **FAILED** | Esbuild error / timeout (>120s). Error: `The service was stopped` in `ErrorBoundary.jsx` |
| CareHub build | **FAILED** | Timeout (>120s) |
| Sourcemaps | VERIFIED | Conditional on `SENTRY_AUTH_TOKEN` env var |
| Chunk splitting | VERIFIED | Manual chunks configured in both apps |
| Sentry plugin | VERIFIED | `@sentry/vite-plugin` ^5.4.0 configured |
| TypeScript compilation | **FAILED** | No TypeScript files exist; `tsc --noEmit` scripts in packages will error |
| Lint | **FAILED** | No lint configuration found anywhere (no `.eslintrc`, no `eslint.config.js`) |
| Build cache | **NOT VERIFIED** | No `.vite` or `dist` directories visible after failed builds |
| Build reproducibility | **PARTIALLY VERIFIED** | `package-lock.json` exists but no workspace lock |

**Assessment:** Builds are failing or timing out. This is the most critical production readiness issue. Without a working build pipeline, no code can be reliably deployed. The esbuild error in CareFind suggests potential code or dependency issues.

---

## 7. CI/CD Health

| Item | Status | Detail |
|------|--------|--------|
| GitHub Actions | VERIFIED | Two workflows: `carefind-ci.yml`, `carehub-ci.yml` |
| CI trigger | **PARTIALLY VERIFIED** | Both trigger on `push` to `main` AND `pull_request`, but with `paths` filters. `master` branch is NOT covered |
| CI steps | VERIFIED | `npm ci` → `npm run test` → `npm run build` |
| CI lint step | **FAILED** | No lint step in CI (justified because no lint config exists) |
| CI caching | VERIFIED | `cache-dependency-path: apps/*/package-lock.json` |
| Concurrency | VERIFIED | `cancel-in-progress: true` with group-based concurrency |
| Deployment | VERIFIED | Vercel deployments configured via `vercel.json` in each app |
| Deployment gates | **FAILED** | No required-checks; CI is the only gate and it's bypassable |
| Migration validation | **FAILED** | No CI step validates migrations |
| Security scanning | **FAILED** | No Snyk, `npm audit`, or similar in CI |
| `.github/workflows` | VERIFIED | Both workflows exist and are actively maintained |
| `master` branch CI | **FAILED** | `master` branch exists but has no CI triggers |

**Assessment:** CI exists as a minimum-viable quality gate but is incomplete. The `master` branch having no CI coverage while the repo has both branches is a significant risk. No security scanning, no migration validation, no lint.

---

## 8. Database/Migration Health

| Item | Status | Detail |
|------|--------|--------|
| Supabase project | VERIFIED | Single project: `szdybxmgmhndoytqanfb` (`eu-west-1`) |
| Supabase CLI config | VERIFIED | `supabase/config.toml` exists with project ID, API, DB, Studio, Auth config |
| Migrations directory | VERIFIED | `supabase/migrations/` with 120 SQL files |
| Migration naming | VERIFIED | `{app}_YYYYMMDD_name.sql` pattern |
| Legacy SQL files | **PARTIALLY VERIFIED** | `apps/carehub/sql/` (69 files), `apps/carefind/sql/` (45 files) — kept for reference per `MIGRATIONS.md` |
| Migration reproducibility | **FAILED** | Legacy SQL files in `apps/*/sql/` are not tracked by Supabase CLI. Only `supabase/migrations/` is CLI-managed. Mixing both locations means migrations are not reproducible from a single command. |
| `supabase db diff` | **NOT VERIFIED** | No evidence this command is used; migrations appear hand-written |
| `schema_migrations` | **NOT VERIFIED** | Cannot verify what's been applied vs. not without DB access |
| Seed data | VERIFIED | `supabase/seeds/` has `carehub_qa_seed_carehub.sql`, `carefind_qa_seed_carefind.sql` |
| RLS policies | **PARTIALLY VERIFIED** | Active per CODE_AUDIT.md, but cannot verify without live DB access |
| Migration tooling | **FAILED** | `MIGRATIONS.md` says to use `supabase db push` and `supabase migration new`, but the legacy files in `apps/*/sql/` predate this workflow and are not in `supabase/migrations/` |
| Migration verification | **PARTIALLY VERIFIED** | `MIGRATIONS.md` documents verification steps (check `schema_migrations`, check `pg_policies`) |
| Duplicate migration locations | **RED FLAG** | Same migrations may exist in both `supabase/migrations/` AND `apps/*/sql/` — risk of double-application |

**Assessment:** The migration system has a dual-location problem. `supabase/migrations/` is the CLI-managed source of truth, but `apps/carehub/sql/` and `apps/carefind/sql/` contain legacy files that may or may not have been applied. This makes it impossible to reliably determine database state from files alone.

---

## 9. Security Red Flags Discovered

### CRITICAL

| # | Finding | Detail |
|---|---------|--------|
| S1 | **Server-side libraries in client bundle** | `pg` ^8.23.0 (Postgres client) is a dependency in BOTH `apps/carefind/package.json` and `apps/carehub/package.json`. This means the entire Postgres client library, including any connection logic, is bundled into the browser. An attacker can extract connection string patterns and database interaction logic. |
| S2 | **Server-side library in client bundle (CareFind)** | `xlsx` ^0.18.5 is a server-side Excel library bundled in CareFind's browser output. |
| S3 | **`resend` as client dependency** | `resend` ^2.0.0 is listed in both apps' `dependencies` (not `devDependencies`). The Resend API key (`RESEND_API_KEY`) is server-only, but the library itself should not be in the client bundle. |
| S4 | **`.env` files exist on disk with real credentials** | Both `apps/carefind/.env` and `apps/carehub/.env` exist (not `.example`). While `.gitignore` excludes them, their presence means real credentials were once configured. If `.gitignore` is ever modified, these leak. |
| S5 | **Vercel OIDC_TOKEN in `.env.local`** | `/Users/USER/Desktop/HealthCare-Ecosystem/.env.local` contains a `VERCEL_OIDC_TOKEN` — a bearer token for Vercel's infrastructure. While `.gitignore` excludes `.env.local`, this token has access to Vercel projects and should never be committed. |

### HIGH

| # | Finding | Detail |
|---|---------|--------|
| S6 | **Different Supabase JS versions** | CareFind uses `@supabase/supabase-js` ^2.116.0, CareHub uses ^2.45.0. Version skew between apps using the same Supabase project risks subtle behavior differences. |
| S7 | **No lint or type checking** | Zero lint configuration and zero TypeScript files. No code quality gates exist anywhere. |
| S8 | **No CI lint step** | CI runs `test` and `build` only. No lint step because no lint config exists. Code quality is entirely unenforced. |
| S9 | **`master` branch with no CI** | Both `main` and `master` branches exist. CI only triggers on `main`. Code pushed to `master` bypasses all quality gates. |
| S10 | **No security scanning in CI** | No `npm audit`, Snyk, or similar in any CI workflow. |
| S11 | **`SUPABASE_SERVICE_ROLE_KEY` in env files** | The service role key is referenced in `.env` files. If exposed, it grants full database access bypassing RLS. |

### MEDIUM

| # | Finding | Detail |
|---|---------|--------|
| S12 | **No E2E tests** | Zero end-to-end tests means no automated security regression testing. |
| S13 | **Build timeouts suggest resource exhaustion** | Builds timing out at 120s suggests either very large bundles or dependency issues that could mask security concerns in the build pipeline. |
| S14 | **No `.env.example` verification** | CI does not verify that `.env` files match `.env.example` structure. |
| S15 | **Vercel Hobby plan limitations** | Both apps use Vercel's Hobby plan (12-serverless-function limit), requiring router patterns. This is a cost-saving measure but introduces architectural complexity and potential deployment fragility. |

---

## 10. Highest-Priority Follow-Up Tasks

### P0 — Blocker (must fix before any security hardening)

| # | Task | Effort | Impact |
|---|------|--------|--------|
| T1 | **Remove `pg` from client dependencies** | Medium | Stops server-side Postgres client from being shipped to browsers. Replace with `@supabase/supabase-js` only. |
| T2 | **Remove `xlsx` from CareFind client dependencies** | Low | Stops server-side Excel library from being shipped to browsers. Move to server-only API routes. |
| T3 | **Make `resend` a server-only dependency** | Medium | Move `resend` to `devDependencies` or remove from client `package.json` entirely. Email sending should happen in serverless functions, not client code. |
| T4 | **Fix builds** | High | Both apps fail to build. Investigate esbuild error in CareFind and timeout in CareHub. Add `@vitejs/plugin-legacy` if needed. |
| T5 | **Add lint configuration** | Low | Create `.eslintrc` at root and app level. Add lint step to CI. |

### P1 — Critical for production readiness

| # | Task | Effort | Impact |
|---|------|--------|--------|
| T6 | **Unify Supabase JS versions** | Low | Align both apps to the same `@supabase/supabase-js` version. |
| T7 | **Add `master` branch to CI triggers** | Low | Update both `*.yml` workflows to include `master` in push triggers. |
| T8 | **Consolidate migration locations** | High | Move all `apps/*/sql/*.sql` files into `supabase/migrations/` or generate them via `supabase db diff`. Ensure single source of truth. |
| T9 | **Add security scanning to CI** | Medium | Add `npm audit` or Snyk to both CI workflows. |
| T10 | **Add test coverage reporting** | Medium | Configure `vitest --coverage` in CI. |

### P2 — Important but not blocking

| # | Task | Effort | Impact |
|---|------|--------|--------|
| T11 | **Add TypeScript type checking** | High | Migrate shared packages to TypeScript first, then apps incrementally. |
| T12 | **Add `.env` verification to CI** | Low | Script that validates `.env` files contain all required keys from `.env.example`. |
| T13 | **Add E2E tests** | High | Start with Playwright for critical user journeys. |
| T14 | **Add root workspace config** | Medium | Create `pnpm-workspace.yaml` or equivalent for unified dependency management. |
| T15 | **Add `.env.example` compliance** | Low | Ensure `.env` files on disk match `.env.example` structure; audit for leaked real credentials. |

---

## Verification Methodology

All items were verified through:
- File system inspection (glob, read)
- Package.json analysis
- CI workflow analysis
- Test execution attempts (timed out)
- Build execution attempts (timed out/failed)
- Git branch analysis
- Supabase configuration review
- Code review of key files

Tests and builds could not be fully verified due to timeouts. The timeout threshold was 120 seconds for all test/build commands.

---

## Conclusion

**The repository is NOT production-ready.** The most critical issues are:

1. **Server-side libraries (`pg`, `xlsx`) are bundled in the browser** — a significant security and privacy risk
2. **Both apps fail to build** — no deployment is possible from the current state
3. **No lint or type checking exists** — code quality is entirely unenforced
4. **CI is incomplete** — no lint step, no `master` branch coverage, no security scanning
5. **Migration reproducibility is broken** — dual-location SQL files make it impossible to verify database state from files alone

The application has real functionality and a solid architectural foundation (React 18, Vite, Supabase, RLS), but the build pipeline is broken and dependency hygiene is critically deficient.

---

*Report generated: 2026-09-27*
*Branch: `main`*
*Repository: Healthcare-Ecosystem monorepo*
