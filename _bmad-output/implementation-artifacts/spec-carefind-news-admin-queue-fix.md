---
title: 'Fix News submission reaching Admin queue and approval publish'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_commit: '1024b4756003ba8a5195cfd964206bd706a14668'
review_loop_iteration: 0
context:
  - 'apps/carefind/src/modules/news-publishing/News.jsx'
  - 'apps/carefind/src/modules/admin/AdminPanel.jsx'
  - 'apps/carefind/api/_handlers/admin-auth.js'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** User sees “Under review” after submitting news, but Admin → News queue shows 0 submissions — admin cannot review/approve, so approved news never publishes; no count indicator or notification signals pending news.

**Approach:** Make pending news reliably appear in Admin queue, make approve/reject immediately publish/update status, and surface pending count/notifications, by auditing submission insert, service-role list/approve handlers, RLS, and Admin UI query/count flows.

## Boundaries & Constraints

**Always:** Keep `news.status` vocabulary `pending`/`approved`/`rejected` (not `under_review`/`published`); keep anon-key user insert `author_id=auth.uid()` + service-role admin reads; keep `hero_image_url` optional; keep `profiles.news_last_seen` + `increment_news_view` existing.

**Ask First:** Changing `news` RLS to stricter policies beyond current scoped public `select where status=approved OR author_id=auth.uid()` + insert check; adding email/push notifications for news.

**Never:** Use client anon key for admin list/approve (must be service-role via `admin-auth.js`); allow any authenticated user to approve via direct `supabase.from('news').update`; hide pending behind client-side filter only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Submit news | Valid headline/body/hero + author_id | Row `status=pending` inserted; user sees “Under review”; Admin queue shows 1 pending | Validation fail → inline error, no insert; hero upload fail → still inserts with null hero, shows toast |
| Admin list | Pending rows exist, valid `admin_token` | `list_news` returns `status=pending` rows ordered `created_at desc` with `profiles` join and `author_id` contact fallback | Token expired → 401, Admin UI shows “Session expired, re-login” and 0 is not mistaken for empty queue |
| Approve | Admin approves pending | Row `status=approved`, `published_at=now()`; appears in public `/news` feed `where status=approved`; submitter sees updated status | Approve on already approved → idempotent no error |
| Reject | Admin rejects | Row `status=rejected`; user sees “Not approved” | No publish |
| Count/notify | New pending | Admin News tab badge `News (N)` + bell `totalNotifs` includes pendingNews + notification | No silent zero |
| RLS | Non-author anon | Cannot see others’ pending; can see approved public | 42501 correctly |

</frozen-after-approval>

## Code Map

- `apps/carefind/src/modules/news-publishing/News.jsx:95-144` -- submit handler: `validateArticleForPublish`, hero `news-images` upload, `insert {headline,body:articleBody,hero_image_url,author_id,contact_phone,contact_email,status:'pending'}`; must ensure `author_id=user.id` matches session, errors surfaced, no silent catch.
- `apps/carefind/src/modules/news-publishing/News.jsx:72-80` -- `select ... neq(status,'approved')` for user's Under review strip; keep.
- `apps/carefind/src/modules/admin/AdminPanel.jsx:526-579,853,1702-1778` -- `list_news` via `callAdminAuth`, tab count `filter(status==='pending')`, row render, `approveNews`/`rejectNews`/`deleteNews` calls; add pending to `totalNotifs`/`roleNotifCount`/`notifications`.
- `apps/carefind/api/_handlers/admin-auth.js:20-29,392-429,505-517` -- `verifyToken` 24h, `approve_news`/`reject_news`/`delete_news` service-role updates, `list_news` service-role select with `profiles` join; ensure token verified and errors returned not swallowed to `[]`.
- `apps/carefind/src/modules/news-publishing/newsArticle.test.jsx:1-360` -- existing view/like/comment/repost tests; extend with pending→approved flow.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/src/modules/news-publishing/News.jsx` -- audit submit: ensure `author_id` sent equals `user.id` session, surface `insert` error (toast), keep `heroUrl` fallback on upload fail, keep `status:'pending'` vocabulary, no `under_review`.
- [x] `apps/carefind/api/_handlers/admin-auth.js` -- verify `list_news` service-role select `*,profiles(full_name,display_name)` with `order created_at desc limit 60`, `approve_news` sets `status:'approved',published_at:now()`, `reject_news` sets `rejected`; ensure `verifyToken` failure returns 401 not empty array.
- [x] `apps/carefind/src/modules/admin/AdminPanel.jsx` -- fix admin queue: `list_news` catch must toast on 401/session expired not silently `[]`; add pendingNews to `totalNotifs` (`pendingVerifs+...+pendingNews`), to `roleNotifCount` and `loadAll` notifications; keep tab badge `News (pending)` accurate; ensure approve/reject/delete reflect immediately via `loadAll`/optimistic update.
- [x] `apps/carefind/src/modules/news-publishing/newsArticle.test.jsx` + `AdminPanel.news.test.jsx` (new) -- tests: insert pending appears as Under review for author; admin `list_news` returns pending with profiles; approve makes `status=approved` and public feed shows it; reject shows Not approved; expired token returns 401 not empty.

**Acceptance Criteria:**
- Given user submits valid news, when checking Admin → News, then submission appears as pending with headline/body/media/author/contact and tab shows `News (1)`
- Given admin approves pending, when reopening public /news, then story is immediately visible as approved and submitter’s status updates from Under review to approved
- Given new pending exists, when admin views dashboard, then bell/totalNotifs includes pendingNews and count indicator is visible
- Given admin token expired, when opening News queue, then error “Session expired” is shown, not silent 0
- Given non-author user, when querying news via anon, then pending of others is not visible (RLS)

## Spec Change Log

## Design Notes

Keep `status='pending'` as inserted value; Admin UI counts `pending` only. User strip collapses `pending→Under review`, `rejected→Not approved` per `News.jsx:192`. Service-role is sole admin read path (RLS `qual:true` permissive `Manage news` policies are draft `carefind_rls_hardening.sql:83` — admin must not rely on anon). List limit 60 matches existing; pending beyond 60 still counted via filtered count.

## Verification

**Commands:**
- `npm test -- src/modules/news-publishing/newsArticle.test.jsx src/modules/admin/AdminPanel.news.test.jsx` -- expected: pending insert → Under review, admin list returns pending, approve → approved visible, 401 on expired token
- `npm run build` (apps/carefind) -- expected: vite build clean

## Suggested Review Order

**Submission — user sees Under review**

- Guard `author_id=user.id` and surface insert error, keep `status:pending`
  [`News.jsx:96`](../../apps/carefind/src/modules/news-publishing/News.jsx#L96)

- Hero upload fallback and toast
  [`News.jsx:115`](../../apps/carefind/src/modules/news-publishing/News.jsx#L115)

**Admin queue — pending becomes visible**

- `list_news` service-role select with `profiles` join, 401 on expired token
  [`admin-auth.js:505`](../../apps/carefind/api/_handlers/admin-auth.js#L505)

- Admin `loadNews` toast on 401 not silent `[]`
  [`AdminPanel.jsx:526`](../../apps/carefind/src/modules/admin/AdminPanel.jsx#L526)

- Approve sets `status:approved` + `published_at`, reject sets `rejected`
  [`admin-auth.js:392`](../../apps/carefind/api/_handlers/admin-auth.js#L392)

**Counts and notifications**

- `pendingNews` added to `totalNotifs` + `roleNotifCount` + tab badge `News (N)`
  [`AdminPanel.jsx:221`](../../apps/carefind/src/modules/admin/AdminPanel.jsx#L221)

**Tests**

- Pending → Under review → admin list → approve → public feed
  [`AdminPanel.news.test.jsx:1`](../../apps/carefind/src/modules/admin/AdminPanel.news.test.jsx#L1)
