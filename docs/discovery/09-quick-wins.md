# 09 — Quick Wins (1–2 Days)

Everything on this list is independently shippable, requires no design discussion, and touches a small, well-understood blast radius. None of these require the larger authentication rework covered in `10-roadmap.md`'s Short-Term/Medium-Term phases.

## Verify first (hours, not days — do these before anything else)

1. **Confirm or rule out the `consultations` table collision** against the live Supabase schema. Changes the urgency of a large amount of downstream work depending on the answer.
2. **Confirm whether `paystack-webhook.js` is reachable in production**, given it sits outside CareFind's `api/` directory.
3. **Reproduce the `Locations.jsx` "Switch to this branch" crash** (`setAuth` is not provided by `AuthContext`).
4. **Confirm whether CareFind's `lib/reviewAI.js` Anthropic call currently succeeds** in production.

## Genuine one-line-to-half-day fixes

5. Rotate or remove CareFind's `api/admin-setup.js` exposure (change the fallback key at minimum; ideally remove the endpoint once bootstrap is no longer needed).
6. Fix `Locations.jsx`'s `setAuth` crash once confirmed (either expose `setAuth` from `AuthContext` or change the call site to use `login()`).
7. Fix `Modal`'s footer CSS bug (`borderBottom` → `borderTop` in `components/ui/index.jsx`) — affects every modal with a footer in CareHub.
8. Consolidate the 5 duplicate `readAuth()` implementations into one shared helper.
9. Remove the stray accidentally-created directory in `apps/carefind/carefind-main/src/lib/`.
10. Fix or delete `OfflineBanner` (currently dead and would crash on mount).
11. Delete confirmed dead code: CareFind's `App.jsx`, `searchClients`, `getLabResults` (or wire the latter into a real view first — see `08-technical-debt.md`).
12. Replace the stale `skincarepro.vercel.app` branding/links in `lib/email.js`'s staff welcome email with the correct CareHub domain.
13. Replace `VisualCard.jsx`'s hand-built logo mark with `<Logo markOnly/>`.
14. Write `.env.example` for both apps, enumerating every `process.env.*` reference found across the serverless functions and client code.

## Half-day to two-day fixes (still no architecture change)

15. Wire `updateProduct()` into `POS.jsx`'s `charge()`/`chargeCredit()` so a sale actually persists its stock decrement (the single highest-impact item on this list relative to its effort).
16. Give Doctor's Disposition selector (Admit/Refer/Emergency Transfer) somewhere real to write, instead of having no effect on `patients.status`.
17. Fix `Register.jsx`'s dead "Years in Business"/"Staff Count" fields — either submit them or remove them from the form.
18. Add an `updateExpense` function for parity with every other financial-record domain (Debts, Purchases, Sales all support updates; Expenses doesn't).
19. Add a confirmation-owning prop to `RedBtn` instead of four independently-worded `window.confirm()` calls at its call sites.

None of these require touching authentication, RLS, or the database schema — they're safe to schedule immediately and independently of the larger roadmap in `10-roadmap.md`.
