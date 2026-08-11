# Playlists — Business Domain

## Purpose
Curated collections of content on CareFind (likely video/live-session clips or articles, given adjacency to the Live Streaming and Social Feed domains) — creation, editing, and viewing.

## Files
`apps/carefind/carefind-main/src/PlaylistCreate.jsx` (259 lines, reused across three routes: create, add-to-existing, edit-part), `PlaylistView.jsx` (129 lines).

## Components
`PlaylistCreate.jsx` and `PlaylistView.jsx` — two components covering the full domain. `main.jsx`'s route table reuses `PlaylistCreate` for three distinct paths (`/playlist/create`, `/playlist/:id/add`, `/playlist/:id/edit/:partId`), suggesting one form component handles create/add/edit via route params rather than three separate implementations.

## Services
Direct `supabase-js` calls against `playlists` and `playlist_parts` — specific query shapes not individually confirmed during this review.

## Dependencies
Not individually confirmed; likely shares media-handling with Live Streaming/Social Feed given the "parts" concept implies ordered media clips.

## Database Tables
`playlists`, `playlist_parts`.

## Current State
Present and routed with a create/add/edit/view flow. Not individually deep-reviewed in this pass — this entry is based on file presence, route table structure, and table references rather than reading the components' internals.

## Missing Documentation
No document defines what a "part" of a playlist actually contains (a video clip, a live-session recording, an article reference) — this was not resolved during this review and would require reading `PlaylistCreate.jsx`/`PlaylistView.jsx` directly.
