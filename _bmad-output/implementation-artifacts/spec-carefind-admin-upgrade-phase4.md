---
title: 'CareFind Admin Upgrade - Phase 4: AI Copilot Intelligence'
type: 'feature'
created: '2026-09-16'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'b11b739474a6f8a36eca70d4da7f7fb5e38b72fb'
context:
  - apps/carefind/src/lib/adminAiQuery.js
  - apps/carefind/src/modules/admin/AdminAiCopilot.jsx
  - apps/carefind/src/modules/admin/AdminPanel.jsx
  - apps/carefind/src/modules/admin/lib/priorityScoring.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The admin AI copilot is a basic pattern-matching system that queries the database directly via anon-key Supabase client. It lacks intelligence: no sentiment analysis, no automated moderation suggestions, no contextual recommendations, and no ability to learn from admin actions. This limits its utility as a真正的 copilot.

**Approach:** Upgrade the AI copilot to provide intelligent assistance: add sentiment analysis on reported posts, generate moderation recommendations based on historical patterns, provide contextual suggestions based on admin behavior, and implement a feedback loop where admin actions improve future recommendations. Route all queries through service-role API to fix RLS bypass.

## Boundaries & Constraints

**Always:** All database queries must route through `callAdminAuth` with service-role key (existing RLS bypass pattern). Sentiment analysis must be deterministic (no external AI APIs). Recommendations must be explainable (admin can see why suggestion was made). All copilot interactions must be logged in audit trail.

**Ask First:** Whether to use client-side sentiment analysis (regex-based) or server-side (more accurate but requires Edge Function). Whether to implement learning from admin actions (complex) or keep static rules (simpler).

**Never:** Never use external AI APIs (OpenAI, etc.) for sentiment analysis — keep it self-contained. Never expose raw database queries to the copilot. Never allow copilot to execute destructive actions without confirmation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sentiment analysis | Post content with negative sentiment words | Sentiment score + category (toxic, harassment, spam) + confidence | Fallback to neutral if analysis fails |
| Moderation recommendation | Reported post with sentiment score | Action recommendation (approve, warn, ban) + reasoning | Show "insufficient data" if no historical pattern |
| Contextual suggestion | Admin's recent actions | Next action suggestion based on pattern | Show generic suggestions if no pattern detected |
| Feedback loop | Admin accepts/rejects suggestion | Update suggestion weights for future | Log feedback but don't break on error |

</frozen-after-approval>

## Code Map

- `apps/carefind/src/lib/adminAiQuery.js` -- Main query parser and executor; needs sentiment analysis and recommendation engines added
- `apps/carefind/src/modules/admin/AdminAiCopilot.jsx` -- UI component; needs suggestion display, feedback mechanism, and contextual help
- `apps/carefind/src/modules/admin/AdminPanel.jsx` -- Parent component; needs to pass admin action history to copilot
- `apps/carefind/src/modules/admin/lib/priorityScoring.js` -- Existing scoring; can be extended for sentiment scoring
- `apps/carefind/api/_handlers/admin-auth.js` -- Backend; needs new endpoints for sentiment analysis and recommendations

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/src/lib/adminAiQuery.js` -- Add sentiment analysis engine with regex-based toxicity detection, add recommendation engine based on historical patterns, fix all queries to use service-role API via callAdminAuth
- [x] `apps/carefind/src/modules/admin/AdminAiCopilot.jsx` -- Add sentiment analysis display, recommendation cards with reasoning, feedback buttons (thumbs up/down), contextual suggestions based on current tab
- [x] `apps/carefind/src/modules/admin/AdminPanel.jsx` -- Pass admin action history to copilot, log copilot interactions in audit trail
- [x] `apps/carefind/api/_handlers/admin-auth.js` -- Add `analyze_sentiment` endpoint, add `get_recommendations` endpoint, add `log_copilot_feedback` endpoint
- [x] `apps/carefind/src/lib/adminAiQuery.js` -- Add new query patterns for sentiment analysis ("analyze this post", "what's the sentiment"), add patterns for recommendations ("what should I do next", "suggest action")

**Acceptance Criteria:**
- Given a reported post with toxic content, when admin asks "analyze this post", then copilot returns sentiment score (0-1), category (toxic/harassment/spam), and confidence level
- Given admin has approved 5 posts in a row, when admin opens copilot, then copilot suggests "You might want to approve the next post" with reasoning
- Given admin rejects a suggestion, when checking audit log, then copilot feedback is logged with timestamp and reasoning
- Given admin is on Reports tab, when copilot opens, then contextual suggestions include "Show pending reports" and "Analyze top reported post"
- Given sentiment analysis fails, when admin asks for analysis, then copilot returns "Unable to analyze sentiment" with fallback to manual review suggestion

## Spec Change Log

## Design Notes

**Sentiment Analysis Engine:** Use regex-based toxicity detection with weighted word lists. Categories: toxic (profanity, threats), harassment (personal attacks, bullying), spam (promotional content, links). Score 0-1 based on density of toxic words relative to post length. This is deterministic and doesn't require external APIs.

**Recommendation Engine:** Track admin actions in memory (last 50 actions). Pattern detection: if admin approved 3+ posts in a row, suggest continuing. If admin rejected a post from user X, suggest checking other posts from same user. Recommendations are ephemeral (not persisted) to avoid complexity.

**Feedback Loop:** When admin accepts/rejects a suggestion, log it with reasoning. Use this to adjust suggestion weights (e.g., if admin always rejects "approve next post" suggestions, reduce weight of that pattern). Keep weights in memory (not database) to avoid complexity.

## Verification

**Commands:**
- `npx vite build` -- expected: build succeeds with no errors
- Manual: Create a post with toxic content, ask copilot to analyze it, verify sentiment score and category are returned
- Manual: Approve 5 posts in a row, open copilot, verify contextual suggestion appears
- Manual: Reject a suggestion, check audit log, verify feedback is logged
- Manual: Navigate to Reports tab, open copilot, verify contextual suggestions include report-related actions

**Manual checks (if no CLI):**
- Copilot queries route through service-role API (check network tab for admin-auth calls)
- Sentiment analysis is deterministic (same input always produces same output)
- Recommendations are explainable (admin can see why suggestion was made)
- All copilot interactions are logged in audit trail

## Suggested Review Order

**Sentiment analysis engine**

- Regex-based toxicity detection with weighted word lists
  [`admin-auth.js:1086`](../../apps/carefind/api/_handlers/admin-auth.js#L1086)

**Query routing fix**

- All queries now route through callAdminAuth with service-role key
  [`adminAiQuery.js:14`](../../apps/carefind/src/lib/adminAiQuery.js#L14)

**New query patterns**

- Sentiment analysis and recommendation query patterns
  [`adminAiQuery.js:300`](../../apps/carefind/src/lib/adminAiQuery.js#L300)

**Recommendation engine**

- Context-aware suggestions based on tab and action patterns
  [`admin-auth.js:1150`](../../apps/carefind/api/_handlers/admin-auth.js#L1150)

**Copilot UI upgrade**

- Sentiment cards, recommendation cards, feedback buttons
  [`AdminAiCopilot.jsx:1`](../../apps/carefind/src/modules/admin/AdminAiCopilot.jsx#L1)

**Integration**

- Admin action history tracking and copilot props
  [`AdminPanel.jsx:164`](../../apps/carefind/src/modules/admin/AdminPanel.jsx#L164)

**Feedback loop**

- Copilot feedback logging to audit trail
  [`admin-auth.js:1200`](../../apps/carefind/api/_handlers/admin-auth.js#L1200)
