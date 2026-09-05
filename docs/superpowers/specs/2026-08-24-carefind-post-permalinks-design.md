# CareFind Post Permalinks — Design

Date: 2026-08-24
Status: approved design, not yet planned or implemented
Sub-project 1 of the "CareFind to Twitter standard" program

---

## 1. Why

CareFind has no URL for a post. A post is opened as a modal over
`/feed?post=<id>`, which means:

- Browser Back closes the modal instead of leaving the page.
- A logged-out visitor following a shared link downloads and renders the
  entire feed in order to read one post.
- The only reason a shared link previews at all is the crawler-only rewrite in
  `vercel.json`, which serves server-rendered Open Graph tags from
  `api/_handlers/og.js` to known preview bots. Humans get the SPA.
- There is no page for a conversation. Comments are an inline expandable inside
  a feed card.

A permalinked post is also the prerequisite for the next sub-projects: topic
and hashtag pages have to link *somewhere*, and "feed at scale" needs the same
extraction this design performs.

### Goals

- A real, canonical, permanent URL per post: `/post/:id`.
- That URL renders a standalone page on cold load, and the existing modal when
  opened from within the feed.
- The conversation renders as page content on the permalink page.
- Every URL already shared, and every `notifications.link` row already written,
  keeps working.

### Non-goals (deliberately deferred)

- **Quote-post** (repost with commentary) — schema change plus UI, independent.
- **Edit marker** (`posts.edited_at`) — schema change plus UI, independent.
- Handles / `@username` URLs — needs a unique, immutable handle column,
  a backfill, and a rename-history table to keep old links alive. Its own
  sub-project.
- Decomposing `Feed.jsx` beyond what a single post requires.

---

## 2. Current state (as measured, 2026-08-24)

| Fact | Location |
|---|---|
| Post detail is a modal over `?post=<id>` | `Feed.jsx:188-197`, `PostDetailModal.jsx` |
| `PostCard` is already the shared renderer for feed + modal | `PostCard.jsx:50` |
| `PostCard` takes ~35 props, all closures over Feed's state | `Feed.jsx:1743-1783` |
| `Feed.jsx` is 2,752 lines with 74 `useState` and 38 direct `supabase` calls | measured |
| `enrichAndSetPosts` (batch, overwrites) and `enrichSinglePost` (one post, merges) encode the same engagement context twice | `Feed.jsx:311`, `Feed.jsx:462` |
| `postRepository` has exactly one live caller (`getPostById`) | `Feed.jsx:653` |
| Crawler OG parses `/feed?post=`, `/u/:id`, `/news/:id`, `/business/:id` | `openGraph.js:64` |
| `notifications.link` rows store `/feed?post=<id>` | `Notifications.jsx:150` |
| Live scale: 45 posts, 53 profiles, 24 follows | live DB |

The load-bearing fact: **the post renderer is parameterized by the entire Feed
component.** Rendering one post outside Feed is not a routing problem.

---

## 3. Routing, and the modal

New route `/post/:id` → `PostPage`.

The modal is kept, via React Router's background-location pattern:

- In-feed tap or "See more" navigates to `/post/:id` with
  `state: { background: location }`.
- `main.jsx` renders `<Routes location={background || location}>` and, when
  `background` is set, a second `<Routes>` carrying the modal route.
- Consequence: the URL updates and is shareable, the feed stays mounted behind
  the modal with its scroll position, and Back dismisses the modal rather than
  leaving the page.
- A cold load of `/post/:id` — shared link, new tab, crawler, notification —
  has no `background` in history state, so it renders the full page.

### Back-compatibility

`/feed?post=<id>` must not break. Feed detects the param and issues
`<Navigate replace to={'/post/' + id} />`.

This covers both populations at once with no data migration:
- links already shared publicly,
- existing `notifications.link` rows.

`Notifications.jsx` begins writing `/post/:id` for newly created rows.
`POST_LINK_TYPES` is unchanged in meaning.

---

## 4. The extraction: `usePostEngagement`

This is the substance of the work, and the seam `planning/ROADMAP.md` §4 item 2
asks CareFind to adopt.

New module: `src/modules/social-feed/usePostEngagement.js`.

It owns everything that currently backs the 35 `cardProps`:

**State** — reactions, profiles, follows, savedPosts, repostedPosts, giftStats,
commentCounts, shareCounts, saveCounts, comments, openComments, commentDrafts,
editingComment, replyingTo, reportedPosts.

**Derived helpers** — `likeCount`, `userHasLiked`, `commentTotal`, `shareCount`,
`saveCount`, `giftCount`, `userHasReposted`, `isSaved`, `isFollowing`,
`isLocked`, `formatCount`, `timeAgo`, `authorName`, `resolveSource`.

**Handlers** — `toggleLike`, `toggleComments`, `toggleRepost`, `toggleSave`,
`toggleFollow`, `sharePost`, `shareCard`, `openReport`, `handleEditPost`,
`handleCommentAdded`, `onGift`.

**Interface**

```js
const { cardProps, hydrate } = usePostEngagement({ user, navigate })
await hydrate(posts)   // loads engagement context for 1..N posts
<PostCard {...cardProps} post={post} preview={false} />
```

`Feed` becomes one consumer. `PostPage` becomes the second. Two real consumers
is what makes the seam a seam rather than a wrapper.

### The de-duplication this closes

`enrichAndSetPosts` (`Feed.jsx:311`, ~145 lines) and `enrichSinglePost`
(`Feed.jsx:462`, ~68 lines) read the same nine tables to answer the same
question — "what is this post's engagement context?" — and differ in exactly
two ways:

1. **Filter shape.** `.in('post_id', ids)` versus `.eq('post_id', id)`.
2. **Write semantics.** The batch version *overwrites* the state slices
   (`setReactions(data)`); the single version *merges by id*
   (`setReactions(prev => [...prev, ...unseen])`) so a deep-linked post cannot
   clobber the loaded feed. This is deliberate and documented at
   `Feed.jsx:456-461`.

The single version additionally omits `businesses` and `userSubscriptions`.
**This was checked and is correct, not drift:** both feed only the ranking
engine's context, and the single-post path does not rank. Lock state is
unaffected — `isLocked` (`Feed.jsx:964`) reads `unlockedCreators`, which
`loadUnlocked()` populates at mount independently of either function.

So there is no live bug here to fix. The case for consolidating is that two
functions currently encode one definition of "a post's engagement context", and
any future column added to that context has to be added twice or silently
diverge. That is the standing risk `planning/CODE_AUDIT.md` records realized
twice already — the repost-attribution and missing-notification findings were
both two copies of one behaviour drifting apart.

They collapse into one `hydrate(posts, { merge })`, where `merge` selects the
write semantics. `hydrate` **returns** the engine context rather than ranking:
Feed ranks with it, `PostPage` ignores it. That split is what lets one function
serve both callers without the single-post path paying for ranking inputs it
does not use.

### Explicitly not moved

Composer state, feed tabs, ranking/engine config, distribution experiments,
pull-to-refresh, stories rail, live-sessions rail, news rail. These belong to
the feed, not to a post. Moving them is sub-project 2's business.

---

## 5. `PostPage`

`src/modules/social-feed/PostPage.jsx`.

**Data** — `postRepository.getPostById(id)`, giving that repository its second
real caller, then `hydrate([post])`.

**Render** — `<PostCard preview={false}>` followed by the conversation
(`CommentThread`) as page content rather than an inline expandable.

**States**

| State | Behaviour |
|---|---|
| Loading | `CardSkeleton`, `role="status"`, `aria-live="polite"` |
| Not found | "This post isn't available." Deleted and RLS-hidden are deliberately indistinguishable — distinguishing them leaks whether a private post exists. |
| Locked | Subscriber-only teaser and gate, byte-identical to the feed's. |
| Repost | Resolves to and renders the source post, same as the feed. |
| Error | `ErrorState` with retry. |

**Layout** — desktop wraps in `AppShell` + `RightSidebar`; mobile renders
`BottomNav`. Mirrors the pattern already used by `Notifications.jsx`.

**Accessibility** — `<main>` landmark, one `h1` naming author and post, focus
moved to the heading on mount so a keyboard or screen-reader user following a
link lands on the content rather than the nav.

**Responsive** — verified at 375 / 768 / 1280 per the project standard.

---

## 6. Crawler / Open Graph

`parseShareTarget` (`openGraph.js:64`) gains a branch:

```js
if (segments[0] === 'post' && segments[1]) {
  return UUID.test(segments[1]) ? { kind: 'post', id: segments[1] } : null
}
```

The existing `/feed?post=` branch stays, so old links still preview.
`buildPostMeta` needs no change. The canonical URL emitted for a post becomes
`/post/:id`, so a preview generated from an old `?post=` link advertises the new
canonical form and consolidates link equity.

`vercel.json` needs no change — its crawler rewrite already matches `/(.*)`.

The OG path continues to use the **anon** key, so a preview is bound by exactly
the RLS a logged-out visitor gets. Paid and hidden posts stay unnamed.

---

## 7. Testing

| Suite | Cases |
|---|---|
| `openGraph.test.js` | `/post/:id` parses; `/feed?post=` still parses; non-UUID rejected; canonical is the new shape |
| `PostPage.test.jsx` | loading, not-found, locked, success, conversation renders, repost resolves to source |
| `Feed.test.jsx` | `?post=` redirects to `/post/:id`; in-feed open sets `background` and keeps the feed mounted |
| `usePostEngagement` tests | `hydrate` yields the same per-post context for 1 post as for many; `{ merge: false }` drops posts absent from the new batch; `{ merge: true }` preserves existing state and does not double-count on re-hydrate; existing handler coverage moves with the handlers |
| `raceConditions.test.js` | extended for the merge semantics below |

**All 514 existing CareFind tests must stay green.** The extraction is
behaviour-preserving by definition; a red test means the extraction changed
behaviour, not that the test is stale.

---

## 8. Risks

**The extraction touches `Feed.jsx` broadly, and Feed has no repository seam —
its only coverage is UI-level.**
Mitigation: extract in behaviour-preserving steps, running the full suite after
each. Commit the extraction separately from the new route so a regression
bisects cleanly (`feedback-carehub-commit-discipline`).

**Merge semantics are load-bearing and easy to lose.**
The two write modes are not stylistic. The feed *overwrites* (a refetch must
drop posts that fell out of the batch); the deep-link path *merges by id* (a
single post must not clobber a loaded feed). Collapsing them into one function
means the mode becomes an explicit `{ merge }` argument, and picking the wrong
default silently breaks one of the two callers — an overwrite from `PostPage`
would blank the feed's counts behind the modal; a merge from a feed refetch
would leave stale reactions accumulating.

Both modes get direct assertions, and `raceConditions.test.js` is extended to
cover open-modal-then-refresh-feed.

**Scroll restoration.**
The background-location pattern keeps Feed mounted, so scroll position survives
opening and closing the modal. It does *not* survive a cold load of `/post/:id`
followed by navigating to the feed — that is expected, and out of scope here.

---

## 9. Definition of done

Per `planning/ROADMAP.md` §9, the subset that applies:

- [ ] Loading, error, empty/not-found and locked states present on `PostPage`
- [ ] Verified responsive at 375 / 768 / 1280
- [ ] `<main>` landmark, single `h1`, focus management on mount
- [ ] No native `alert()` / `confirm()` / `prompt()`
- [ ] `/feed?post=` redirects; no already-shared link breaks
- [ ] Crawler preview verified against a real `/post/:id` URL
- [ ] 514 existing tests green, plus the new suites above
- [ ] `vite build` clean
- [ ] Extraction and new route in separate commits
- [ ] `CAREFIND_ARCHITECTURE.md` §1 (routing) and §10 (data-fetching patterns)
      updated — §10 currently records `postRepository` as "legacy/dead"

---

## 10. What this deliberately does not fix

Named so a later reader does not mistake them for oversights. All are tracked in
the program's gap register:

- The feed's 50-post ceiling and the client-side-only ranking (sub-project 2).
- The unbounded verified-ids fetch at `Feed.jsx:789-792` (sub-project 2).
- The unfiltered global realtime channel (sub-project 4).
- `Notifications.jsx:77` marking all unread rows read while displaying only 100
  (sub-project 4).
