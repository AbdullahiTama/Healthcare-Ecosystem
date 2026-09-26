---
title: 'Make Stories discoverable across avatars with engagement and owner analytics'
type: 'feature'
created: '2026-09-04'
status: 'done'
baseline_commit: 'b3f608f02af6f1f346ac877ab7673c5b36a6f3f3'
review_loop_iteration: 0
context:
  - 'apps/carefind/src/modules/social-feed/Stories.jsx'
  - 'apps/carefind/src/modules/social-feed/components/StoryViewer.jsx'
  - 'apps/carefind/src/modules/social-feed/storyViews.js'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Active Story only visible in Stories rail/Profile hero — not on feed post headers, comments, followers, search etc.; viewer taps don’t always register; no view count/who-viewed; no Like/Comment/Share/Gift for stories; feels isolated.

**Approach:** Extract `StoryAvatar` ring (hasStory/allSeen) into reusable hook/component and wrap every avatar surface; fix `Stories.jsx` to show user stories (not only platform); add `StoryViewer` view count + viewer sheet; add story engagement (Like/Comment/Share/Gift) with tables/RLS; surface owner analytics.

## Boundaries & Constraints

**Always:** Keep `stories` table (`expires_at > now` filter, `view_count`, `is_platform`); keep `story_views` PK `(story_id,user_id)` + `increment_story_view` RPC + `fetchViewedStoryIds`/`markStoriesViewed`; keep `public` read for active stories, `auth.uid()` write.

**Ask First:** Adding `story_reactions`/`story_comments`/`story_gifts` tables vs polymorphic `gifts`; adding `get_story_viewers` RPC for who-viewed.

**Never:** N+1 per avatar for `story_views`; expose other viewers to non-owners; allow expired stories to accept engagement.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Active story | User has `expires_at>now` story | Ring around avatar everywhere (Feed post header, comments, followers, Profile, PublicProfile, News article author, Search, VideoFeed, SavedPosts) | No ring if no active story; gray `allSeen` when viewer watched all |
| Tap ring | Tap avatar with ring | Opens `StoryViewer` for that user’s active stories | No story → no action |
| View count | Owner opens viewer | Shows `view_count` Eye + count; can open viewer sheet who viewed | Only owner can see who-viewed |
| Engagement | Like/Comment/Share/Gift on StoryViewer | Counts update, comment appears, share copies link, gift via existing panel | Expired → 404/blocked; RLS 42501 toast |
| Analytics | Owner profile | Per-story view count + unique viewers vs followers | No leak of other viewers to non-owners |

</frozen-after-approval>

## Code Map

- `apps/carefind/src/modules/social-feed/Stories.jsx:64-83,204-231` -- currently loads only `is_platform=true` (`gt expires_at`) and renders per-story gradient; must fix query to include followed + own `is_platform=false` and render per-user avatar ring; `85:89` `increment_story_view` without `markStoriesViewed`.
- `apps/carefind/src/PublicProfile.jsx:510-543` -- canonical `StoryAvatar` (`hasStory`, `allSeen` teal/gray, `ringPad`); must extract to `hooks/useStoryRing.js` or `components/StoryAvatar.jsx` and reuse.
- `apps/carefind/src/modules/account/Profile.jsx:656-710` -- own hero teal only, no `allSeen`; must unify.
- `apps/carefind/src/modules/social-feed/components/StoryViewer.jsx:6-89` -- pure presenter, no `view_count` badge, no engagement bar, no viewer list; must add Eye count + Like/Comment/Share/Gift bar (`cf-eng-row` style) and viewer sheet trigger.
- `apps/carefind/src/modules/social-feed/PostCard.jsx:252-269` -- post header avatar custom, no ring; must wrap.
- `apps/carefind/src/modules/social-feed/components/CommentThread.jsx:173,270` -- `Avatar` no ring; must wrap.
- `apps/carefind/src/modules/social-feed/FollowersSheet.jsx:119` -- `Avatar` no ring.
- `apps/carefind/src/modules/social-feed/storyViews.js:12-38` -- `fetchViewedStoryIds` + `markStoriesViewed` idempotent; keep.
- `apps/carefind/src/components/BottomNav.jsx` etc. -- other surfaces to add ring.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/carefind/src/hooks/useStoryRing.js` (new) + `components/StoryAvatar.jsx` (new) -- extract `hasStory`/`allSeen`/`unseenCount` logic from `PublicProfile.jsx:431,510` using `fetchViewedStoryIds` batched per page (once, not per avatar), `ring tealDeep` when unseen, `gray300` when allSeen, transparent otherwise; props `userId`, `stories`, `size`.
- [ ] `apps/carefind/src/modules/social-feed/Stories.jsx` -- fix rail query: `or(is_platform eq true, user_id in (followedIds+ownId))` ordered `position nullsLast, created_at desc`; compute viewed vs vibrant via `story_views`; restore composer `canPost` pill (remove `false &&` at `190`); pass `onViewStory` to `StoryViewer` to centralize `increment_story_view`+`markStoriesViewed`.
- [ ] `apps/carefind/src/modules/social-feed/components/StoryViewer.jsx` -- add footer Eye `view_count` + viewer sheet trigger (owner only via `get_story_viewers` RPC), engagement bar `Heart/MessageCircle/Share2/Gift` with handlers to new `story_reactions`/`story_comments` tables (or reuse), `aria-live` counts.
- [ ] `apps/carefind/src/modules/social-feed/PostCard.jsx` + `CommentThread.jsx` + `FollowersSheet.jsx` + `VideoFeed.jsx` + `SavedPosts.jsx` + `Search.jsx` + `NewsArticle.jsx` author avatar -- wrap `Avatar` with `StoryAvatar` (hasStory/allSeen) and tap-to-open `StoryViewer` for that user.
- [ ] `apps/carefind/sql/202608XX_stories_engagement.sql` (new) -- `story_reactions(story_id,user_id,type PK)`, `story_comments(id,story_id,user_id,parent_id,content)` with RLS `user_id=auth.uid() AND expires_at>now()` and `get_story_viewers` RPC owner-only; keep `stories` update via RPC only.
- [ ] `apps/carefind/src/modules/social-feed/storyViews.test.js` + `StoryViewer.test.jsx` -- tests: ring teal when unseen gray when allSeen, avatar tap opens viewer, view_count increments, engagement Like/Comment/Share/Gift work, expired story blocked.

**Acceptance Criteria:**
- Given user has active Story, when viewing avatar from Feed/comments/Profile/News article, then Story ring appears (teal when unseen, gray when all seen) and tapping opens StoryViewer
- Given owner views Story, when checking viewer, then view count and who-viewed sheet are accurate (only owner sees)
- Given StoryViewer open, when liking/commenting/sharing/gifting, then counts update and are attributed to story
- Given expired story, when trying to engage, then blocked (404) and not shown as active ring

## Spec Change Log

## Design Notes

Batch `fetchViewedStoryIds(supabase, allStoryIds)` once per page (as `PublicProfile.jsx:138`) not per avatar to avoid N+1 RLS `in (...)`. Keep `expires_at>now` filter everywhere; cron not needed, app filters. Use existing `global.css` `cf-eng-row` for StoryViewer bar.

## Verification

**Commands:**
- `npm test -- src/modules/social-feed/storyViews.test.js src/modules/social-feed/components/StoryViewer.test.jsx src/modules/social-feed/Stories.test.jsx` -- expected: ring teal/gray, avatar tap opens, view count, engagement, expired blocked
- `npm run build` (apps/carefind) -- expected: vite build clean
