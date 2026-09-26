---
title: 'Preserve rich-text formatting from editor through publication'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_commit: 'c1f1140dc0fb9cffeb34d1b971dfe9092ed7682d'
review_loop_iteration: 0
context:
  - 'apps/carefind/src/modules/news-publishing/articleFormat.js'
  - 'apps/carefind/src/modules/news-publishing/articleContent.js'
  - 'apps/carefind/src/modules/news-publishing/ArticleEditor.jsx'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Editor shows coloured highlights (and bold/italic/headings) but published article loses much formatting — mismatch between designed and viewed content.

**Approach:** Make published renderer have parity with editor/preview: preserve text/background highlight colours, bold/italic, heading styles; store as structured markers (`==#hex|…==`/`**`/`*`/`#`), not plain text or screenshot; keep editable round-trip consistent.

## Boundaries & Constraints

**Always:** Store formatting as structured markers in `posts.content`/`news.body` JSON blocks (not plain text, not image screenshot); keep `articleContent.js:96` `stripMalformedHighlights` + `validateArticleForPublish` gate; keep `renderArticleHtml` as article renderer.

**Ask First:** Migrating article read path to `renderMarkdown`; adding new block types beyond heading.

**Never:** Convert post to plain text or rely on screenshot for formatting; strip `==#hex|` or `**`/`*` on publish; lose editable markers after publish.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Coloured highlight | `==#fde68a| hello ==` from toolbar | Published shows `<mark style="background:#fde68a">hello</mark>` | No strip |
| Text colour | `<span style="color:#dc2626">hello</span>` pasted | Preserved as `{c:red}hello{/c}` or `==#dc2626|hello==` equivalent | No flatten to plain `hello` |
| Bold/italic | `**bold**` / `*italic*` / toolbar B/I | Published retains bold/italic | No loss |
| Heading | `## Heading` typed | Published renders heading style via `renderArticleHtml` (or preserved) | Not rendered as literal `##` |
| Paste | Paste coloured HTML | Sanitized but preserves allowed tags (`b/i/mark` + highlight) | No plain-text strip |
| Edit after publish | Reopen article in editor | Markers intact, editable, re-publish same formatting | No corruption |

</frozen-after-approval>

## Code Map

- `apps/carefind/src/modules/news-publishing/articleFormat.js:26-113` -- `wrapHighlight` canonical `==#RRGGBB|…==`, `renderArticleHtml` handles `==#hex|…==` → `<mark>`, `==…==` → `<mark>`, plus `**`/`*`; `htmlToArticleMarkers:119-177` currently flattens `<span style="color">` and `<u>/<s>` to plain text and only inverts `p/br/strong/em/mark`; must add colour/decoration branches and heading.
- `apps/carefind/src/modules/news-publishing/ArticleEditor.jsx:387-471` -- `handlePaste` `preventDefault+insertText` strips all HTML; `TextBlock` `htmlToArticleMarkers` on blur/unmount; `HIGHLIGHT_COLORS` toolbar; `parseBlocks`/`normalizeBlock` strips malformed `==color|`; must allow sanitized HTML paste.
- `apps/carefind/src/modules/news-publishing/articleContent.js:25-103` -- `blocksOf`, `compareForLoss`, `LOSS_TOLERANCE_CHARS=40`; keep gate.
- `apps/carefind/src/modules/social-feed/richText.jsx:4-96` -- dialect `{h:}/{c:}/{b}` etc.; keep but ensure `articleFormat` covers colour.
- `apps/carefind/src/modules/social-feed/markdown.jsx:61-212` -- supports headings, bold/italic, `==#hex|`, `{h}/{c}` with block handling; reference for heading addition to `renderArticleHtml` if chosen.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/src/modules/news-publishing/articleFormat.js` -- add `htmlToArticleMarkers` branches for `<span style="color:#…">` → `{c:…}`/`==#…|`, `<u>`→`{u}…{/u}`, `<s>`→`{s}…{/s}` (currently flattened 145-146); add heading handling `^(#{1,6})\s+(.+)$` in `renderArticleHtml` (mirror `markdown.jsx:202`) and inverse in `htmlToArticleMarkers` so `# Heading` round-trips; keep `==#hex|…==` order before `==…==`.
- [x] `apps/carefind/src/modules/news-publishing/ArticleEditor.jsx` -- fix `handlePaste:387` to allow sanitized HTML (b/i/mark + highlight `style="background:#…"`) through `htmlToArticleMarkers` sanitizer instead of plain `insertText`; keep `normalizeBlock` repair; ensure `TextBlock` blur sync preserves colour/decoration.
- [x] `apps/carefind/src/modules/news-publishing/articleFormat.test.js` + `articleContent.test.js` -- add round-trip tests: `==#fde68a|hello==` → `<mark>` → `==#fde68a|hello==`; `**bold**`/`*italic*`/`# Heading`/`{c:red}`/`{h:yellow}`/`==plain==`/`**==#hex|*italic*==**` nested; verify `htmlToArticleMarkers(renderArticleHtml(x))===x`.

**Acceptance Criteria:**
- Given article created with multiple highlight colours and bold/italic/headings, when published and opened from feed, then selected formatting is preserved in rendered view
- Given coloured text pasted, when saved, then text colour/highlight remains intact (not stripped to plain)
- Given article edited after publish, when reopened in editor, then formatting remains editable and re-publish preserves it
- Given `renderArticleHtml` → `htmlToArticleMarkers` round-trip, when checking markers, then `==#hex|`, `**`, `*`, `# Heading` all survive

## Spec Change Log

## Design Notes

Canonical marker is `==#RRGGBB|text==` (`articleFormat.js:38`) plus legacy `{h:}/{c:}/{b}/{i}` parity; keep both dialects documented. `Feed.jsx:144 articleTextareaRef` dead for article path (now `ArticleEditor`) — leave for now per `Ask First`.

## Verification

**Commands:**
- `npm test -- src/modules/news-publishing/articleFormat.test.js src/modules/news-publishing/articleContent.test.js` -- expected: highlight/bold/italic/heading round-trip pass, malformed strip still works
- `npm run build` (apps/carefind) -- expected: vite build clean

## Suggested Review Order

**Renderer — headings and inline formatting**

- `renderArticleHtml` line-based heading + `applyInlineFormatting` keeps `==#hex|` before `==`
  [`articleFormat.js:114`](../../apps/carefind/src/modules/news-publishing/articleFormat.js#L114)

- `HEADING_SIZES` hard-coded but matches `markdown.jsx`
  [`articleFormat.js:135`](../../apps/carefind/src/modules/news-publishing/articleFormat.js#L135)

**Inverse — paste sanitization preserves colour/decoration**

- `<span style="color">` → `{c:}`/`==#|`, `<u>`/`{s}`, `<mark>` background → `==#|`
  [`articleFormat.js:198`](../../apps/carefind/src/modules/news-publishing/articleFormat.js#L198)

- `handlePaste` sanitized HTML via `htmlToArticleMarkers` + `renderArticleHtml`
  [`ArticleEditor.jsx:387`](../../apps/carefind/src/modules/news-publishing/ArticleEditor.jsx#L387)

**Top-level block coalescing**

- `inlineBuffer` + `flushInline` preserves inline `mark/span` at root
  [`articleFormat.js:251`](../../apps/carefind/src/modules/news-publishing/articleFormat.js#L251)

**Tests**

- Round-trip `==#fde68a|hello==`, `**bold**`, `*italic*`, `# Heading`, nested
  [`articleFormat.test.js:202`](../../apps/carefind/src/modules/news-publishing/articleFormat.test.js#L202)
