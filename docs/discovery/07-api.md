# 07 — API Layer

Neither product has a conventional API layer (no OpenAPI spec, no versioning, no rate limiting, no request/response schema validation anywhere). "API" in this ecosystem means: how each client talks to Postgres, Storage, and a small number of third-party services.

## CareHub → Postgres

One internal, un-exported HTTP helper (`sbFetch()` in `lib/supabase.js`) wraps raw `fetch()` calls against Supabase's PostgREST endpoint, authenticated with a hardcoded anon key. ~90 exported functions across 21 logical domains call it. Three hospital station pages (`Doctor.jsx`, `Lab.jsx`, `Imaging.jsx`) each independently re-declare this exact pattern with their own hardcoded credentials rather than importing the shared one — four total independent implementations of the same transport. Full inventory: `architecture/Service-Catalog.md` Part 1–2.

## CareFind → Postgres

Proper `supabase-js` query builder (`supabase.from('table').select(...)`) used directly inside page components — no centralized service file equivalent to CareHub's `lib/supabase.js`. The client instance itself (`lib/supabaseClient.js`) is correctly centralized and imported everywhere. Full inventory: `architecture/Service-Catalog.md` Part 4.

## Storage API

Both products upload directly to Supabase Storage from the browser using the anon key, with no server-side validation step:
- CareHub buckets: `message-files`, `order-files`, `activity-voice` — all **public**, no authentication required to view a file once its URL is known.
- CareFind bucket: `live-media`, used independently by four separate components (`VideoRecorder`, `VideoUploader`, `VoiceRecorder`, `SlideUploader`), each reimplementing the same upload/error-handling flow rather than sharing one helper.

File-type and size validation (where present at all) is client-side only.

## Vercel Serverless Functions (CareFind only — CareHub has none)

| Function | Location | Purpose | Status |
|---|---|---|---|
| `api/admin-auth.js` | Correctly under `api/` | Admin login/verify/staff-management | **Broken — full auth bypass**, see `05-authentication.md` |
| `api/admin-setup.js` | Correctly under `api/` | Bootstrap/reset super-admin | **Exposure risk if reachable** — hardcoded fallback key, returns plaintext password. Whether this endpoint is actually deployed/reachable in production (vs. present in source only) was not confirmed from source alone; verify directly against the live Vercel deployment before treating it as an active exposure |
| `api/initiate-payment.js` | Correctly under `api/` | Starts a Paystack transaction server-side | Correctly built — secret key stays server-side, read via `process.env.*`, never hardcoded or shipped to the client |
| `paystack-webhook.js` | **At the project root, NOT under `api/`** | Verifies payment + credits wallet | Correctly built (HMAC verification, idempotent) **but its location doesn't match Vercel's file-based routing convention** (`vercel.json` only rewrites `/api/(.*)`). Whether this is reachable in production could not be confirmed from source — verify directly against the deployment before assuming wallet crediting works. |

## Third-Party API Integrations

| Service | Used by | Notes |
|---|---|---|
| **Anthropic API** (`api.anthropic.com/v1/messages`) | CareFind's `lib/reviewAI.js` | Calls the API with only a `Content-Type` header — missing the `x-api-key`/`anthropic-version` headers Anthropic requires. Likely non-functional as written; needs live verification. **CareHub has an identically-named, identically-purposed `lib/reviewAI.js` that is a 0-byte empty stub** — the same feature was planned for both products and built in only one. |
| **Paystack** (`api.paystack.co`) | CareFind's `api/initiate-payment.js` + `paystack-webhook.js` | The best-built external integration in either product. |
| **OpenStreetMap Nominatim** (reverse geocoding) | CareHub's `LiveActivity.jsx` (`reverseGeocode`) | Called on every logged field activity, no caching, no rate-limiting — risks hitting Nominatim's usage policy under volume. |
| **PDF.js, loaded from `cdnjs.cloudflare.com`** | CareFind's `SlideUploader.jsx` | Injected via a dynamic `<script>` tag at runtime — not a declared dependency in `package.json`, will fail silently offline or under a restrictive CSP. |

## A Positive Finding Worth Stating Plainly

`SUPABASE_SERVICE_ROLE_KEY` — the credential that actually matters for Supabase security, since it bypasses RLS entirely — is handled correctly everywhere it's used: read via `process.env.*` inside Vercel serverless functions only, never hardcoded and never shipped to either client bundle. The hardcoded credential found repeatedly throughout both codebases is the **anon key**, which is designed to be public in Supabase's model (its safety depends entirely on RLS policies, not on keeping it secret). The real open question is not "why is this key exposed" but "is RLS actually configured" — see `06-database.md` and `architecture/Security-Risks.md` Finding #1.

## What's Missing From This "API Layer" Entirely

- No authentication token attached to any data request in CareHub (anon key only) — expected for Supabase's model, but only safe if RLS policies exist, which could not be confirmed from either repository.
- No server-side input validation on any write path in either product.
- No idempotency keys on any write except the Paystack webhook.
- No API-level rate limiting anywhere.
- No shared request/response typing (no TypeScript, no JSON schema, no generated client).

This is the direct downstream consequence of the "no backend" architectural choice documented in `02-architecture.md` — there is very little "layer" here at all; it is almost entirely direct-to-database access from the browser.
