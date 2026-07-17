# Social Feed — Business Domain

## Purpose
CareFind's home screen and primary content surface — a scrollable feed of posts, comments, and reactions, styled and behaving like a general-purpose social network rather than a healthcare-specific feature. The single largest domain in either codebase by file size.

## Files
`apps/carefind/carefind-main/src/Feed.jsx` (1,823 lines — the largest page file in either product), `SavedPosts.jsx`, `PublicProfile.jsx` (578 lines, profile-as-feed-context), `VisualCard.jsx` (177 lines, rich media card), `richText.jsx` (138 lines).

## Components
`Feed.jsx` is a single, very large component; no sub-component extraction was confirmed for its internal post/comment/reaction rendering during this review. `VisualCard.jsx` and `richText.jsx` are the closest things to genuinely reusable pieces this domain contributes to the wider codebase.

## Services
Direct `supabase-js` calls scattered through `Feed.jsx` — `posts`, `post_comments`, `post_reactions` tables. Also writes to `unclaimed_entities` (`name, entity_type, submitted_by`) when a user reviews something not yet present as a claimed `businesses` row — a user-generated-content path for extending the business directory.

## Dependencies
`lib/activeIdentity.js` (lets a user post as themselves, a claimed business, or a claimed staff position — see `claims.md`), `notify.js` (like/comment/reply/mention notifications), `lib/AuthContext.jsx`.

## Database Tables
`posts`, `post_comments`, `post_reactions`, `saved_posts`, `unclaimed_entities`.

## Current State
A fully-featured social feed is implemented: posting, commenting, reacting, saving, and reviewing unclaimed entities. This domain, more than any other in CareFind, is responsible for the finding that CareFind's actual implementation is substantially a general social platform rather than the healthcare-discovery product its documentation describes.

## Missing Documentation
No document explains the product decision behind building a general social feed as CareFind's primary surface, how it relates to the platform's stated healthcare-discovery purpose, or whether `unclaimed_entities` (crowdsourced directory expansion via reviews) was a deliberate strategy for growing the `businesses` table beyond CareHub-originated data.
