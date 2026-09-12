---
title: 'Show News preview engagement controls and fix comment save/display'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_commit: 'ece4a51421e8b078ad92a8dfbe88890dcc6a8000'
review_loop_iteration: 0
context:
  - 'apps/carefind/src/modules/news-publishing/News.jsx'
  - 'apps/carefind/src/modules/news-publishing/NewsArticle.jsx'
  - 'apps/carefind/src/styles/global.css'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** News preview hides Like/Comment/Share/Repost until article opened and scrolled; commenting appears unreliable — submitted comments may not save/display and counts don’t update, while preview has no engagement row at all.

**Approach:** Show engagement controls directly on News preview/card (above fold, visually clean) using same `.cf-eng-row` as article, and make comment flow reliable (save, display, count update, error feedback) with like/share/repost parity.

## Boundaries & Constraints

**Always:** Keep `cf-eng-row` / `global.css:166` shared styles; keep `news_reactions`/`news_comments`/`news_reposts`/`saved_news` tables and RLS; keep `loadEngagement` source of truth (`Promise.all` reactions/comments/reposts + saved).

**Ask First:** Adding `UNIQUE (news_id,user_id,content)` or rate-limit for comments; making preview engagement fully interactive before publish (vs disabled with “Publish to enable”).

**Never:** Hide interaction row until scroll; silently swallow insert errors; allow double-tap duplicate comments without guard.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Preview visible | Open News preview (draft or published card) | Engagement row Like/Comment/Share/Repost visible without scrolling | If draft `news_id` null, counts 0 and buttons disabled with tooltip “Publish to enable” |
| Like | Tap Like on preview/article | Count increments, `aria-pressed` toggles, persists | Network fail → rollback + toast |
| Comment | Type and Post comment | Comment appears immediately, count updates, survives reload | Insert fail → toast error, draft kept, no wipe; re-select fail → toast |
| Comment anon | Not logged in taps Comment | Shows “Log in to comment” CTA (not disabled input) → `/login` | No silent fail |
| Share/Repost | Tap Share/Repost | Functions correctly, repost count updates | Error → toast + rollback |

</frozen-after-approval>

## Code Map

- `apps/carefind/src/modules/news-publishing/News.jsx:279-302` -- `previewing` branch has no `.cf-eng-row` (only `ArticleEditor readOnly` + `■` + Submit); must insert `div.cf-eng-row` between body and submit, same markup as `NewsArticle.jsx:363`, disabled when `news_id` null.
- `apps/carefind/src/modules/news-publishing/NewsArticle.jsx:363-432,443-470` -- real article engagement row `cf-eng-row` with Like `365`, Comment toggle `376`, Share `387`, Repost `392`, Save `422`, meta `406`; comment panel `443` input `447` `disabled={!user}` + `addComment:176` (insert then re-select), `deleteComment:189`; must add error toasts, `postingComment` guard, Login CTA for anon.
- `apps/carefind/src/styles/global.css:166-218` -- `.cf-eng-row/.cf-eng-group/.cf-eng-item/.cf-eng-meta` shared; keep.
- `apps/carefind/src/modules/news-publishing/newsArticle.test.jsx:1-360` -- existing 13 cases for view/like/comment/repost/share; extend with preview row.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/src/modules/news-publishing/News.jsx` -- add preview engagement row: inside `previewing` branch (between `ArticleEditor readOnly 293` and `■ 296`), render `div.cf-eng-row` with same structure as `NewsArticle.jsx:363` (Like/Comment/Share/Repost, counts 0 when draft), `borderTop/Bottom theme.border`, `padding 4px 18px`, `margin 8px 0` so visible without scroll; when `!newsId` disable handlers with tooltip “Publish to enable engagement”.
- [x] `apps/carefind/src/modules/news-publishing/NewsArticle.jsx` -- fix comment reliability: in `addComment:176`, handle `insert error` → `toast.show(error.message)` and return (keep draft); add `postingComment` state, disable Post button while posting, handle re-select error (toast, not wipe); in `deleteComment:189` save `prev` and rollback on error; replace `disabled={!user}` input `447` with conditional `!user ? <Link to="/login">Log in to comment</Link> : input`; keep `commentsOpen` persistence and Like/Share/Repost existing optimistic logic.
- [x] `apps/carefind/src/modules/news-publishing/newsArticle.test.jsx` + `News.test.jsx` -- tests: preview renders engagement row without scroll; Like increments; Comment Post appears immediately and count updates, persists after reload mock, insert error shows toast and keeps draft, anon shows Login CTA.

**Acceptance Criteria:**
- Given News preview open, when viewing, then engagement row Like/Comment/Share/Repost is visible without scrolling
- Given Like tapped on preview/article, when succeeded, then count increments and `aria-pressed` toggles; on fail rolls back with toast
- Given Comment typed and Post clicked, when succeeded, then comment appears immediately, count updates, and remains after reload/reopen
- Given anon taps Comment, when not logged in, then “Log in to comment” CTA shown (not silent disabled input)

## Spec Change Log

## Design Notes

Use existing `.cf-eng-row` CSS from `global.css:166`; keep preview visually clean (no overcrowding) but not hidden. Comment input `Post` disabled while `postingComment` prevents duplicate `UNIQUE` spam; no new DB constraint needed per `Ask First`.

## Verification

**Commands:**
- `npm test -- src/modules/news-publishing/newsArticle.test.jsx src/modules/news-publishing/News.test.jsx` -- expected: preview engagement visible, Like/Comment/Share/Repost work, comment appears and persists, error toast, Login CTA
- `npm run build` (apps/carefind) -- expected: vite build clean

## Suggested Review Order

**Preview — engagement above fold**

- `previewing` branch inserts `div.cf-eng-row` between body and `■` with disabled tooltip when draft
  [`News.jsx:279`](../../apps/carefind/src/modules/news-publishing/News.jsx#L279)

- Shared `cf-eng-row` styles kept
  [`global.css:166`](../../apps/carefind/src/styles/global.css#L166)

**Article — comment reliability**

- `addComment` error toast + `postingComment` guard + re-select handling
  [`NewsArticle.jsx:176`](../../apps/carefind/src/modules/news-publishing/NewsArticle.jsx#L176)

- `deleteComment` rollback on error, anon `Log in to comment` CTA
  [`NewsArticle.jsx:189`](../../apps/carefind/src/modules/news-publishing/NewsArticle.jsx#L189)

- Like/Save optimistic with rollback + toast
  [`NewsArticle.jsx:121`](../../apps/carefind/src/modules/news-publishing/NewsArticle.jsx#L121)

**Tests**

- Preview row visible + Like/Comment immediate + error/Login CTA
  [`News.test.jsx:1`](../../apps/carefind/src/modules/news-publishing/News.test.jsx#L1)
