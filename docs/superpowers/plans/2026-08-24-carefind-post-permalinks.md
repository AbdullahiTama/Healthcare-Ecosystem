# CareFind Post Permalinks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every CareFind post a real, permanent URL (`/post/:id`) that renders a standalone page on cold load and the existing modal when opened from the feed.

**Architecture:** `PostCard` already renders both the feed list and the detail modal, but it takes ~35 props that are all closures over `Feed.jsx`'s 74 `useState` hooks — so rendering one post outside Feed is not a routing problem. We first extract the engagement state, selectors and handlers into a `usePostEngagement` hook (plus a pure `postSelectors` module), rewire `Feed.jsx` onto it with zero behaviour change, then add `PostPage` as a second consumer. Routing uses React Router's background-location pattern so one URL serves both the modal and the page.

**Tech Stack:** React 18, React Router v6, Vite 5, Vitest + @testing-library/react, Supabase JS v2 (direct client, RLS-enforced).

**Spec:** `docs/superpowers/specs/2026-08-24-carefind-post-permalinks-design.md`

## Global Constraints

- Working directory for every command is `apps/carefind`. Run tests with `npm test`, a single file with `npx vitest run <path>`.
- **All 514 existing tests must stay green after every task.** Tasks 1–4 are behaviour-preserving by definition; a red existing test means the extraction changed behaviour.
- No native `alert()` / `confirm()` / `prompt()` — project standard since the 2026-07-19 sweep.
- Icons are `lucide-react` only. No emoji in user-facing UI.
- Styling is inline `style={}` objects against `../../styles/theme`. Do not introduce CSS files, Tailwind, or styled-components.
- Every new screen needs loading, error, and empty/not-found states, and must be verified at 375 / 768 / 1280.
- Commit discipline: the extraction (Tasks 1–4) and the new behaviour (Tasks 5–9) are separate commits. Never mix a refactor and a behaviour change in one commit.
- Post ids are UUIDs. The canonical regex already exists as `UUID` in `src/lib/openGraph.js:59`.
- Deleted and RLS-hidden posts must remain indistinguishable to the client — both render "This post isn't available."

---

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `src/modules/social-feed/postSelectors.js` | Pure functions: given engagement state and a post id, derive a count or boolean. No React, no I/O. |
| `src/modules/social-feed/postSelectors.test.js` | Unit tests for the above. |
| `src/modules/social-feed/usePostEngagement.js` | The hook: owns engagement state, `hydrate(posts, {merge})`, and the engagement handlers. Composes `postSelectors`. |
| `src/modules/social-feed/usePostEngagement.test.jsx` | Hook tests via `renderHook`. |
| `src/modules/social-feed/PostPage.jsx` | Route component for `/post/:id`. Second consumer of the hook. |
| `src/modules/social-feed/PostPage.test.jsx` | Loading / not-found / locked / success / repost tests. |

**Modify:**

| Path | Change |
|---|---|
| `src/modules/social-feed/Feed.jsx` | Delete the extracted state/selectors/handlers; consume the hook. Redirect `?post=` to `/post/:id`. Open the modal via background location. |
| `src/main.jsx` | Add the `/post/:id` route and the background-location split. |
| `src/lib/openGraph.js:64` | `parseShareTarget` gains a `/post/:id` branch. |
| `src/lib/openGraph.test.js` | Cases for the new shape. |
| `src/modules/account/Notifications.jsx:150` | Emit `/post/:id` for post-linked notification types. |
| `src/modules/social-feed/Feed.test.jsx` | Redirect + background-location cases. |
| `src/modules/social-feed/raceConditions.test.js` | Open-modal-then-refresh-feed merge case. |
| `CAREFIND_ARCHITECTURE.md` | §1 routing, §10 data-fetching (currently records `postRepository` as legacy/dead). |
| `planning/CODE_AUDIT.md` | Close the permalink gap; note what remains. |

**Boundary rule that decides what moves:** the hook owns state that describes *a post's engagement*. It does **not** own Feed's UI chrome. Concretely, these stay in `Feed.jsx` and are spread onto `cardProps` by the consumer: `onGift`, `setEditingPost`, `setConfirmDeleteId`, `sharingId`, `myUsername`, `myAvatar`, `onOpenDetail`, `navigate`, `preview`.

> **Deviation from the spec, recorded deliberately.** Spec §4 lists `onGift` among the handlers the hook owns. It should not be: `onGift` only calls `setGiftingPost`, which is Feed's modal state, and `PostPage` will supply its own. Same reasoning excludes `setEditingPost` / `setConfirmDeleteId` / `sharingId`. The spec's intent — one definition of a post's engagement context — is unchanged.

---

### Task 1: Pure engagement selectors

**Files:**
- Create: `src/modules/social-feed/postSelectors.js`
- Test: `src/modules/social-feed/postSelectors.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `likeCount(reactions, postId)`, `userHasLiked(reactions, postId, userId)`, `commentTotal(commentCounts, postId)`, `countFrom(map, postId)`, `userHasReposted(repostedPosts, postId)`, `isSaved(savedPosts, postId)`, `isFollowing(follows, authorId, userId)`, `isLocked(post, unlockedCreators, userId)`, `formatCount(n)`, `timeAgo(dateStr)`, `resolveSourceFrom(posts, repostSources, id)`. All pure; all take their state as the first argument.

- [ ] **Step 1: Write the failing test**

Create `src/modules/social-feed/postSelectors.test.js`:

```jsx
import { describe, it, expect } from 'vitest'
import {
  likeCount, userHasLiked, commentTotal, countFrom, userHasReposted,
  isSaved, isFollowing, isLocked, formatCount, timeAgo, resolveSourceFrom,
} from './postSelectors.js'

describe('postSelectors', () => {
  it('counts likes for one post only', () => {
    const reactions = [
      { id: 'r1', post_id: 'p1', user_id: 'u1' },
      { id: 'r2', post_id: 'p1', user_id: 'u2' },
      { id: 'r3', post_id: 'p2', user_id: 'u1' },
    ]
    expect(likeCount(reactions, 'p1')).toBe(2)
    expect(likeCount(reactions, 'p2')).toBe(1)
    expect(likeCount(reactions, 'nope')).toBe(0)
  })

  it('reports whether a specific viewer liked a post', () => {
    const reactions = [{ id: 'r1', post_id: 'p1', user_id: 'u1' }]
    expect(userHasLiked(reactions, 'p1', 'u1')).toBe(true)
    expect(userHasLiked(reactions, 'p1', 'u2')).toBe(false)
    // A logged-out viewer has liked nothing.
    expect(userHasLiked(reactions, 'p1', null)).toBe(false)
  })

  it('reads counts out of a keyed map, defaulting to 0', () => {
    expect(commentTotal({ p1: 3 }, 'p1')).toBe(3)
    expect(commentTotal({}, 'p1')).toBe(0)
    expect(countFrom({ p1: 7 }, 'p1')).toBe(7)
    expect(countFrom(undefined, 'p1')).toBe(0)
  })

  it('reports repost and save membership', () => {
    expect(userHasReposted([{ post_id: 'p1' }], 'p1')).toBe(true)
    expect(userHasReposted([], 'p1')).toBe(false)
    expect(isSaved([{ post_id: 'p1' }], 'p1')).toBe(true)
    expect(isSaved([{ post_id: 'p2' }], 'p1')).toBe(false)
  })

  it('reports following only for the viewer own follow rows', () => {
    const follows = [{ id: 'f1', follower_id: 'u1', following_id: 'a1' }]
    expect(isFollowing(follows, 'a1', 'u1')).toBe(true)
    // Someone else following the author does not mean the viewer does.
    expect(isFollowing(follows, 'a1', 'u2')).toBe(false)
    expect(isFollowing(follows, 'a1', null)).toBe(false)
  })

  it('locks subscriber-only posts unless yours or unlocked', () => {
    const post = { id: 'p1', user_id: 'a1', subscriber_only: true }
    expect(isLocked(post, [], 'u1')).toBe(true)
    expect(isLocked(post, ['a1'], 'u1')).toBe(false)
    // Your own subscriber-only post is never locked to you.
    expect(isLocked(post, [], 'a1')).toBe(false)
    // Legacy premium posts are treated as subscriber-only.
    expect(isLocked({ id: 'p2', user_id: 'a1', post_type: 'premium' }, [], 'u1')).toBe(true)
    expect(isLocked({ id: 'p3', user_id: 'a1' }, [], 'u1')).toBe(false)
  })

  // These strings are already on screen. The assertions below are the CURRENT
  // output, transcribed from Feed.jsx:1687-1700 — this task must not change them.
  it('formats counts compactly', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(null)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1000)).toBe('1k')
    expect(formatCount(1500)).toBe('1.5k')
    // At and above 10k the fraction is dropped.
    expect(formatCount(12500)).toBe('13k')
    expect(formatCount(1000000)).toBe('1M')
    expect(formatCount(2500000)).toBe('2.5M')
  })

  it('renders relative time', () => {
    const now = Date.now()
    expect(timeAgo(new Date(now - 30 * 1000).toISOString())).toBe('just now')
    expect(timeAgo(new Date(now - 5 * 60 * 1000).toISOString())).toBe('5m ago')
    expect(timeAgo(new Date(now - 3 * 3600 * 1000).toISOString())).toBe('3h ago')
    expect(timeAgo(new Date(now - 2 * 86400 * 1000).toISOString())).toBe('2d ago')
  })

  it('resolves a repost source from the loaded page or the fetched map', () => {
    const posts = [{ id: 's1', content: 'source' }]
    const sources = { s2: { id: 's2', content: 'fetched' } }
    expect(resolveSourceFrom(posts, sources, 's1').content).toBe('source')
    expect(resolveSourceFrom(posts, sources, 's2').content).toBe('fetched')
    expect(resolveSourceFrom(posts, sources, 's3')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/social-feed/postSelectors.test.js`
Expected: FAIL — `Failed to resolve import "./postSelectors.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/social-feed/postSelectors.js`:

```js
// Pure derivations over engagement state. No React, no I/O, no Supabase.
// Every function takes the state it reads as its first argument, which is what
// makes them testable without a component and reusable by both the feed and a
// single-post page.

export function likeCount(reactions, postId) {
  return (reactions || []).filter((r) => r.post_id === postId).length
}

export function userHasLiked(reactions, postId, userId) {
  if (!userId) return false
  return (reactions || []).some((r) => r.post_id === postId && r.user_id === userId)
}

// Counts that arrive pre-aggregated as { [postId]: n }.
export function countFrom(map, postId) {
  return (map || {})[postId] || 0
}

export const commentTotal = countFrom

export function userHasReposted(repostedPosts, postId) {
  return (repostedPosts || []).some((r) => r.post_id === postId)
}

export function isSaved(savedPosts, postId) {
  return (savedPosts || []).some((s) => s.post_id === postId)
}

// A follow row exists for many viewers; only the viewer's own row counts.
export function isFollowing(follows, authorId, userId) {
  if (!userId) return false
  return (follows || []).some((f) => f.follower_id === userId && f.following_id === authorId)
}

// Locked = subscriber-only (or legacy premium), not yours, not unlocked.
export function isLocked(post, unlockedCreators, userId) {
  if (!post) return false
  const locked = post.subscriber_only || post.post_type === 'premium'
  if (!locked) return false
  if (userId && post.user_id === userId) return false
  return !(unlockedCreators || []).includes(post.user_id)
}

// A repost carries no content of its own, so its source is either already on
// the loaded page or was fetched alongside it.
export function resolveSourceFrom(posts, repostSources, id) {
  return (posts || []).find((p) => p.id === id) || (repostSources || {})[id] || null
}

// Moved verbatim from Feed.jsx:1687-1700. These exact strings are already on
// screen across every feed card — do not "improve" the thresholds or wording
// here; that would be a UI change hiding inside a refactor.
export function formatCount(n) {
  n = n || 0
  if (n < 1000) return `${n}`
  if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`.replace('.0k', 'k')
  return `${(n / 1000000).toFixed(1)}M`.replace('.0M', 'M')
}

export function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/modules/social-feed/postSelectors.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full suite — nothing else may move**

Run: `npm test`
Expected: 515 files' worth of tests green (514 existing + the new file). Nothing imports the new module yet, so any failure here is unrelated and must be investigated before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/modules/social-feed/postSelectors.js src/modules/social-feed/postSelectors.test.js
git commit -m "refactor(carefind): extract pure post engagement selectors

Additive only — nothing imports these yet. Splitting the pure
derivations out first is what makes the hook in the next task
testable without a component."
```

---

### Task 2: `usePostEngagement` — state and `hydrate`

**Files:**
- Create: `src/modules/social-feed/usePostEngagement.js`
- Test: `src/modules/social-feed/usePostEngagement.test.jsx`

**Interfaces:**
- Consumes: every export of `postSelectors.js` (Task 1).
- Produces: `usePostEngagement({ user, navigate, toast })` returning
  `{ state, engagementProps, hydrate }` where
  `hydrate(posts, { merge = false }) => Promise<EngineContext>`.
  `EngineContext` is `{ lCounts, cCounts, sCounts, saveCounts, giftStats, follows, viewerReactionIds, viewerCommentIds, viewerSaveIds, profiles, businesses, interest }` — exactly what `rankByScore`/`rankForYou` already consume, so `Feed.jsx` can pass it straight through in Task 4.

- [ ] **Step 1: Write the failing test**

Create `src/modules/social-feed/usePostEngagement.test.jsx`:

```jsx
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSupabase = vi.hoisted(() => {
  const data = {
    tables: {
      post_reactions: [], post_reposts: [], profiles: [], post_comments: [],
      post_shares: [], saved_posts: [], follows: [], user_subscriptions: [],
      businesses: [],
    },
    rpcRows: {},
  }
  const rows = (t) => data.tables[t] || []
  const matches = (row, cons) =>
    Object.entries(cons).every(([col, vals]) => {
      const arr = Array.isArray(vals) ? vals : [vals]
      return arr.flat().some((v) => row[col] === v)
    })
  function builder(table) {
    const cons = {}
    const b = {
      select: vi.fn(() => b),
      order: vi.fn(() => b),
      limit: vi.fn(() => b),
      eq: vi.fn((c, v) => { (cons[c] = cons[c] || []).push(v); return b }),
      in: vi.fn((c, vs) => { (cons[c] = cons[c] || []).push(vs); return b }),
      maybeSingle: vi.fn(() => Promise.resolve({ data: rows(table).find((r) => matches(r, cons)) || null, error: null })),
      then: (res) => Promise.resolve({ data: rows(table).filter((r) => matches(r, cons)), error: null }).then(res),
    }
    return b
  }
  return {
    supabase: {
      from: vi.fn((t) => builder(t)),
      rpc: vi.fn((fn) => Promise.resolve({ data: data.rpcRows[fn] || [], error: null })),
    },
    data,
  }
})

vi.mock('../../config/supabaseClient', () => ({ supabase: mockSupabase.supabase }))

import { usePostEngagement } from './usePostEngagement.js'

const USER = { id: 'u1' }
const post = (id, userId = 'a1') => ({ id, user_id: userId, post_type: 'text', content: 'x', created_at: '2026-01-01T00:00:00.000Z' })

function setup() {
  return renderHook(() => usePostEngagement({ user: USER, navigate: vi.fn(), toast: { show: vi.fn() } }))
}

beforeEach(() => {
  Object.keys(mockSupabase.data.tables).forEach((t) => { mockSupabase.data.tables[t] = [] })
  mockSupabase.data.rpcRows = {}
})

describe('usePostEngagement.hydrate', () => {
  it('derives the same per-post context for one post as for many', async () => {
    mockSupabase.data.tables.post_reactions = [
      { id: 'r1', post_id: 'p1', user_id: 'u2' },
      { id: 'r2', post_id: 'p2', user_id: 'u2' },
    ]

    const many = setup()
    await act(async () => { await many.result.current.hydrate([post('p1'), post('p2')]) })
    const manyLikes = many.result.current.engagementProps.likeCount('p1')

    const one = setup()
    await act(async () => { await one.result.current.hydrate([post('p1')]) })
    const oneLikes = one.result.current.engagementProps.likeCount('p1')

    expect(oneLikes).toBe(manyLikes)
    expect(oneLikes).toBe(1)
  })

  it('merge:false drops posts absent from the new batch', async () => {
    mockSupabase.data.tables.post_reactions = [{ id: 'r1', post_id: 'p1', user_id: 'u2' }]
    const { result } = setup()
    await act(async () => { await result.current.hydrate([post('p1')]) })
    expect(result.current.engagementProps.likeCount('p1')).toBe(1)

    // A feed refetch that no longer contains p1 must not leave its counts behind.
    mockSupabase.data.tables.post_reactions = [{ id: 'r2', post_id: 'p9', user_id: 'u2' }]
    await act(async () => { await result.current.hydrate([post('p9')], { merge: false }) })
    expect(result.current.engagementProps.likeCount('p1')).toBe(0)
    expect(result.current.engagementProps.likeCount('p9')).toBe(1)
  })

  it('merge:true preserves existing state and never double-counts a re-hydrate', async () => {
    mockSupabase.data.tables.post_reactions = [{ id: 'r1', post_id: 'p1', user_id: 'u2' }]
    const { result } = setup()
    await act(async () => { await result.current.hydrate([post('p1')]) })

    // A deep-linked post arriving must not clobber the feed behind it...
    mockSupabase.data.tables.post_reactions = [{ id: 'r2', post_id: 'p2', user_id: 'u2' }]
    await act(async () => { await result.current.hydrate([post('p2')], { merge: true }) })
    expect(result.current.engagementProps.likeCount('p1')).toBe(1)
    expect(result.current.engagementProps.likeCount('p2')).toBe(1)

    // ...and hydrating the same post twice must not count its reactions twice.
    await act(async () => { await result.current.hydrate([post('p2')], { merge: true }) })
    expect(result.current.engagementProps.likeCount('p2')).toBe(1)
  })

  it('returns an engine context shaped for the ranker', async () => {
    mockSupabase.data.tables.post_reactions = [{ id: 'r1', post_id: 'p1', user_id: 'u1' }]
    const { result } = setup()
    let ctx
    await act(async () => { ctx = await result.current.hydrate([post('p1')]) })
    expect(ctx).toHaveProperty('lCounts')
    expect(ctx).toHaveProperty('cCounts')
    expect(ctx).toHaveProperty('profiles')
    expect(ctx).toHaveProperty('interest')
    expect(ctx.lCounts.p1).toBe(1)
    // The viewer's own reaction feeds the affinity signal.
    expect(ctx.viewerReactionIds.has('p1')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/social-feed/usePostEngagement.test.jsx`
Expected: FAIL — `Failed to resolve import "./usePostEngagement.js"`.

- [ ] **Step 3: Create the hook with its state slices**

Create `src/modules/social-feed/usePostEngagement.js`. Declare the state, importing the selectors from Task 1:

```js
import { useState, useCallback } from 'react'
import { supabase } from '../../config/supabaseClient'
import { buildInterestProfile } from './feedEngine'
import * as sel from './postSelectors.js'

// Owns everything that answers "what is this post's engagement context?" —
// the state, the reads that fill it, and the handlers that change it. Two
// consumers: the feed (many posts, overwrite) and PostPage (one post, merge).
export function usePostEngagement({ user, navigate, toast }) {
  const [reactions, setReactions] = useState([])
  const [profiles, setProfiles] = useState({})
  const [follows, setFollows] = useState([])
  const [savedPosts, setSavedPosts] = useState([])
  const [repostedPosts, setRepostedPosts] = useState([])
  const [repostSources, setRepostSources] = useState({})
  const [giftStats, setGiftStats] = useState({})
  const [commentCounts, setCommentCounts] = useState({})
  const [shareCounts, setShareCounts] = useState({})
  const [saveCounts, setSaveCounts] = useState({})
  const [userSubscriptions, setUserSubscriptions] = useState([])
  const [unlockedCreators, setUnlockedCreators] = useState([])
  const [comments, setComments] = useState({})
  const [openComments, setOpenComments] = useState({})
  const [commentDrafts, setCommentDrafts] = useState({})
  const [editingComment, setEditingComment] = useState(null)
  const [replyingTo, setReplyingTo] = useState(null)
  const [reportedPosts, setReportedPosts] = useState([])
  const [posts, setPosts] = useState([])

  // ... hydrate and engagementProps follow in the next steps
}
```

- [ ] **Step 4: Implement `hydrate` by generalising the two existing functions**

`hydrate` replaces both `enrichAndSetPosts` (`Feed.jsx:311`) and `enrichSinglePost` (`Feed.jsx:462`). Build it by taking the **batch** version as the base — it is the more complete of the two — and making three changes:

1. Replace each `.in('post_id', postIds)` with a filter built from the ids passed in (still `.in`, which is correct for one id as well as fifty).
2. Replace every `setX(value)` with `setX(applyMode(prev, value))`, where array slices merge by `id` (or `post_id` where there is no `id`) and map slices merge by spreading. `merge: false` assigns outright.
3. **Do not rank and do not call `setPosts(ranked)`.** Return the context object instead. Ranking is the feed's job and belongs in `Feed.jsx`.

Everything else — the `Promise.all` batch of six reads, the `post_gift_stats_batch` RPC in its `try/catch`, `buildInterestProfile` — moves across unchanged.

Write these two helpers at module scope first — they are the only genuinely new
logic in this task, and they are what makes change 2 above mechanical:

```js
// Merge-by-key for the array slices. `merge:false` replaces outright (a feed
// refetch must drop rows belonging to posts that fell out of the batch);
// `merge:true` appends only rows not already present, so hydrating the same
// post twice cannot double-count it.
function mergeRows(prev, next, key = 'id') {
  const seen = new Set((prev || []).map((r) => r[key]))
  return [...(prev || []), ...(next || []).filter((r) => !seen.has(r[key]))]
}

function applyRows(setter, next, { merge, key = 'id' }) {
  setter((prev) => (merge ? mergeRows(prev, next, key) : next))
}

// Map slices ({ [postId]: value }) merge by spreading; replacing drops keys
// for posts no longer in the batch, which is the point.
function applyMap(setter, next, { merge }) {
  setter((prev) => (merge ? { ...prev, ...next } : next))
}
```

Then the hydrate shell:

```js
  const hydrate = useCallback(async (postData, { merge = false } = {}) => {
    const list = postData || []
    const postIds = list.map((p) => p.id)
    if (postIds.length === 0) {
      if (!merge) { setReactions([]); setProfiles({}); setCommentCounts({}) }
      return null
    }

    // Everything from here to the `context` object is the body of
    // enrichAndSetPosts (Feed.jsx:321-427), moved across with only the three
    // changes above. Concretely, each write becomes:
    //
    //   setReactions(reactionData || [])
    //     -> applyRows(setReactions, reactionData || [], { merge })
    //   setFollows(followRowsArr)
    //     -> applyRows(setFollows, followRowsArr, { merge })
    //   setSavedPosts(mySavedRows?.data || [])
    //     -> applyRows(setSavedPosts, mySavedRows?.data || [], { merge, key: 'post_id' })
    //   setRepostedPosts(repostData || [])
    //     -> applyRows(setRepostedPosts, repostData || [], { merge, key: 'post_id' })
    //   setProfiles(profileMap)      -> applyMap(setProfiles, profileMap, { merge })
    //   setCommentCounts(cCounts)    -> applyMap(setCommentCounts, cCounts, { merge })
    //   setShareCounts(sCounts)      -> applyMap(setShareCounts, sCounts, { merge })
    //   setSaveCounts(saveCounts)    -> applyMap(setSaveCounts, saveCounts, { merge })
    //   setGiftStats(giftTotals)     -> applyMap(setGiftStats, giftTotals, { merge })
    //
    // Note the key: saved_posts and post_reposts rows are deduped by post_id,
    // not id — a viewer has at most one of each per post, and the id is the
    // join row's own, which differs between fetches.
    //
    // The ranking block at Feed.jsx:429-453 does NOT move. Stop after building
    // `context` and return it.

    return context
  }, [user])
```

- [ ] **Step 5: Assemble `engagementProps`**

```js
  const engagementProps = {
    profiles,
    comments, setComments,
    openComments,
    commentDrafts, setCommentDrafts,
    editingComment, setEditingComment,
    replyingTo, setReplyingTo,
    reportedPosts,
    formatCount: sel.formatCount,
    timeAgo: sel.timeAgo,
    likeCount: (id) => sel.likeCount(reactions, id),
    userHasLiked: (id) => sel.userHasLiked(reactions, id, user?.id),
    commentTotal: (id) => sel.commentTotal(commentCounts, id),
    shareCount: (id) => sel.countFrom(shareCounts, id),
    saveCount: (id) => sel.countFrom(saveCounts, id),
    giftCount: (id) => (giftStats[id]?.gift_count) || 0,
    userHasReposted: (id) => sel.userHasReposted(repostedPosts, id),
    isSaved: (id) => sel.isSaved(savedPosts, id),
    isFollowing: (authorId) => sel.isFollowing(follows, authorId, user?.id),
    isLocked: (post) => sel.isLocked(post, unlockedCreators, user?.id),
    resolveSource: (id) => sel.resolveSourceFrom(posts, repostSources, id),
  }

  return {
    hydrate,
    engagementProps,
    state: {
      posts, setPosts, reactions, setReactions, follows, setFollows,
      savedPosts, setSavedPosts, repostedPosts, setRepostedPosts,
      repostSources, setRepostSources, giftStats, setGiftStats,
      commentCounts, setCommentCounts, shareCounts, setShareCounts,
      saveCounts, setSaveCounts, userSubscriptions, setUserSubscriptions,
      unlockedCreators, setUnlockedCreators, openComments, setOpenComments,
      reportedPosts, setReportedPosts, profiles, setProfiles,
    },
  }
}
```

`state` is exposed only so `Feed.jsx` can keep working during Task 4's migration and so the handlers in Task 3 have somewhere to live. It is not part of the long-term contract — `PostPage` must never touch it.

- [ ] **Step 6: Run the hook tests**

Run: `npx vitest run src/modules/social-feed/usePostEngagement.test.jsx`
Expected: PASS, 4 tests.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all green. Still nothing consumes the hook.

- [ ] **Step 8: Commit**

```bash
git add src/modules/social-feed/usePostEngagement.js src/modules/social-feed/usePostEngagement.test.jsx
git commit -m "refactor(carefind): add usePostEngagement with a merge-aware hydrate

Generalises enrichAndSetPosts and enrichSinglePost into one function.
Overwrite vs merge is now an explicit argument rather than two
near-identical bodies. Not yet consumed."
```

---

### Task 3: Move the engagement handlers into the hook

**Files:**
- Modify: `src/modules/social-feed/usePostEngagement.js`
- Modify: `src/modules/social-feed/usePostEngagement.test.jsx`

**Interfaces:**
- Consumes: the state slices from Task 2.
- Produces: `engagementProps` additionally carries `toggleLike(postId)`, `toggleSave(postId)`, `toggleRepost(post)`, `toggleFollow(authorId)`, `toggleComments(postId)`, `sharePost(post)`, `shareCard(post)`, `openReport(postId)`, `handleEditPost(postId, newContent, postType)`, `handleCommentAdded({ postId, parentId })`.

- [ ] **Step 1: Write the failing test**

Append to `src/modules/social-feed/usePostEngagement.test.jsx`:

```jsx
describe('usePostEngagement handlers', () => {
  it('optimistically likes and reconciles against the insert', async () => {
    mockSupabase.data.tables.post_reactions = []
    const { result } = setup()
    await act(async () => { await result.current.hydrate([post('p1')]) })
    expect(result.current.engagementProps.userHasLiked('p1')).toBe(false)

    await act(async () => { await result.current.engagementProps.toggleLike('p1') })
    expect(result.current.engagementProps.userHasLiked('p1')).toBe(true)
  })

  it('does nothing when a logged-out viewer taps like', async () => {
    const { result } = renderHook(() =>
      usePostEngagement({ user: null, navigate: vi.fn(), toast: { show: vi.fn() } }))
    await act(async () => { await result.current.engagementProps.toggleLike('p1') })
    expect(result.current.engagementProps.likeCount('p1')).toBe(0)
  })

  it('toggles a comment panel open and closed', async () => {
    const { result } = setup()
    await act(async () => { await result.current.engagementProps.toggleComments('p1') })
    expect(result.current.state.openComments.p1).toBeTruthy()
    await act(async () => { await result.current.engagementProps.toggleComments('p1') })
    expect(result.current.state.openComments.p1).toBeFalsy()
  })

  it('bumps the comment count when a comment is added', async () => {
    const { result } = setup()
    await act(async () => { await result.current.hydrate([post('p1')]) })
    const before = result.current.engagementProps.commentTotal('p1')
    act(() => { result.current.engagementProps.handleCommentAdded({ postId: 'p1', parentId: null }) })
    expect(result.current.engagementProps.commentTotal('p1')).toBe(before + 1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/social-feed/usePostEngagement.test.jsx -t "handlers"`
Expected: FAIL — `toggleLike is not a function`.

- [ ] **Step 3: Move the handler bodies verbatim**

Move each function from `Feed.jsx` into the hook. These are **moves, not rewrites** — copy the body exactly, then fix only what the new scope requires:

| Handler | Source lines in `Feed.jsx` |
|---|---|
| `toggleLike` | 1323–1373 |
| `toggleComments` | 1374–1386 |
| `handleCommentAdded` | 1395–1404 |
| `toggleFollow` | 1410–1442 |
| `openReport` | 1443–1451 |
| `sharePost` | 1494–1534 |
| `toggleSave` | 1539–1585 |
| `toggleRepost` | 1615–1686 |
| `handleEditPost` | 1297–1315 |
| `shareCard` | 1002–1050 |

Scope fixes required, and no others:
- `toast.show(...)` — `toast` is now a hook argument, already in scope.
- `user` — now a hook argument.
- `navigate` — now a hook argument.
- Any reference to Feed-only state (e.g. `setSharingId` inside `sharePost`) must become an optional callback argument on the hook: add `onSharingChange` to the hook's parameters, default `() => {}`, and call that instead. Feed passes `setSharingId`; `PostPage` passes nothing.

Add all ten to `engagementProps`.

- [ ] **Step 4: Run the hook tests**

Run: `npx vitest run src/modules/social-feed/usePostEngagement.test.jsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all green. `Feed.jsx` still has its own copies; nothing is wired yet.

- [ ] **Step 6: Commit**

```bash
git add src/modules/social-feed/usePostEngagement.js src/modules/social-feed/usePostEngagement.test.jsx
git commit -m "refactor(carefind): move post engagement handlers into the hook

Bodies moved verbatim from Feed.jsx; only scope references changed.
Feed still holds its copies — the swap is the next commit, kept
separate so a regression bisects to one or the other."
```

---

### Task 4: Rewire `Feed.jsx` onto the hook

**Files:**
- Modify: `src/modules/social-feed/Feed.jsx`

**Interfaces:**
- Consumes: `usePostEngagement` (Tasks 2–3).
- Produces: no new exports. `Feed.jsx` shrinks by roughly 600 lines.

This is the highest-risk task in the plan. It changes no behaviour, so **any** test that goes red is a real regression.

- [ ] **Step 1: Capture the green baseline**

Run: `npm test 2>&1 | tail -5`
Write the exact file and test counts down. That number is the contract for this task.

- [ ] **Step 2: Mount the hook alongside the existing code**

Near the top of `Feed()`, after `const toast = useToast()`:

```js
  const engagement = usePostEngagement({
    user,
    navigate,
    toast,
    onSharingChange: setSharingId,
  })
```

Do not delete anything yet. The app now has both implementations; the hook's is unused.

- [ ] **Step 3: Delete the duplicated state declarations**

Remove these `useState` lines from `Feed.jsx` and replace every reference with the hook's equivalent (`engagement.state.X` for setters, `engagement.engagementProps.X` for selectors): `posts`, `reactions`, `profiles`, `follows`, `savedPosts`, `repostedPosts`, `repostSources`, `giftStats`, `commentCounts`, `shareCounts`, `saveCounts`, `userSubscriptions`, `unlockedCreators`, `comments`, `openComments`, `commentDrafts`, `editingComment`, `replyingTo`, `reportedPosts`.

Keep every other `useState` — composer, tabs, ranking config, experiments, pull-to-refresh, stories, live, news, and the modal/chrome state named in the File Structure boundary rule.

- [ ] **Step 4: Delete the duplicated functions**

Remove from `Feed.jsx`: `enrichAndSetPosts`, `enrichSinglePost`, and the ten handlers listed in Task 3 Step 3, plus `likeCount`, `userHasLiked`, `commentTotal`, `shareCount`, `saveCount`, `giftCount`, `userHasReposted`, `isSaved`, `isFollowing`, `isLocked`, `formatCount`, `timeAgo`.

- [ ] **Step 5: Reconnect `loadFeed` to `hydrate` + ranking**

`loadFeed` previously called `await enrichAndSetPosts(postData)`, which both fetched and ranked. Split that:

```js
    const context = await engagement.hydrate(postData, { merge: false })
    if (context) {
      const byScore = rankByScore({ posts: postData, context, weights: rankConfig.weights })
      let ranked
      if (feedTab === 'foryou') {
        const effective = applyExperimentConfig({
          base: { weights: rankConfig.weights, diversity: rankConfig.diversity, pools: poolsConfig },
          experiment: activeExperiment,
        })
        ranked = rankForYou({ posts: postData, context, weights: effective.weights, diversity: effective.diversity, pools: effective.pools })
      } else if (feedTab === 'nearby') {
        ranked = rankNearby(byScore, context)
      } else {
        ranked = byScore
      }
      engagement.state.setPosts(ranked)
    }
```

This is the ranking block moved verbatim out of `enrichAndSetPosts` (`Feed.jsx:429-453`). It belongs to the feed, which is why it did not move into the hook.

Update `runFeedSearch` the same way, and the deep-link path to call `engagement.hydrate([data], { merge: true })`.

- [ ] **Step 6: Rebuild `cardProps` from the hook plus Feed's own chrome**

```js
  // Spread the hook first, then Feed's own chrome. `shareCard`,
  // `handleEditPost` and every selector already arrive in engagementProps —
  // do not re-list them here, or a future change to the hook will be silently
  // shadowed by a stale copy.
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

- [ ] **Step 7: Run the full suite against the baseline**

Run: `npm test`
Expected: **exactly** the counts recorded in Step 1. Not "about the same" — identical. A changed count means behaviour moved.

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: clean, chunk-size warning only.

- [ ] **Step 9: Manually verify the feed still behaves**

Run `npm run dev` and confirm on `/feed`: like toggles and survives a refresh; comments open and post; repost shows "Reposted by"; save toggles; follow toggles; share copies; the For You / Following / Videos tabs all populate; pull-to-refresh works.

- [ ] **Step 10: Commit**

```bash
git add src/modules/social-feed/Feed.jsx
git commit -m "refactor(carefind): consume usePostEngagement in Feed

Behaviour-preserving. Feed keeps ranking, the composer, tabs,
experiments and its own chrome state; everything describing a post's
engagement now comes from the hook. Test counts identical before and
after."
```

---

### Task 5: `PostPage`

**Files:**
- Create: `src/modules/social-feed/PostPage.jsx`
- Test: `src/modules/social-feed/PostPage.test.jsx`
- Modify: `src/main.jsx`

**Interfaces:**
- Consumes: `usePostEngagement` (Tasks 2–3), `postRepository.getPostById`, `PostCard`.
- Produces: default-exported `PostPage`, routed at `/post/:id`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/social-feed/PostPage.test.jsx`:

```jsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../config/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => {
      const b = {
        select: vi.fn(() => b), eq: vi.fn(() => b), in: vi.fn(() => b),
        order: vi.fn(() => b), limit: vi.fn(() => b),
        maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        then: (r) => Promise.resolve({ data: [], error: null }).then(r),
      }
      return b
    }),
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
  },
}))
vi.mock('../../providers/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('./repositories', () => ({ postRepository: { getPostById: vi.fn() }, commentRepository: {} }))
vi.mock('./components/CommentThread.jsx', () => ({ CommentThread: () => <div>comments</div> }))
vi.mock('../../components/BottomNav.jsx', () => ({ default: () => null }))
vi.mock('../../components/layout/AppShell.jsx', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../components/layout/RightSidebar.jsx', () => ({ default: () => null }))
vi.mock('../../utils/VisualCard.jsx', () => ({ default: () => <div /> }))
vi.mock('../news-publishing/ArticleEditor.jsx', () => ({ default: () => <div /> }))
vi.mock('./PostMenu.jsx', () => ({ default: () => null }))
vi.mock('../subscriptions-monetization/GiftPanel.jsx', () => ({ default: () => null }))

import PostPage from './PostPage.jsx'
import { postRepository } from './repositories'

function renderAt(id = 'p1') {
  return render(
    <MemoryRouter initialEntries={[`/post/${id}`]}>
      <Routes><Route path="/post/:id" element={<PostPage />} /></Routes>
    </MemoryRouter>
  )
}

beforeEach(() => { postRepository.getPostById.mockReset() })

describe('PostPage', () => {
  it('shows a loading state while the post is in flight', () => {
    postRepository.getPostById.mockReturnValue(new Promise(() => {}))
    renderAt()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders the post body once loaded', async () => {
    postRepository.getPostById.mockResolvedValue({
      id: 'p1', user_id: 'a1', post_type: 'text',
      content: 'The body of a permalinked post.',
      created_at: '2026-01-01T00:00:00.000Z',
    })
    renderAt()
    expect(await screen.findByText(/body of a permalinked post/i)).toBeInTheDocument()
  })

  it('renders the conversation below the post', async () => {
    postRepository.getPostById.mockResolvedValue({
      id: 'p1', user_id: 'a1', post_type: 'text', content: 'x',
      created_at: '2026-01-01T00:00:00.000Z',
    })
    renderAt()
    expect(await screen.findByText('comments')).toBeInTheDocument()
  })

  it('shows the not-available state when the post is missing', async () => {
    postRepository.getPostById.mockRejectedValue(new Error('PGRST116'))
    renderAt()
    expect(await screen.findByText(/isn't available/i)).toBeInTheDocument()
  })

  it('does not distinguish a deleted post from a hidden one', async () => {
    postRepository.getPostById.mockResolvedValue(null)
    renderAt()
    const msg = await screen.findByText(/isn't available/i)
    expect(msg.textContent).not.toMatch(/deleted|private|permission|denied/i)
  })

  it('exposes one h1 and a main landmark', async () => {
    postRepository.getPostById.mockResolvedValue({
      id: 'p1', user_id: 'a1', post_type: 'text', content: 'x',
      created_at: '2026-01-01T00:00:00.000Z',
    })
    renderAt()
    await screen.findByRole('main')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/social-feed/PostPage.test.jsx`
Expected: FAIL — cannot resolve `./PostPage.jsx`.

- [ ] **Step 3: Implement `PostPage`**

```jsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../providers/AuthContext'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import { theme } from '../../styles/theme'
import AppShell from '../../components/layout/AppShell.jsx'
import RightSidebar from '../../components/layout/RightSidebar.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import { CardSkeleton, Empty, useToast } from '../../components/ui'
import { usePostEngagement } from './usePostEngagement.js'
import { postRepository } from './repositories'
import PostCard from './PostCard.jsx'

// A post at its own URL. Second consumer of usePostEngagement — the feed is
// the first. Deleted and RLS-hidden posts render identically on purpose:
// telling them apart would leak whether a private post exists.
export default function PostPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)
  const engagement = usePostEngagement({ user, navigate, toast })

  const [post, setPost] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const headingRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setNotFound(false)
    postRepository
      .getPostById(id)
      .then(async (data) => {
        if (cancelled) return
        if (!data) { setNotFound(true); setLoading(false); return }
        await engagement.hydrate([data], { merge: true })
        if (cancelled) return
        setPost(data)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setNotFound(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [id])

  // A reader arriving from a shared link should land on the post, not the nav.
  useEffect(() => { if (post) headingRef.current?.focus() }, [post])

  const cardProps = {
    ...engagement.engagementProps,
    user,
    navigate,
    authorName: (p) => {
      if (p.posted_as_type) return p.posted_as_name || 'Business'
      const prof = engagement.engagementProps.profiles[p.user_id]
      return prof?.full_name || prof?.display_name || 'CareFind user'
    },
    myUsername,
    myAvatar,
    onGift: () => {},
    setEditingPost: () => {},
    setConfirmDeleteId: () => {},
  }

  const body = (
    <main
      role="main"
      style={{
        fontFamily: theme.fontFamily,
        maxWidth: isMobile ? 480 : 640,
        margin: '0 auto',
        padding: isMobile ? '12px 16px calc(90px + env(safe-area-inset-bottom))' : '12px 0',
      }}
    >
      {loading && (
        <div role="status" aria-live="polite">
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            Loading post
          </span>
          <CardSkeleton />
        </div>
      )}

      {!loading && notFound && (
        <Empty
          message={
            <>
              <div style={{ fontSize: 15, fontWeight: 800, color: theme.navy, marginBottom: 4 }}>
                This post isn't available
              </div>
              <div style={{ fontSize: 13, color: theme.gray500 }}>
                It may have been removed, or you may not have access to it.
              </div>
            </>
          }
          action="Go to feed"
          onAction={() => navigate('/feed')}
        />
      )}

      {!loading && !notFound && post && (
        <>
          <h1
            ref={headingRef}
            tabIndex={-1}
            style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}
          >
            Post by {cardProps.authorName(post)}
          </h1>
          <PostCard {...cardProps} post={post} preview={false} />
        </>
      )}

      {isMobile && <BottomNav />}
    </main>
  )

  if (isMobile) return body
  return (
    <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs}>
      {body}
      <RightSidebar />
    </AppShell>
  )
}
```

The `h1` is visually hidden because `PostCard` already renders the author header visibly; a second visible title would duplicate it. It still gives screen readers and focus management a real landmark.

- [ ] **Step 4: Run the PostPage tests**

Run: `npx vitest run src/modules/social-feed/PostPage.test.jsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the route**

In `src/main.jsx`, import `PostPage` and add alongside the other public routes:

```jsx
<Route path="/post/:id" element={<PostPage />} />
```

Place it in the "Public — no login required" block, next to `/u/:id`. A post permalink must be readable logged-out; RLS decides what is visible.

- [ ] **Step 6: Run the full suite and build**

Run: `npm test && npm run build`
Expected: green; build clean.

- [ ] **Step 7: Verify responsive**

`npm run dev`, open `/post/<a real id>` at 375, 768 and 1280. Confirm no horizontal scroll, the card fills the column, and `BottomNav` appears only on mobile.

- [ ] **Step 8: Commit**

```bash
git add src/modules/social-feed/PostPage.jsx src/modules/social-feed/PostPage.test.jsx src/main.jsx
git commit -m "feat(carefind): add /post/:id permalink page

Second consumer of usePostEngagement, which is what makes the seam
real. Deleted and RLS-hidden posts render identically so the page
cannot be used to probe whether a private post exists."
```

---

### Task 6: Open the modal via background location

**Files:**
- Modify: `src/main.jsx`
- Modify: `src/modules/social-feed/Feed.jsx`
- Test: `src/modules/social-feed/Feed.test.jsx`

**Interfaces:**
- Consumes: the `/post/:id` route (Task 5).
- Produces: in-feed navigation that changes the URL without unmounting the feed.

- [ ] **Step 1: Write the failing test**

Append to `src/modules/social-feed/Feed.test.jsx`:

```jsx
describe('post permalinks', () => {
  it('keeps the feed mounted when a post is opened from within it', async () => {
    mockSupabase.data.tables.posts = [makePost({ id: 'p1', content: 'Feed body text' })]
    renderFeed('/feed')
    const seeMore = await screen.findByRole('button', { name: /see more/i })
    fireEvent.click(seeMore)
    // The feed list is still rendered behind the modal.
    await waitFor(() => expect(screen.getByText(/Feed body text/)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/social-feed/Feed.test.jsx -t "permalinks"`
Expected: FAIL — no "See more" button, or the feed unmounts.

- [ ] **Step 3: Split the routes on background location**

In `src/main.jsx`, replace the single `<Routes>` with a location-aware wrapper. `BrowserRouter` must stay outermost, so introduce a small component inside it:

```jsx
function AppRoutes() {
  const location = useLocation()
  const background = location.state && location.state.background
  return (
    <>
      <Routes location={background || location}>
        {/* every existing route, unchanged */}
      </Routes>
      {background && (
        <Routes>
          <Route path="/post/:id" element={<Feed />} />
        </Routes>
      )}
    </>
  )
}
```

Import `useLocation` from `react-router-dom`. Render `<AppRoutes />` inside `<ErrorBoundary>`.

When `background` is set, the first `<Routes>` renders the feed at its remembered location and the second renders `Feed` again for the modal — so `Feed` itself must read `useParams()` for the modal id rather than the `?post=` query. Do that in the next step.

- [ ] **Step 4: Point Feed's card taps at the new URL**

In `Feed.jsx`, replace `openPostDetail(post)` calls originating from a card with a navigation:

```js
  function openPostDetail(post) {
    navigate(`/post/${post.id}`, { state: { background: location } })
  }
```

Add `const location = useLocation()` to `Feed()` and import `useLocation`.

Keep `setDetailPost` / `closePostDetail`, but drive them from the route: when `useParams().id` is present and a background exists, resolve that post (from `posts` if loaded, else `postRepository.getPostById` + `hydrate([post], { merge: true })`) and show `PostDetailModal`. Closing the modal calls `navigate(-1)`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/modules/social-feed/Feed.test.jsx`
Expected: PASS, including the existing deep-link cases.

- [ ] **Step 6: Cover the merge race the modal creates**

This is the scenario spec §8 names: the modal is open (its post was hydrated
with `merge: true`) and the feed behind it refreshes (`merge: false`). The
overwrite must not blank the open post's counts, and the modal must not
resurrect posts the refresh dropped.

Append to `src/modules/social-feed/raceConditions.test.js`:

```jsx
describe('modal open while the feed refreshes', () => {
  it('keeps the open post hydrated when a feed refetch overwrites', async () => {
    const { result } = renderHook(() =>
      usePostEngagement({ user: { id: 'u1' }, navigate: vi.fn(), toast: { show: vi.fn() } }))

    // Feed loads p1; the reader opens p2 from a notification (merge).
    mockSupabase.data.tables.post_reactions = [{ id: 'r1', post_id: 'p1', user_id: 'u2' }]
    await act(async () => { await result.current.hydrate([{ id: 'p1', user_id: 'a1' }]) })
    mockSupabase.data.tables.post_reactions = [{ id: 'r2', post_id: 'p2', user_id: 'u2' }]
    await act(async () => { await result.current.hydrate([{ id: 'p2', user_id: 'a1' }], { merge: true }) })

    // The feed now refreshes and no longer returns p1.
    mockSupabase.data.tables.post_reactions = [{ id: 'r3', post_id: 'p3', user_id: 'u2' }]
    await act(async () => { await result.current.hydrate([{ id: 'p3', user_id: 'a1' }], { merge: false }) })

    // p1 is gone with the batch it belonged to...
    expect(result.current.engagementProps.likeCount('p1')).toBe(0)
    expect(result.current.engagementProps.likeCount('p3')).toBe(1)
  })
})
```

Import `renderHook`, `act` and `usePostEngagement` at the top of that file if it
does not already have them.

**If this test shows the open modal's post losing its counts on a feed refresh,
that is a real defect, not a bad test** — the fix is for `Feed` to re-hydrate
the open post with `merge: true` after a refetch, not to weaken the assertion.

- [ ] **Step 7: Verify Back behaves**

`npm run dev`: from `/feed`, open a post — the URL becomes `/post/<id>` and the feed stays behind it. Press Back — the modal closes and you are on `/feed` with scroll position intact. Reload while the modal is open — you get the full `PostPage`.

- [ ] **Step 8: Run the full suite and commit**

```bash
npm test && npm run build
git add src/main.jsx src/modules/social-feed/Feed.jsx src/modules/social-feed/Feed.test.jsx src/modules/social-feed/raceConditions.test.js
git commit -m "feat(carefind): open posts at their URL via background location

One URL serves both surfaces: in-feed taps render the modal over the
feed, a cold load of the same URL renders the full page. Back now
closes the modal instead of leaving the page."
```

---

### Task 7: Redirect the old URL and emit the new one

**Files:**
- Modify: `src/modules/social-feed/Feed.jsx`
- Modify: `src/modules/account/Notifications.jsx:150`
- Test: `src/modules/social-feed/Feed.test.jsx`

**Interfaces:**
- Consumes: `/post/:id` (Task 5).
- Produces: nothing new; `?post=` becomes a permanent redirect.

- [ ] **Step 1: Write the failing test**

Append to `src/modules/social-feed/Feed.test.jsx`:

```jsx
describe('legacy ?post= links', () => {
  it('redirects an old share URL to the permalink', async () => {
    postRepository.getPostById.mockResolvedValue(makePost({ id: 'p1' }))
    render(
      <MemoryRouter initialEntries={['/feed?post=p1']}>
        <Routes>
          <Route path="/feed" element={<Feed />} />
          <Route path="/post/:id" element={<div>permalink page</div>} />
        </Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText('permalink page')).toBeInTheDocument()
  })
})
```

Add `Routes`, `Route` to the `react-router-dom` import at the top of the file.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/social-feed/Feed.test.jsx -t "legacy"`
Expected: FAIL — "permalink page" never renders.

- [ ] **Step 3: Redirect in Feed**

At the top of `Feed()`'s render, before any other early return:

```jsx
  // Every URL shared before permalinks existed, and every notifications.link
  // row written before this change, uses ?post=<id>. Redirect rather than
  // maintain a second way in.
  if (deepLinkPostId && !useParams().id) {
    return <Navigate to={`/post/${deepLinkPostId}`} replace />
  }
```

Import `Navigate` and `useParams` from `react-router-dom`. Hooks must run unconditionally, so compute `useParams()` into a variable at the top of the component alongside the other hooks, and use that variable here.

- [ ] **Step 4: Emit the new shape from Notifications**

In `src/modules/account/Notifications.jsx`, change line 150:

```js
const to = n.post_id && POST_LINK_TYPES.has(n.type) ? `/post/${n.post_id}` : n.link
```

Existing rows are unaffected — they are read through `post_id`, not the stored `link`, for these types.

- [ ] **Step 5: Update the share URL builder**

Find where `sharePost` builds its URL in the hook (moved in Task 3, originally `Feed.jsx:1494`) and change the shared link from `/feed?post=${post.id}` to `/post/${post.id}`.

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: green. The existing "shares a post with a ?post=<id> URL" test will now fail — **update it** to assert `/post/p1`. That test asserted the old contract; changing it is the point of this task, not a regression.

- [ ] **Step 7: Commit**

```bash
git add src/modules/social-feed/Feed.jsx src/modules/social-feed/usePostEngagement.js src/modules/account/Notifications.jsx src/modules/social-feed/Feed.test.jsx
git commit -m "feat(carefind): redirect ?post= to /post/:id and emit the new shape

No already-shared link and no existing notifications row breaks; the
old URL is a permanent redirect rather than a second supported entry."
```

---

### Task 8: Open Graph for the new URL

**Files:**
- Modify: `src/lib/openGraph.js:64`
- Test: `src/lib/openGraph.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseShareTarget('/post/<uuid>')` → `{ kind: 'post', id }`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/openGraph.test.js`:

```js
describe('parseShareTarget — permalinks', () => {
  const ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

  it('parses the permalink shape', () => {
    expect(parseShareTarget(`/post/${ID}`)).toEqual({ kind: 'post', id: ID })
  })

  it('still parses the legacy query shape so old shares keep previewing', () => {
    expect(parseShareTarget(`/feed?post=${ID}`)).toEqual({ kind: 'post', id: ID })
  })

  it('rejects a non-uuid permalink', () => {
    expect(parseShareTarget('/post/not-a-uuid')).toBeNull()
    expect(parseShareTarget('/post/')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/openGraph.test.js -t "permalinks"`
Expected: FAIL — returns `null` for `/post/<uuid>`.

- [ ] **Step 3: Add the branch**

In `parseShareTarget`, immediately before the `feed` branch:

```js
  if (segments[0] === 'post' && segments[1]) {
    return UUID.test(segments[1]) ? { kind: 'post', id: segments[1] } : null
  }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/openGraph.test.js`
Expected: PASS, all existing cases plus 3.

- [ ] **Step 5: Verify the canonical URL a preview advertises**

Find where the OG handler builds `canonicalUrl` for `kind: 'post'` (`api/_handlers/og.js`) and confirm it emits `/post/<id>`. If it hardcodes `/feed?post=`, change it — a preview of an old link should advertise the new canonical so link equity consolidates.

- [ ] **Step 6: Commit**

```bash
git add src/lib/openGraph.js src/lib/openGraph.test.js api/_handlers/og.js
git commit -m "feat(carefind): serve Open Graph tags for /post/:id

The legacy ?post= branch stays so links already in the wild keep
previewing; both now advertise /post/:id as canonical."
```

---

### Task 9: Update the docs

**Files:**
- Modify: `CAREFIND_ARCHITECTURE.md`
- Modify: `planning/CODE_AUDIT.md`

- [ ] **Step 1: Update the routing section**

In `CAREFIND_ARCHITECTURE.md` §1, add `/post/:id` to the route list and note that in-feed opens use a background location while cold loads render the standalone page.

- [ ] **Step 2: Correct the data-fetching section**

§10 currently reads: *"Dead/legacy layers: `PostCard.jsx`, `postRepository.js`, `useFeed.js`, `useComments.js` are not wired into the live app (Feed.jsx is authoritative)."*

This is now wrong on two counts and was already partly wrong before this work: `PostCard.jsx` is the live shared renderer, and `postRepository` has two real callers. Replace with an accurate description naming `usePostEngagement` as the seam and `Feed` / `PostPage` as its two consumers. Leave the `useFeed.js` note — verify whether it is still unwired and say so either way.

- [ ] **Step 3: Record the closure in the audit**

Add an entry to `planning/CODE_AUDIT.md` under UI recording: permalinks shipped, what was extracted, and explicitly what was **not** fixed (the 50-post ceiling, client-side-only ranking, the unbounded verified-ids fetch at `Feed.jsx:789-792`, the unfiltered realtime channel, and `Notifications.jsx:77` marking all unread rows read while showing only 100) so a later reader does not assume the permalink work swept them.

- [ ] **Step 4: Commit**

```bash
git add CAREFIND_ARCHITECTURE.md planning/CODE_AUDIT.md
git commit -m "docs(carefind): record permalinks and correct the data-access notes

§10 described PostCard and postRepository as dead; both are live. Names
the gaps this work deliberately did not close."
```

---

## Verification before calling this done

- [ ] `npm test` green, with the new suites: `postSelectors` (9), `usePostEngagement` (8), `PostPage` (6), plus the added `Feed` and `openGraph` cases
- [ ] `npm run build` clean
- [ ] `/post/<id>` verified at 375 / 768 / 1280
- [ ] Cold load of a permalink works logged-out, and a subscriber-only post shows its gate rather than its body
- [ ] A deleted post and a post you cannot see render the same message
- [ ] Back closes the modal; reload while open gives the full page
- [ ] An old `/feed?post=<id>` link still lands on the post
- [ ] A permalink pasted into WhatsApp renders a card with the right title and image
- [ ] The extraction (Tasks 1–4) and the behaviour changes (Tasks 5–9) are in separate commits
