# CareFind — Deployment Guide

> One Supabase project (`szdybxmgmhndoytqanfb`, `eu-west-1`), one Vite SPA (`apps/carefind`), one Vercel project (`rootDirectory: apps/carefind`). Deploys on push via `vercel.json`.

## 1. Prerequisites

- Supabase project provisioned, migrations applied (see `apps/carefind/sql/` + root `supabase/` if using CLI)
- Vercel project with `Root Directory = apps/carefind`
- Node 20+, `npm ci` from repo root or `apps/carefind`

## 2. Environment variables

Copy `apps/carefind/.env.example` → `apps/carefind/.env` (local) and set the same keys in Vercel → Settings → Environment Variables.

| Key | Where | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | client (`VITE_`) | `https://<ref>.supabase.co` — anon key via `VITE_SUPABASE_ANON_KEY` is public by design |
| `VITE_SUPABASE_ANON_KEY` | client | publishable anon key (`sb_publishable_…`) |
| `VITE_SENTRY_DSN` | client (optional) | empty = Sentry disabled (no-op) |
| `SUPABASE_URL` | server | same as `VITE_SUPABASE_URL` but server-side |
| `SUPABASE_SERVICE_ROLE_KEY` | server | service-role, never `VITE_` |
| `PAYSTACK_SECRET_KEY` | server | `sk_live_…` or `sk_test_…`; server validates `sk_` prefix, rejects `pk_` |
| `RESEND_API_KEY` | server (optional) | empty = email no-op |
| `RESEND_FROM_EMAIL` / `RESEND_REPLY_TO` | server | defaults in `.env.example` |
| `APP_URL` / `SITE_URL` | server | email link origins (e.g. `https://carefind.ng`) |
| `CRON_SECRET` | server | if cron job auth is gated |
| `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` | build-time | only for sourcemap upload; build sets `sourcemap:'hidden'` when present, otherwise `false` |

> Never use `pk_live_` Paystack publishable key as `PAYSTACK_SECRET_KEY` — handled in `api/_handlers/*`.

## 3. Build

```bash
cd apps/carefind
npm ci
npm run build   # vite build → dist/ (≈ 40–60s, code-split: react-vendor, supabase, map-vendor, motion, query)
npm test        # vitest run (openGraph, healthcare-discovery, etc.)
npm run preview # optional local serve of dist/
```

Verify: `dist/manifest.json`, `robots.txt`, `sitemap.xml` present; no `dist/*.map` when `SENTRY_AUTH_TOKEN` unset; `dist/assets` hashed.

## 4. Vercel configuration

`vercel.json`:
- `rewrites`: `/api/(.*)` → `/api/router` (single function folds 14+ handlers, Hobby 12-function limit), crawler OG via `api/router` + `src/lib/openGraph.js`, SPA fallback `/(.*)` → `/index.html`
- `headers`: HSTS (`63072000`), `nosniff`, `DENY`, `strict-origin-when-cross-origin`, `Permissions-Policy` (no camera/mic), `Cache-Control: immutable` for `/assets` + `/fonts`
- `crons`: `/api/cron/process-email-outbox` (`0 2 * * *`), `/api/cron/subscription-expiry` (`0 8 * * *`)

Vercel settings:
- Framework preset: Vite
- Build command: `npm run build` (or default from root)
- Output directory: `dist`
- Install command: `npm ci` (or monorepo-aware)

### Hobby plan limits

CareFind and CareHub are both shaped around the Vercel Hobby plan, which enforces two cron rules at **build** time. Breaching either fails the deployment, so a change that trips one breaks every deploy rather than just that cron:

1. **At most two cron jobs per deployment.** CareFind declares exactly two (outbox drain, expiry scan); CareHub declares one. A third is rejected.
2. **A cron may fire at most once per day.** The minute and hour fields must each resolve to a single value, so `*`, `*/5`, `*/1`, `0,30`, `1-30` and `0 */2` are all illegal — only daily schedules such as `0 2 * * *` are accepted.

`src/lib/vercel-cron-hobby-limit.test.js` asserts both rules for every `vercel.json` in the repo — cron count, each schedule, and the fixed `headers`/`rewrites` blocks — so an illegal schedule fails the test suite before it can fail a deploy. It lives in `src/`, not `api/`, because every non-underscore `.js` under `api/` occupies one of the twelve Hobby serverless-function slots. Because that guard is repo-wide but only this app's suite runs it, `.github/workflows/carefind-ci.yml` triggers on `apps/carehub/vercel.json` as well; without that path a CareHub config change would merge without the guard ever executing.

The outbox drain is a **daily** cron at `02:00 UTC`, ahead of the `08:00 UTC` expiry scan so expiry mail enqueued that morning still gets a second drain the same day. (Vercel cron schedules are always interpreted in UTC.) Retry latency is therefore bounded by the daily interval rather than by minutes. First sends are unaffected: every producer enqueues and then flushes on the same request, so only a row that already failed a transient provider error waits for the next drain.

> **Never drain the outbox from the router or any request path.** `EmailService.processBatch` selects `status in (pending, failed)` with no claim token and no row lease, so two concurrent invocations can pick up the same row and send it twice — and Vercel runs invocations concurrently by construction, with no in-process guard. Doing it properly needs a `claim_email_batch` function using `SELECT … FOR UPDATE SKIP LOCKED` with a unique claim token. That work, and the migration of the schedule itself, belong to the reliable email system spec, which replaces this cron with a Supabase Cron minute worker (exempt from Vercel plan limits) and then removes the Vercel cron entries: [0001. Delivery Foundation](../../docs/specs/_root/0001-reliable-email-system/0001-delivery-foundation.md). When that migration lands, delete the `carefind cron contract` block in the guard test along with the `crons` entries it pins.

## 5. Post-deploy checks

- `https://carefind.ng/` — marketing + glass nav
- `https://carefind.ng/search` — marketplace tabs, filters
- `https://carefind.ng/feed` — authenticated feed (or redirect to `/login`)
- `/manifest.json` installable, `/robots.txt` + `/sitemap.xml` 200
- OG preview: `curl -H "User-Agent: WhatsApp" https://carefind.ng/post/<uuid>` → `og:image` absolute, `og:url` canonical (`/post/:id`)
- Paystack webhook reachable at `/api/paystack-webhook` (if payments enabled)

## 6. Operational notes

- Design tokens: `packages/design-system/src/theme.js` + `apps/carefind/src/styles/global.css` (motion: `fast 140ms`, `base 200ms`, `slow 300ms`, `ease-out cubic-bezier(0.16,1,0.3,1)`; `prefers-reduced-motion` disables marquee + press lifts)
- Error tracking: `src/lib/sentry.js` (no-op when `VITE_SENTRY_DSN` empty; prod console silent, dev logs)
- Theming: warm neutrals (`#F7F5EF`, `#FBFAF6`), teal `#0E6F5A`, navy `#0B4A3E` — consistent via `theme.*`
