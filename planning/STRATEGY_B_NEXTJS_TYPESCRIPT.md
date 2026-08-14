# Strategy B — Next.js + TypeScript Re-Platform

Status: **proposal, not yet adopted.** Documentation only — no code changed producing this. This is an intentionally *different* strategy from `planning/roadmap.md` ("Strategy A"), requested explicitly to explore a framework/language/security/UX shift rather than the incremental in-place hardening Strategy A describes. Read `planning/roadmap.md` first — this document assumes that context and does not re-derive it.

**Read this framing before the rest of the document:** `.claude/CLAUDE.md` is explicit — "Never recommend a rewrite simply because the existing code is imperfect," "Do NOT rewrite the entire application unnecessarily," "Preserve business knowledge whenever possible." Nothing found during Strategy A's discovery work justifies a rewrite on *correctness* grounds — the security and data-integrity work is real, live, and verified. **This strategy is justified only if you want capabilities the current stack structurally cannot give you** (server-enforced security boundary, compile-time schema safety, SEO for CareFind, edge-native deployment) **enough to pay for a second migration on top of the one already in progress (the repository-seam rollout).** §9 gives an honest cost/benefit and a recommendation that is not "rewrite everything."

---

## 1. Why this is a genuinely different strategy, not a bigger version of Strategy A

Strategy A optimizes the current architecture: Vite SPA + hand-rolled `sbFetch()` + client holding the anon key + RLS as the sole security boundary + JS with no compile-time contract to the database. It is the right call if the goal is "hunt down every case where this pattern was applied insecurely" — which is exactly the last several months of work here.

Strategy B changes the *shape* of the boundary instead of continuing to audit the existing one:

| | Current (both apps) | Strategy B |
|---|---|---|
| Where privileged logic runs | In the browser, talking directly to PostgREST with the anon key; RLS is the only thing standing between a malicious request and the data | On the server (Next.js Server Actions / Route Handlers), which can hold the service-role key and enforce business rules *before* Postgres is ever touched — RLS becomes a second line of defense, not the only one |
| Schema-to-code contract | None — every `sbFetch('products?business_id=eq.'+id)` string is trusted to be correct at runtime only | Generated TypeScript types from the live schema (`supabase gen types typescript`) — a renamed column or wrong filter shape is a compile error, not a production incident discovered later |
| Auth session storage | JWT/session object in `localStorage` (both apps) | httpOnly, server-set cookies via `@supabase/ssr` — not readable by any client-side JS, closing an XSS-to-account-takeover path that exists today in principle |
| Route protection | Client-side check after mount (`guard()` wrapper, `RequireAuth.jsx`) — a flash of protected content or a race is possible before the redirect fires | `middleware.ts` — runs *before* any page code executes, on the edge |
| Public discovery pages (CareFind) | Client-rendered SPA — effectively invisible to search engines, no meaningful SEO | Server-rendered / statically generated business & drug profile pages — CareFind's actual product category (a marketplace/discovery platform) depends on being indexable, and today it structurally cannot be |
| Bundle/perf | One eagerly-loaded >1.4MB chunk (CareHub) | Automatic per-route code splitting, streaming, image optimization — native to the framework instead of something to opt into manually |

This is a real architectural fork, not a superset — hence a separate document.

---

## 2. Framework: Next.js (App Router)

**Recommendation: adopt Next.js 14/15 App Router, not Pages Router.** React Server Components + Server Actions are what make the security argument in §3 possible; Pages Router would give you routing and SSR but not the privileged-server-boundary benefit, which is the strongest reason to move at all.

**Per-app framing — this is not one decision, it's two:**

- **CareFind is the strong case.** It is a public discovery/marketplace product (`docs/PROJECT_OVERVIEW.md`) whose core job — being found by someone searching for a pharmacy or a drug near them — is actively undermined by being a client-rendered SPA today. Business profile pages, drug profile pages, and search results are exactly the pages that should be server-rendered/statically generated with proper `<head>` metadata, sitemaps, and structured data (schema.org `LocalBusiness`/`Pharmacy`). Nothing in the current Vite SPA can deliver that without bolting on a separate prerendering tool.
- **CareHub is a weaker case, argued on different grounds.** It's an authenticated internal dashboard — SEO is irrelevant. The case there is the security-boundary shift (§3) and bundle-size/perf (route-based code splitting instead of one eager chunk), which are real but not as urgent as CareFind's SEO gap, and CareHub is also the app with the most in-flight work (16/24 modules mid-migration on the repository seam). Moving CareHub's framework *while* that migration is still active is the highest-risk combination in this whole document — see §9.

**Concrete shape:**
- `app/(public)/business/[slug]/page.tsx` — server component, fetches via a typed repository, renders SSR/ISR (revalidate on a timer or on-demand via a webhook from CareHub when a business updates its profile).
- `app/(auth)/dashboard/**` — protected route group, guarded by `middleware.ts` checking the Supabase session cookie before any nested layout runs.
- Server Actions (`'use server'` functions) replace both `services/supabase.js`'s direct-write functions and the ad hoc `api/admin-auth.js` action-dispatch pattern — one colocated, typed function per mutation instead of a growing `switch` statement in a single file.
- Route Handlers (`app/api/**/route.ts`) replace the scattered Vercel `api/*.js` files for webhook receivers (Paystack) and anything needing a raw HTTP contract.

---

## 3. Security Strategy

This is the part of Strategy B that most directly answers "different from the existing approach." The existing approach (Strategy A, and everything shipped to date) is: **client holds the anon key, RLS is the enforcement boundary, verify behaviorally after every change.** That approach works — it is, at this point, well-tested here — but it means every new feature is only as safe as the RLS policy someone remembers to write correctly, and this project's own history (C14, C18, C19 — three separate incidents of an RLS policy silently not doing what its author believed) is the evidence for why that is a fragile place to put the *only* line of defense.

**Strategy B's model: defense in depth, with the first line of defense moved server-side.**

1. **Server Actions/Route Handlers as the mandatory front door for every write.** The client never sends a raw PostgREST mutation. A Server Action validates input (Zod schema, see below), checks the caller's session and business membership *in application code*, and only then performs the write — optionally via the service-role key for operations that need to bypass RLS deliberately (e.g., cross-tenant admin actions), or via a request-scoped client carrying the user's session for everything else. This is the same shape `api/admin-auth.js` already backed into by necessity (service-role client behind a server boundary) — Strategy B generalizes that pattern to the entire app instead of just the admin surface.
2. **RLS stays on, unchanged, as the second line.** Nothing in Strategy B proposes removing or weakening RLS — that would violate the project's own non-negotiable ("never weaken authentication/permissions"). A bug in a Server Action's authorization check still hits a real, tested policy at the database. This is strictly additive safety, not a trade.
3. **Cookie-based sessions via `@supabase/ssr`**, not `localStorage`. Closes the class of risk where any XSS anywhere in the app (a stored review, a chat message, a product description rendered unsafely) could read a session token directly out of storage. httpOnly cookies are not readable by page JavaScript at all.
4. **`middleware.ts` for route protection**, replacing the client-side `guard()`/`RequireAuth` pattern. A protected page's *code* — not just its rendered output — never runs for an unauthenticated request. This closes the theoretical flash-of-content/race-condition gap in the current pattern (which itself was a real, deliberate H3 fix — Strategy B doesn't call H3 wrong, it closes the residual gap a client-side check structurally cannot).
5. **Shared Zod schemas** (in a `packages/types` or `packages/validation` package) as the single validation definition, run in the Server Action *and* re-used client-side for instant form feedback — one definition, not the client-then-server duplication the original brief called for as an aspiration (§16) but that never got built here.
6. **Rate limiting at the edge** (Vercel middleware + Upstash Redis, or Vercel's built-in) on `/login`, `/register`, and password-adjacent endpoints — this does not exist anywhere in the current stack and is a real, currently-open gap independent of which framework you choose (worth doing even if Strategy B is rejected — see §9's "cherry-pick" recommendation).
7. **Generated types close a specific, recurring bug class in this project's own history.** H10 (positional `Promise.all` destructuring bug), the `getStaffClaims` missing-`!inner` bug, the `sales.items` jsonb-vs-array ambiguity, several "column doesn't exist" `PGRST204` errors from schema drift — every one of these is a category `tsc --noEmit` in CI would have caught before merge, given types generated from the live schema rather than hand-maintained.
8. **Secrets**: service-role key lives only in Next.js server runtime env vars, never bundled — mechanically enforced by the framework (anything not prefixed `NEXT_PUBLIC_` is server-only by construction), rather than relying on developer discipline the way "don't put the service key in a Vite `import.meta.env.VITE_*` var" currently does.

**What this does *not* change:** the tenancy model (`business_id` scoping), the RLS policies themselves, or the Supabase project. This is a strategy about *where enforcement additionally happens*, not a data-model rewrite.

---

## 4. TypeScript Strategy

Strategy A explicitly recommended *against* a blanket TypeScript migration of the existing JS codebase — that recommendation stands for the existing codebase, because a partial retrofit onto ~50k+ lines of working JS creates exactly the two-dialect confusion the project's own coding philosophy warns against, for a payoff that's diffuse and slow.

**Strategy B is different because it's not a retrofit — it's the native mode of a rebuilt app**, and in that context TypeScript is close to a default choice, not an optional add-on:

- `supabase gen types typescript --project-id szdybxmgmhndoytqanfb` generates a `Database` type from the live schema. Every repository function becomes `(businessId: string) => Promise<Product[]>` with `Product` derived from the actual table, not a shape someone remembers correctly.
- This directly targets the project's own recurring bug shape: schema drift between what the app assumes and what the live database actually has (the requisition/`out_of_stock` drift, the master-catalog gate, several `PGRST204` incidents in `CODE_AUDIT.md`) becomes a build-time failure — `npm run build` fails locally, not a support ticket three weeks later.
- Zod schemas (§3) double as runtime validation *and* can derive their TS types (`z.infer<>`), so the "client validates for UX, server validates for correctness" split from the original brief (§16) is one schema, not two independently-maintained ones.
- Strict mode from day one (`strict: true`, no `any` in new code, `noUncheckedIndexedAccess`) — cheap to enforce in a greenfield app, expensive to retrofit later, so this is the one place "do it right from the start" actually pays for itself.

**Scope discipline, consistent with Strategy A's original caution:** TypeScript applies to whatever is rebuilt under Strategy B (a Next.js CareFind, and later CareHub if you go that far). It does not mean stopping to type-annotate the existing Vite/JS codebase in place — that remains explicitly out of scope, for the same reasons Strategy A gave.

---

## 5. UI/UX Strategy

The existing design system (`docs/design/*.md`, 18 documents) is genuinely complete and consistent — every screen in both products was rebuilt to it, verified responsive, zero gradients/emoji left. **Strategy B does not propose discarding that visual language.** It proposes changing *how* it's implemented, because a framework move is the one moment doing so is nearly free (you're rewriting the component tree anyway).

- **Tailwind CSS + shadcn/ui**, configured from the *existing* design tokens (`docs/design/COLORS.md`, `SPACING.md`, `TYPOGRAPHY.md`, `GRID_SYSTEM.md` map directly onto a `tailwind.config.ts` theme) rather than the current per-component inline `style={}` objects. This is a mechanical/tooling change, not a visual redesign — the goal is the same screens, implemented with utility classes and a token-driven theme instead of hand-written style objects repeated per file.
- **shadcn/ui is built on Radix primitives**, which gives keyboard navigation, focus trapping, and ARIA semantics correctly by default for Modal/Dropdown/Tabs/Tooltip/Combobox — closing accessibility gaps (`docs/design/ACCESSIBILITY.md` is aspirational in places today) at the component level instead of needing to hand-verify each one.
- **Streaming + Suspense** for loading states — a data-dependent section of a page can show its own skeleton while the rest of the page is already interactive, which is a materially better "loading state" than the current per-page all-or-nothing pattern, and is close to free with Server Components.
- **Global search / command palette** (brief §24, never built under Strategy A) — `cmdk` is the standard choice, and pairs naturally with a typed repository layer to search across patients/products/staff/appointments from one place.
- **Image optimization** (`next/image`) for the product photos, business logos, and consultation-form uploads that today go straight to Supabase Storage and render unoptimized.
- **Dashboards redesigned around "what needs my attention"** (brief §22) — a genuinely deferred item under Strategy A (§7, Phase 5) that fits naturally into a rebuild rather than a retrofit of existing dashboard pages.

**What does not change:** color palette, typography choices (system stack + Lora for CareFind news, per `docs/design/TYPOGRAPHY.md`), spacing scale, the flat-color-no-gradient rule, icon set (`lucide-react` has a first-class React/Next integration, keep it). The *look* is the validated one; the *implementation* modernizes.

---

## 6. Data & State Strategy

- **Server Components fetch directly** (via the typed repository layer, running server-side) for anything that's read-heavy and doesn't need client interactivity — eliminates a large fraction of the "fetch on mount" waterfalls `architecture/Current-Architecture.md` §5 flags, without needing a client cache at all for those cases.
- **TanStack Query (React Query) for genuinely client-side, interactive, or realtime-adjacent state** — POS's cart, live dashboards, anything using Supabase Realtime subscriptions, optimistic mutations. Not a blanket replacement for RSC data fetching; the two are complementary, and Strategy A's original React Query recommendation (Strategy A §5.2) still applies here, just as one half of a two-part data strategy rather than the whole of it.
- **Server Actions replace ad hoc `fetch()` calls from client components** for every mutation — one typed function call (`await createProduct(formData)`) instead of building a PostgREST request by hand.

---

## 7. Repo & Tooling Strategy

- **Turborepo** (Next.js's own vendor, Vercel) for the monorepo — `apps/carefind` (Next.js), `apps/carehub` (unchanged Vite, or migrated later), `packages/types` (generated Supabase types + Zod schemas), `packages/ui` (shared shadcn/ui-based components + design tokens), `packages/config` (shared `tsconfig`, `eslint`). This gives cached, parallelized builds across apps — directly useful once CI exists (Strategy A §7 Phase 6).
- **ESLint + `typescript-eslint`**, strict config, as a CI gate from day one of the new app — cheap now, expensive to introduce onto an existing large codebase later.
- **Vitest still works under Next.js** (via `@vitejs/plugin-react` + Next's SWC where needed) — no need to switch test runners; add Playwright for E2E as Strategy A already recommends.
- **`tsc --noEmit` as its own CI step**, separate from the test run, because it catches a different class of error (the schema-drift class in §4) faster than a test suite would.

---

## 8. Migration Strategy — Strangler Fig, Not Big Bang

Consistent with the project's own explicit instruction (`.claude/CLAUDE.md`: "prefer progressive migration... do not perform a giant rewrite"), Strategy B is not "stop, rewrite both apps, resume." Concrete sequencing:

**Phase B0 — Pilot on CareFind's public surface only** (the strongest, lowest-risk case from §2):
1. New Next.js app (`apps/carefind-next` or similar), deployed to a *different* Vercel project/subdomain initially.
2. Build only the public, unauthenticated pages first: business profile, drug profile, search/discovery. These are read-heavy, don't touch the wallet/payment/social-feed surface (the highest-risk part of CareFind), and are exactly the pages that benefit most from SSR/SEO.
3. Point a subset of traffic at it (e.g., via a reverse-proxy rule or DNS split) once it's verified against the live schema, while the existing Vite CareFind keeps serving everything else (auth, feed, wallet, admin) unchanged.
4. Only after the public surface is proven in production does the migration move to authenticated CareFind features (feed, wallet, live-streaming) — and only if B0's results justify continuing (§9).

**Phase B1 — CareHub, only after B0's lessons are in and only if warranted:**
CareHub's case for Next.js is weaker (§2) and it is mid-migration on a different, already-valuable workstream (the repository-seam rollout, Strategy A Phase 3). **Recommendation: do not start a CareHub framework migration until the repository-seam rollout is either finished or deliberately paused by a real decision, not by drift.** Running two large structural migrations on the same app concurrently is how projects lose track of what state anything is in — a risk this project's own history (the C16 "untracked direct change" incidents) shows it is specifically vulnerable to.

**Coexistence rules for however long two stacks run side by side:**
- Both talk to the same Supabase project — no schema fork, ever.
- Auth: either keep both on Supabase Auth (interoperable, since both would issue standard Supabase sessions) or accept a short window where a user might need to re-authenticate crossing between the old and new surface — do not build a bridge auth system just for the transition.
- One source of truth per table for writes during the transition — do not let both the old and new app write to the same table through different validation paths simultaneously; migrate a table's writes wholesale when its owning feature moves, mirroring exactly the discipline the repository-seam rollout already uses ("full retirement," not "leave the old path for stragglers").

---

## 9. Honest Cost/Benefit and Recommendation

**This is a second major structural migration proposed on top of one (the repository-seam rollout) that is already 16/24 modules in and has an excellent track record.** That is a real cost, not a footnote: context-switching engineering effort away from a workstream that is actively finding and fixing real bugs, onto a new one, has an opportunity cost measured in the bugs the seam rollout *would have* found in its remaining 8 modules but now finds later, or not at all.

**Recommendation, in three parts:**

1. **Adopt the cheap, high-value pieces of Strategy B immediately, independent of any framework decision:**
   - Generate Supabase TypeScript types and start using them anywhere new code touches the schema (even inside the existing JS repositories, via JSDoc `@type` annotations if a full `.ts` file conversion is out of scope) — closes real, recurring bugs for near-zero cost.
   - Add rate limiting to `/login`/`/register` on the current stack — a Vercel Edge Middleware or Upstash-backed check, no framework change required.
   - Add Zod validation to the highest-risk existing forms (registration, POS checkout, wallet operations) even before any rewrite — the validation-schema idea does not require Server Actions to be useful.
2. **Run the CareFind public-pages pilot (Phase B0) as a real, scoped experiment** — it has the strongest, least-disputable case (SEO is not achievable any other way on the current stack) and the smallest blast radius (unauthenticated, read-only pages, a separate deploy). Treat it as a genuine pilot with a decision point at the end, not a foregone conclusion that the rest follows.
3. **Do not start CareHub's framework migration now.** Finish the repository-seam rollout (Strategy A Phase 3) first — it is close to done, has direct evidence of ongoing value, and combining it with a framework migration is the highest-risk sequencing available. Revisit a CareHub Next.js migration as a deliberate decision once Phase B0's results are in and Phase 3 is closed.

This keeps Strategy A's roadmap as the primary, active plan; treats Strategy B as validated in the one place its case is strongest; and captures the parts of Strategy B (typed schema, validation, rate limiting) that are worth having regardless of the framework question.

---

## 10. Risk Register (Strategy-B-specific, additive to `planning/roadmap.md` §8)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Running two frameworks/stacks in parallel for CareFind during B0 causes confusion about which app owns which route | Medium | Broken links, duplicated maintenance | Explicit routing table documented before B0 starts; strangler-fig cutover per route, not per feature guess |
| Team effort split between the repository-seam rollout and a new Next.js build slows both | High if both are staffed simultaneously | Neither workstream finishes cleanly | §9's sequencing recommendation — do not run both as primary efforts at once |
| Generated Supabase types drift from the live schema if migrations remain untracked (Strategy A §4.3's gap) | High until that gap is closed | Type safety becomes a false sense of security — types describe a schema that no longer matches production | Formalizing migrations-as-code (already recommended in Strategy A) is a *prerequisite* for this strategy's type-safety benefit to be trustworthy, not a nice-to-have alongside it |
| A "pilot" quietly becomes a full rewrite by momentum rather than decision | Medium | Loss of the incremental discipline this project has otherwise maintained well | Treat §9's phase boundaries as real decision gates requiring explicit go-ahead, matching the project's existing practice for every other hard-to-reverse step |
| SEO benefit doesn't materialize as expected (e.g., low organic search intent for this market/vertical) | Low-medium | B0's strongest justification weakens | This is exactly why B0 should ship and be measured before B1 is even discussed |

---

## 11. Summary Comparison

| | Strategy A (`roadmap.md`) | Strategy B (this document) |
|---|---|---|
| Core move | Finish and harden what exists | Change the security/rendering boundary, starting with CareFind's public pages |
| Risk profile | Low — extends proven, in-flight work | Medium — a second concurrent structural change; mitigated by scoping to a pilot |
| Time to value | Immediate (next migrations, CI, seam rollout continuation) | Weeks for a scoped pilot to prove out; longer if extended to CareHub |
| Best next action | Apply the 5 items in `roadmap.md` §10 | Generate types + add rate limiting/Zod now (free); scope and greenlight the CareFind pilot (Phase B0) as a separate, explicit decision |

**Both documents are meant to be read together.** Strategy A is what continues regardless. Strategy B is what to greenlight, and how much of it, as its own decision.
