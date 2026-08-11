# Business Profiles & Reviews — Business Domain

## Purpose
Public-facing business listing pages on CareFind, including patient/user-submitted star ratings and comments, AI- and rule-based sentiment analysis of those reviews, and per-product listings drawn from CareHub's inventory.

## Files
`apps/carefind/carefind-main/src/BusinessProfile.jsx` (347 lines), `lib/sentiment.js` (78 lines), `lib/reviewAI.js` (54 lines).

## Components
`BusinessProfile.jsx` is a single component covering the business header, product list, rating breakdown, sentiment summary, and a review-submission form.

## Services
`lib/sentiment.js`: fast, non-AI positive/neutral/negative bucketing and common-theme extraction over already-fetched review rows. `lib/reviewAI.js`: sends review text to the Anthropic API (`claude-sonnet-4-6`) for structured side-effect/efficacy/sentiment extraction — the fetch call as written includes only a `Content-Type` header, not the `x-api-key`/`anthropic-version` headers the Anthropic API requires.

## Dependencies
`lib/supabaseClient.js`, `lib/AuthContext.jsx` (review submission requires a logged-in user).

## Database Tables
Reads `businesses`, `products` (CareHub-owned, filtered `list_on_carefind`), `profiles` (for reviewer names, fetched in a separate query "so it works without a FK join," per an inline comment). Reads/writes `reviews` (`business_id, user_id, rating, comment, created_at`) — entirely CareFind-owned, no CareHub awareness.

## Current State
Business display, product listing, review submission, star-rating aggregation, and both sentiment features are implemented. `lib/reviewAI.js`'s Anthropic call appears to be missing required authentication headers, so whether the AI-powered analysis currently functions in production could not be confirmed from source alone. **Notable cross-product echo**: CareHub has an identically-named, identically-purposed `lib/reviewAI.js` that is a 0-byte empty file — the same feature was evidently planned for both products and built in only one.

## Missing Documentation
No document confirms whether the Anthropic integration is live and working in production, or explains the missing auth headers (a proxy or additional header injection elsewhere would need to exist for this to function as deployed). No document records the CareHub/CareFind `reviewAI.js` naming echo or clarifies whether CareHub's side was ever meant to be built out to match CareFind's.
