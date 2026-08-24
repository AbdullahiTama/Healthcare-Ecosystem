# CareFind Post Permalinks — corrections to the implementation plan

These override `2026-08-24-carefind-post-permalinks.md` wherever they disagree. Each was
verified against live source during execution; the plan was written before that verification.
Tasks 1-4 were implemented WITH these corrections applied. Tasks 5-9 still need them.

Committed because the working ledger lives in a gitignored directory and would not survive a
`git clean`. Full execution history, including every ruling, is in
`.superpowers/sdd/2026-08-24-carefind-post-permalinks/progress.md` while that directory exists.

---

# Task 4 addendum — corrections that OVERRIDE the brief

Read this alongside `task-4-brief.md`. Where the two disagree, **this file wins**. Every item
here was verified against the live source during Tasks 1–3; the brief was written before that
verification and is wrong on several points.

---

## 1. The hook needs FIVE injected callbacks, not one

The brief's Task 4 Step 2 mounts the hook as:

```js
const engagement = usePostEngagement({ user, navigate, toast, onSharingChange: setSharingId })
```

That is incomplete. Task 3 moved ten handlers into the hook, and five of them wrote to Feed-only
state. Each became an injected callback with a no-op default. **Feed must supply all five**, or
the behaviour those handlers had inside Feed is silently lost:

```js
const engagement = usePostEngagement({
  user,
  navigate,
  toast,

  // toggleLike / sharePost / toggleSave logged an experiment engagement event.
  // The guard and payload are EXACTLY what those handlers used to inline.
  logEngagement: (postId) => {
    if (activeExperiment) {
      logExperimentEvent(supabase, {
        experimentKey: activeExperiment.key,
        variant: activeExperiment.variant,
        eventType: 'engage',
        postId,
      }).catch(() => {})
    }
  },

  // shareCard sets this 4x. PostCard:385-399 uses it to disable the Voice-Card
  // download button and swap its label to "Preparing…". Omit it and that button
  // loses its disabled state and its progress feedback.
  onSharingChange: setSharingId,

  // openReport's last line. Omit it and reporting a post becomes unreachable.
  onReportPost: setReportPostId,

  // handleEditPost's last two lines. Omit them and a saved edit leaves the
  // editor open over stale content.
  onEditingPostChange: setEditingPost,
  reloadFeed: loadFeed,
})
```

`logExperimentEvent`, `supabase` and `activeExperiment` are all already in scope in `Feed.jsx`.
Keep the `if (activeExperiment)` guard — without it the call fires with `undefined` keys.

## 2. `hydrate` does not return `viewerRegion` or `now` — Feed must add them

This is the single most losable detail in the plan.

The live `enrichAndSetPosts` built its context ending with `viewerRegion: myRegion, now: Date.now()`
(Feed.jsx:422-427 before this work). `hydrate` cannot supply either — `myRegion` is Feed state set
by `loadEngineConfig`, and `now` is per-render. So the context `hydrate` returns is missing both.

Every ranking call must merge them back on first:

```js
const base = await engagement.hydrate(postData, { merge: false })
if (base) {
  const context = { ...base, viewerRegion: myRegion, now: Date.now() }
  // ...rankByScore / rankForYou / rankNearby all use THIS context, not `base`
}
```

**If you forget: nothing crashes and no test fails.** `rankNearby` silently loses its region
signal and the recency weight reads `undefined`. The feed just ranks worse, invisibly. Verify by
reading `feedEngine.js` for how `viewerRegion` and `now` are consumed.

`hydrate([])` returns `null`, not an empty context — hence the `if (base)` guard.

## 3. Ranking stays in Feed

`hydrate` deliberately does not rank and does not call `setPosts`. The ranking block
(`rankByScore` / `rankForYou` + `applyExperimentConfig` / `rankNearby`, and the `setPosts(ranked)`
call) is Feed's and stays in Feed. Move it out of the old `enrichAndSetPosts` into `loadFeed`
verbatim — do not re-derive the tab conditionals.

Three call sites need this treatment:
- `loadFeed` — `{ merge: false }`, then rank, then `setPosts(ranked)`
- `runFeedSearch` — same shape
- the deep-link path — `{ merge: true }`, no ranking (it is one post)

## 4. `cardProps` — spread the hook first, add only Feed's own chrome

Do NOT re-list anything the hook already provides. Every selector, plus `shareCard`,
`handleEditPost` and the other nine handlers, arrive in `engagementProps`. Re-listing them creates
a stale copy that shadows the hook.

```js
const cardProps = {
  ...engagement.engagementProps,
  user,
  navigate,
  authorName,
  onGift: (p) => setGiftingPost({ postId: p.id, authorId: p.user_id }),
  myUsername,
  myAvatar,
  sharingId,
  editingPost,
  setEditingPost,
  setConfirmDeleteId,
  onOpenDetail: openPostDetail,
}
```

Note `sharingId` and `editingPost` are still read directly from Feed state for rendering — the
hook writes them through the callbacks above, Feed owns the values.

## 5. State to delete from Feed, and state to KEEP

Delete these `useState` declarations and repoint every reference (~135 sites; `posts` alone has
~51, `profiles` ~21, `follows` ~11):

  posts, reactions, profiles, follows, savedPosts, repostedPosts, repostSources, giftStats,
  commentCounts, shareCounts, saveCounts, userSubscriptions, unlockedCreators, comments,
  openComments, commentDrafts, editingComment, replyingTo, reportedPosts

Selectors come from `engagement.engagementProps.X`; setters from `engagement.state.setX`.

**KEEP** (Feed's own chrome and feed-level concerns — the hook must never own these):
  the composer state, feedTab and the tab refs, rankConfig / poolsConfig / myRegion /
  medicalContext, activeExperiment and feedViewLoggedRef, pull-to-refresh state, stories,
  liveSessions, latestNews, platformLive, seriesList, unreadNotifs, sharingId, editingPost,
  giftingPost, confirmDeleteId, reportPostId, reportingId, detailPost/detailLoading/detailError.

## 6. Functions to delete from Feed

`enrichAndSetPosts`, `enrichSinglePost`, and all ten moved handlers (toggleLike, toggleComments,
handleCommentAdded, toggleFollow, openReport, sharePost, toggleSave, toggleRepost,
handleEditPost, shareCard), plus the selectors likeCount, userHasLiked, commentTotal, shareCount,
saveCount, giftCount, userHasReposted, isSaved, isFollowing, isLocked, formatCount, timeAgo.

Also delete `handleNotifyComment` — it is a private helper of `handleCommentAdded` and moved with
it in Task 3. And the `repostInFlight` ref, which moved with `toggleRepost`.

**Do NOT delete `submitReport`.** It stayed in Feed (it owns the report modal), it has its own
`activeExperiment` block with `eventType: 'report'`, and it is not one of the ten.

## 7. The acceptance contract

Before you change anything, run `npm test` and write down the exact counts. After, they must be
**identical** — currently **48 files / 537 tests**. Not "about the same". A changed count means
behaviour moved, which this task forbids.

Then `npm run build` must be clean (the chunk-size warning is pre-existing and expected).

Be aware of what the contract does NOT catch: a crash on a path no test exercises. With ~135
references to repoint, a single missed site is a runtime `undefined` error. After the suite is
green, exercise the app manually per the brief's Step 9 — like, comment, repost, save, follow,
share, the Voice-Card download button, tab switches, and pull-to-refresh.

---

## 8. Add a regression test for the `repostInFlight` guard (from the Task 3 review)

`toggleRepost` carries `const repostInFlight = useRef(new Set())` — the guard that stops a
double-tap firing two reposts. It moved into the hook intact (verified by direct comparison),
but the Task 3 review established that **no test anywhere would fail if a future edit dropped it**:
`Feed.test.jsx` has only three deep-link tests, `PostCard.test.jsx` passes the handler in as a
stub, and `raceConditions.test.js:133` explicitly scopes the in-flight guard out as "Feed's".

Task 4 is where Feed's copy is deleted and the hook becomes the only implementation, so the guard
becomes untested-and-sole-implementation at exactly this commit. Add to
`usePostEngagement.test.jsx`:

- a test that two overlapping `toggleRepost(post)` calls on the same post produce exactly ONE
  repost write (await both, assert the insert happened once)
- a test that after the first settles, a subsequent `toggleRepost` is allowed through (i.e. the
  ref is cleared in the `finally`, not leaked)

This is the one place where the "identical test counts" contract is deliberately relaxed: the
count goes UP by the tests you add here. Everything else must stay identical.

## 9. Also carried from the Task 3 review

- The hook's doc comment above the signature says "The **four** callbacks after `toast`" and then
  lists five. Fix the number in passing.
- `usePostEngagement({...})` has no default for its own argument object, so calling it with zero
  arguments throws. Pre-existing from Task 2 and harmless (both callers pass an object). Do not
  "fix" it as part of this task.

---

# Task 5 addendum — corrections that OVERRIDE the brief

Read alongside `task-5-brief.md`. Where they disagree, **this file wins**.

The brief is correct about routing, data loading, states, layout and accessibility. It is wrong
about one thing, and that thing is user-visible.

---

## 1. Do NOT stub `onGift`, `setEditingPost` and `setConfirmDeleteId`

The brief's Step 3 has:

```js
onGift: () => {},
setEditingPost: () => {},
setConfirmDeleteId: () => {},
```

`PostCard` renders all three affordances and does not know they are inert:

- **Gift button** — `PostCard.jsx:528`, `onClick={() => (user ? onGift(post) : navigate('/login'))}`.
  Rendered for **every** viewer, so on a permalink it is dead for everyone.
- **Edit / Delete menu items** — `PostCard.jsx:272-275`, rendered only when
  `user && post.user_id === user.id`, so dead on your own post.

A control that looks live and does nothing is worse than one that is absent, and it fails the
quality bar in `.claude/CLAUDE.md`. Wire all three for real.

## 2. Gift — mirror Feed's pattern exactly

`PostPage` gets its own `giftingPost` state and renders `GiftPanel`, including the gift-count
refresh on close. Copy the shape from Feed (`Feed.jsx:2665-2680` in the pre-Task-4 source):

```js
const [giftingPost, setGiftingPost] = useState(null)
// ...
onGift: (p) => setGiftingPost({ postId: p.id, authorId: p.user_id }),
```

and render:

```jsx
{giftingPost && (
  <GiftPanel
    postId={giftingPost.postId}
    recipientId={giftingPost.authorId}
    onClose={() => {
      const { postId } = giftingPost
      setGiftingPost(null)
      supabase.rpc('post_gift_stats', { p_post_id: postId }).then(({ data }) => {
        if (data?.gift_count != null) {
          engagement.state.setGiftStats((prev) => ({
            ...prev,
            [postId]: { gift_count: data.gift_count, total_coins: data.total_coins },
          }))
        }
      })
    }}
  />
)}
```

## 3. Edit — real state plus the two callbacks Task 3 introduced

`handleEditPost` already lives in the hook and arrives via `engagementProps`. It ends by calling
two injected callbacks that default to no-ops. If you leave them defaulted, a successful edit
writes to the database and then neither closes the editor nor refreshes the body — the user sees
their old text and assumes the save failed.

```js
const [editingPost, setEditingPost] = useState(null)
// ...passed to the hook:
onEditingPostChange: setEditingPost,
reloadFeed: () => refetchThisPost(),   // NOT loadFeed — there is no feed here
```

`refetchThisPost` re-runs the same `postRepository.getPostById(id)` + `hydrate([post], { merge: true })`
the initial load uses. Factor that into one function and call it from both places.

Then pass `editingPost` and `setEditingPost` into `cardProps` so the inline editor renders
(`PostCard.jsx:285-310` reads them).

## 4. Delete — move `handleDeletePost` into the hook, with a callback for the aftermath

`handleDeletePost` was NOT one of the ten handlers Task 3 moved; it is still in `Feed.jsx`:

```js
async function handleDeletePost(postId) {
  setDeletingId(postId)
  await supabase.from('posts').delete().eq('id', postId).eq('user_id', user.id)
  loadFeed()
  setDeletingId(null)
}
```

Copying it into `PostPage` would be duplication, which `.claude/CLAUDE.md` forbids outright. But
the two hosts need different aftermaths: the feed reloads its list, whereas a permalink page whose
post no longer exists must navigate away rather than sit on a 404 of its own making.

So: move it into `usePostEngagement` alongside `handleEditPost`, with the DB write and the
`deletingId` state in the hook and the aftermath injected:

```js
// hook parameter, defaulting to a no-op like the other five
onPostDeleted = () => {}
```

- `Feed` passes `onPostDeleted: loadFeed` — behaviour identical to today.
- `PostPage` passes `onPostDeleted: () => navigate('/feed')`.

Keep the `.eq('user_id', user.id)` scoping exactly as-is: it is the client-side half of the
ownership check and RLS is the other half. Do not "simplify" it away.

Then `PostPage` renders `ConfirmDialog` with its own `confirmDeleteId` state, copying Feed's
wording verbatim (`Feed.jsx:2684-2691`) so the two surfaces do not drift:

```jsx
<ConfirmDialog
  show={!!confirmDeleteId}
  onClose={() => setConfirmDeleteId(null)}
  onConfirm={() => { engagement.engagementProps.handleDeletePost(confirmDeleteId); setConfirmDeleteId(null) }}
  title="Delete this post?"
  consequence="This cannot be undone. The post, along with its likes and comments, will be permanently removed."
  confirmLabel="Delete"
/>
```

Because this touches `Feed.jsx` (one call site plus one new hook argument), keep it to that —
do not otherwise modify Feed in this task.

## 5. Report — already works, no action

`openReport` is in the hook and takes `onReportPost`. `PostPage` should pass real state and render
the same report `Modal` Feed does (`Feed.jsx:2694`), or omit the report affordance entirely — but
NOT leave `onReportPost` defaulted while `PostCard` still renders the "Report post" menu item for
other people's posts. Same dead-control rule as above. Wiring it is the smaller change.

## 6. Test the wiring, not just the rendering

Add to the brief's six tests:

- pressing Gift on a loaded post opens the gift panel (assert the panel appears, not that a
  callback fired)
- a successful edit closes the editor and shows the new body
- confirming delete calls through and navigates to `/feed`

These are the three the brief would have shipped inert, so they are exactly the three worth
asserting.

---

# Task 6 addendum — corrections that OVERRIDE the brief

Read alongside `task-6-brief.md`. Where they disagree, **this file wins**.

The brief's *intent* is right: one URL should serve both an in-feed overlay and a standalone
page. Its *implementation sketch is broken in three ways*, all found in a pre-flight scan before
execution began. Do not follow the brief's Step 3 or Step 1 as written.

---

## 1. The modal route must NOT render `<Feed />` — it renders a new `PostModalRoute`

The brief's Step 3 sketches:

```jsx
{background && (
  <Routes>
    <Route path="/post/:id" element={<Feed />} />   {/* WRONG */}
  </Routes>
)}
```

With a background location set, the **first** `<Routes>` is already rendering `Feed` at `/feed`.
The second would mount a **second, independent `Feed` instance**: two feed fetches, two ranking
pipelines, two `post-comments-realtime` channel subscriptions, two sets of engagement state.

Instead create `src/modules/social-feed/PostModalRoute.jsx` — a small host whose only job is to
resolve one post and show it in the existing `PostDetailModal`:

```jsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../providers/AuthContext'
import { useToast } from '../../components/ui'
import { usePostEngagement } from './usePostEngagement.js'
import { postRepository } from './repositories'
import PostDetailModal from './PostDetailModal.jsx'

// Renders one post as an overlay above whatever page is underneath. Mounted
// only when history state carries a `background` location — a cold load of
// /post/:id renders PostPage instead. Owns its own engagement instance rather
// than reaching into the Feed behind it, which is precisely what the
// usePostEngagement extraction (Tasks 1-4) made possible.
export default function PostModalRoute() { /* ... */ }
```

It follows the same shape as `PostPage`: `postRepository.getPostById(id)` then
`hydrate([post], { merge: true })`. **`merge: true` is load-bearing** — the feed behind the modal
has already hydrated its own posts, and an overwrite would blank their counts.

Closing calls `navigate(-1)`, which pops back to the background location.

Pass `loading` and `error` through to `PostDetailModal`; it already renders both
(`PostDetailModal.jsx` takes `show, post, loading, error, onClose, cardProps`).

`PostModalRoute` supplies its own `cardProps` the same way `PostPage` does — including the real
gift/edit/delete wiring from the Task 5 addendum, for the same reason: a control that renders and
does nothing is a defect.

## 2. `Feed`'s own modal machinery is now dead — delete it in this commit

Once the modal is a route, these are unreachable inside `Feed.jsx` and must go:

- state: `detailPost`, `detailLoading`, `detailError`
- functions: `openPostDetail`, `closePostDetail`, `clearPostParam`
- the `<PostDetailModal ... />` render
- the two `useEffect`s that resolve `deepLinkPostId` (the fetch-and-open effect, and the
  "if the deep-linked post lands in the loaded list, swap to it" effect)

`onOpenDetail` in `cardProps` becomes a navigation instead:

```js
onOpenDetail: (post) => navigate(`/post/${post.id}`, { state: { background: location } }),
```

Add `const location = useLocation()` to `Feed()` and import `useLocation`.

Leaving a second, unreachable modal path inside the highest-traffic file in the app is exactly
the duplicate-surface drift the design doc argues against in §4.

## 3. The brief's "feed stays mounted" test would pass vacuously — rewrite it

The brief's Step 1 test uses the file's existing `renderFeed` helper, which does:

```jsx
render(<MemoryRouter initialEntries={[path]}><Feed /></MemoryRouter>)
```

There is no `<Routes>`, so `Feed` renders regardless of location and the assertion "the feed is
still there" **cannot fail**. A test that cannot fail is worse than no test: it certifies
behaviour it never checked.

Write it against the real route structure instead — register both routes and the background
split, then assert BOTH halves:

```jsx
function renderRouted(initialEntries) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AppRoutes />        {/* or an inline equivalent registering /feed and /post/:id */}
    </MemoryRouter>
  )
}
```

Assertions that make the test real:
- after clicking through to a post, the **feed body text is still in the document** (it did not
  unmount), AND
- the modal's content is also present (the overlay actually rendered), AND
- a direct render at `/post/:id` with no background renders `PostPage` and NOT the feed.

If extracting `AppRoutes` from `main.jsx` into its own module makes it testable, do that —
`main.jsx` currently mounts everything inline, which is why there is no seam to test against.
That is a justified structural change, not scope creep.

## 4. `useLocation` inside a background-rendered subtree returns the BACKGROUND location

Worth knowing before you debug something confusing: `<Routes location={background}>` overrides
`LocationContext` for its whole subtree in React Router v6. So `Feed`, rendered behind a modal,
sees `/feed` from `useLocation()` — not `/post/:id`. This is why the modal cannot be hosted from
inside `Feed` by sniffing the location, and why Finding 1's `PostModalRoute` is the right shape.

It is also why Task 7's redirect guard is simply `if (deepLinkPostId)` with no `useParams()`
check — `Feed` can never see a `/post/:id` param.

## 5. Do not change the share URL in this task

`sharePost` still builds `/feed?post=${post.id}`. Task 7 changes it, together with the redirect
and the `Notifications.jsx` link shape, so that the URL change lands as one reviewable unit.
