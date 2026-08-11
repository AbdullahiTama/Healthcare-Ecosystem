# News & Publishing — Business Domain

## Purpose
Article/news content publishing and consumption on CareFind — an editorial feature distinct from the user-generated Social Feed domain.

## Files
`apps/carefind/carefind-main/src/News.jsx` (314 lines), `NewsArticle.jsx` (309 lines), `ArticleEditor.jsx` (487 lines — the largest file in this domain, implying a substantial rich-text authoring experience), `lib/articleFormat.js` (50 lines).

## Components
`News.jsx` (listing), `NewsArticle.jsx` (single-article view with comments/reactions, per the table list), `ArticleEditor.jsx` (authoring). `lib/articleFormat.js` presumably supplies shared formatting/parsing logic between the editor and the reader view, consistent with `richText.jsx`'s role in the Social Feed domain.

## Services
Direct `supabase-js` calls against `news`, `news_comments`, `news_reactions`, `saved_news` — specific query shapes were not individually enumerated during this review.

## Dependencies
Likely `richText.jsx` (Social Feed domain) for rendering, given both domains handle rich text content; not individually confirmed.

## Database Tables
`news`, `news_comments`, `news_reactions`, `saved_news`.

## Current State
Present and substantial (four files, ~1,160 lines including the formatting library) but not individually deep-reviewed in this pass — listing, reading, commenting, reacting, saving, and authoring all appear implemented based on file presence and table references, but this has not been confirmed by reading the components' internals.

## Missing Documentation
No document explains who is authorized to author news articles (whether this is an admin-only capability, a verified-professional capability, or open to all users) — `ArticleEditor.jsx`'s access control was not confirmed during this review and is a meaningful open question given the domain's editorial nature.
