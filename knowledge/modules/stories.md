# Stories — Business Domain

## Purpose
Ephemeral, Instagram/Snapchat-style "stories" content on CareFind — short-lived visual posts distinct from the permanent Social Feed domain.

## Files
`apps/carefind/carefind-main/src/Stories.jsx` (321 lines).

## Components
Single component covering story creation and viewing; not decomposed into separate creation/viewer files during this review.

## Services
Direct `supabase-js` calls against the `stories` table; specific query shapes were not enumerated in detail during this review pass.

## Dependencies
Likely shares media-handling utilities with the Social Feed and Live Streaming domains (`VideoRecorder.jsx`, `VideoUploader.jsx`, `imageResize.js`) based on file adjacency, though this was not individually confirmed.

## Database Tables
`stories`.

## Current State
Present and routed (no dedicated top-level route was found for it in `main.jsx`'s route table, suggesting Stories is embedded within `Feed.jsx` or another screen rather than being its own page) — this domain's exact entry point was not fully resolved during this review and would benefit from direct verification.

## Missing Documentation
This domain received the least direct file-reading of any in this set — its component structure, exact table schema, and relationship to the Social Feed domain are inferred from the file's existence and name only, not from reading its contents. A dedicated review pass is needed before this entry can be considered reliable.
