// Safe, dependency-free Markdown renderer for post + comment bodies.
//
// Feed posts and comments are stored as plain text; authors write standard
// Markdown (bold, italic, inline code, links, headings, lists, blockquotes,
// code fences) and this renders it as formatted content instead of raw
// asterisks/hashes. It deliberately supports the app's legacy bracket-marker
// syntax too ({b}..{/b}, {h:yellow}..{/h}, {c:red}..{/c}) so content written
// with the composer toolbar keeps its styling.
//
// Security: input is NEVER injected as HTML. Every string becomes a React text
// node (auto-escaped) and link hrefs are sanitised to http(s)/mailto/tel or
// relative paths — javascript: and friends never reach an anchor.

import { theme } from '../../styles/theme'
import { Link } from 'react-router-dom'

const HIGHLIGHTS = { yellow: '#fef08a', green: '#bbf7d0', pink: '#fbcfe8', blue: '#bfdbfe' }
const TEXTCOLORS = { red: '#dc2626', blue: '#2563eb', green: '#16a34a' }

const HEADING_SIZES = [22, 19, 17, 15.5, 14.5, 13.5]

// Username chars for @mention linking (mirrors mentions.js).
const MENTION_AT = /^@([A-Za-z0-9_.-]+)/

function sanitizeHref(raw) {
  const href = String(raw || '').trim()
  if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(href)) return href
  return null
}

// Parse a run of inline text (a single line / list item / quote line) into
// React nodes. Plain characters are accumulated and flushed as one string so
// React never warns about missing keys on bare text. `mentions` is an optional
// map of lower-cased @username -> user id; matched tokens render as profile
// links (used by comments, which store resolved mentions at insert time).
function renderInline(text, keyPrefix = '', mentions = null) {
  if (!text) return []
  const out = []
  let rest = text
  let plain = ''
  let guard = 0
  const flush = () => {
    if (plain) {
      out.push(plain)
      plain = ''
    }
  }

  while (rest && guard++ < 200) {
    let m
    if ((m = rest.match(/^`([^`\n]+)`/))) {
      flush()
      out.push(
        <code key={keyPrefix + out.length} style={{ background: theme.bg, padding: '1px 5px', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.92em' }}>
          {m[1]}
        </code>,
      )
      rest = rest.slice(m[0].length)
      continue
    }
    if (mentions && (m = rest.match(MENTION_AT))) {
      const userId = mentions[m[1].toLowerCase()]
      if (userId) {
        flush()
        out.push(
          <Link key={keyPrefix + out.length} to={`/u/${userId}`} style={{ color: theme.tealDeep, fontWeight: 700, textDecoration: 'none' }}>
            {m[0]}
          </Link>,
        )
        rest = rest.slice(m[0].length)
        continue
      }
    }
    if ((m = rest.match(/^\*\*([^*\n]+)\*\*/))) {
      flush()
      out.push(<strong key={keyPrefix + out.length}>{renderInline(m[1], `${keyPrefix}${out.length}_`, mentions)}</strong>)
      rest = rest.slice(m[0].length)
      continue
    }
    if ((m = rest.match(/^\*([^*\n]+)\*/))) {
      flush()
      out.push(<em key={keyPrefix + out.length}>{renderInline(m[1], `${keyPrefix}${out.length}_`, mentions)}</em>)
      rest = rest.slice(m[0].length)
      continue
    }
    if ((m = rest.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)/))) {
      flush()
      const href = sanitizeHref(m[2])
      out.push(
        href
          ? <a key={keyPrefix + out.length} href={href} target="_blank" rel="noopener noreferrer" style={{ color: theme.tealDeep, fontWeight: 700, textDecoration: 'none', wordBreak: 'break-word' }}>{renderInline(m[1], `${keyPrefix}${out.length}_`, mentions)}</a>
          : <span key={keyPrefix + out.length}>{m[0]}</span>,
      )
      rest = rest.slice(m[0].length)
      continue
    }
    if ((m = rest.match(/^\{(h|c):(\w+)\}([\s\S]*?)\{\/\1\}/))) {
      flush()
      const type = m[1]
      const colorName = m[2]
      const inner = m[3]
      if (type === 'h') {
        out.push(
          <mark key={keyPrefix + out.length} style={{ background: HIGHLIGHTS[colorName] || '#fef08a', color: '#1a1a1a', padding: '0 2px', borderRadius: 3 }}>
            {renderInline(inner, `${keyPrefix}${out.length}_`, mentions)}
          </mark>,
        )
      } else {
        out.push(
          <span key={keyPrefix + out.length} style={{ color: TEXTCOLORS[colorName] || '#dc2626', fontWeight: 600 }}>
            {renderInline(inner, `${keyPrefix}${out.length}_`, mentions)}
          </span>,
        )
      }
      rest = rest.slice(m[0].length)
      continue
    }
    if ((m = rest.match(/^\{(b|i|s|u)\}([\s\S]*?)\{\/\1\}/))) {
      flush()
      const tag = m[1]
      const inner = m[2]
      const style = {
        b: { fontWeight: 800 },
        i: { fontStyle: 'italic' },
        s: { textDecoration: 'line-through' },
        u: { textDecoration: 'underline' },
      }[tag]
      out.push(
        <span key={keyPrefix + out.length} style={style}>
          {renderInline(inner, `${keyPrefix}${out.length}_`, mentions)}
        </span>,
      )
      rest = rest.slice(m[0].length)
      continue
    }
    plain += rest[0]
    rest = rest.slice(1)
  }
  flush()
  return out
}

// Render Markdown text into a list of block-level React nodes.
// Returns null for empty/blank input so callers can render nothing.
// `options.mentions` maps lower-cased @username -> user id for linking.
export function renderMarkdown(text, options = {}) {
  if (text == null) return null
  // Stored content can carry literal "\n" escape sequences (e.g. pasted or
  // imported bodies). Normalise them to real line breaks so the parser below
  // — which splits on real newlines — renders them as paragraphs/breaks
  // instead of printing the raw characters.
  const source = String(text).replace(/\\n/g, '\n')
  if (!source.trim()) return null
  const lines = source.split(/\r?\n/)
  const blocks = []
  let i = 0
  let key = 0
  const mentions = options.mentions || null

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Code fence: consume until the closing ``` (or end of input).
    if (/^```/.test(trimmed)) {
      const code = []
      i++
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i])
        i++
      }
      i++ // skip the closing fence
      blocks.push(
        <pre key={key++} style={{ background: theme.bg, padding: 10, borderRadius: 8, overflowX: 'auto', fontFamily: 'monospace', fontSize: 13, lineHeight: 1.5, margin: '6px 0' }}>
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }

    // Heading # .. ######
    const h = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (h) {
      const level = h[1].length
      blocks.push(
        <div key={key++} style={{ fontSize: HEADING_SIZES[level - 1], fontWeight: 800, color: theme.navy, margin: '6px 0 4px' }}>
          {renderInline(h[2], `${key}_`, mentions)}
        </div>,
      )
      i++
      continue
    }

    // Blockquote: consecutive > lines.
    if (/^>/.test(trimmed)) {
      const quote = []
      while (i < lines.length && /^>/.test(lines[i].trim())) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''))
        i++
      }
      blocks.push(
        <blockquote key={key++} style={{ borderLeft: `3px solid ${theme.tealDeep}44`, margin: '6px 0', paddingLeft: 10, color: theme.textLight }}>
          {quote.map((q, qi) => (
            <div key={qi}>{renderInline(q, `${key}_${qi}_`, mentions)}</div>
          ))}
        </blockquote>,
      )
      continue
    }

    // Unordered list: consecutive - / * / + items.
    if (/^[-*+]\s+/.test(trimmed)) {
      const items = []
      while (i < lines.length) {
        const m = lines[i].trim().match(/^[-*+]\s+(.+)$/)
        if (!m) break
        items.push(m[1])
        i++
      }
      blocks.push(
        <ul key={key++} style={{ margin: '4px 0', paddingLeft: 22 }}>
          {items.map((it, ii) => (
            <li key={ii} style={{ margin: '2px 0' }}>{renderInline(it, `${key}_${ii}_`, mentions)}</li>
          ))}
        </ul>,
      )
      continue
    }

    // Ordered list: consecutive "1." / "1)" items.
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items = []
      while (i < lines.length) {
        const m = lines[i].trim().match(/^\d+[.)]\s+(.+)$/)
        if (!m) break
        items.push(m[1])
        i++
      }
      blocks.push(
        <ol key={key++} style={{ margin: '4px 0', paddingLeft: 22 }}>
          {items.map((it, ii) => (
            <li key={ii} style={{ margin: '2px 0' }}>{renderInline(it, `${key}_${ii}_`, mentions)}</li>
          ))}
        </ol>,
      )
      continue
    }

    // Blank line: skip.
    if (trimmed === '') {
      i++
      continue
    }

    // Paragraph: consecutive non-blank, non-block lines. Internal newlines
    // become <br/> so authors keep their line breaks (pre-wrap behaviour).
    const para = []
    while (i < lines.length) {
      const t = lines[i].trim()
      if (t === '') break
      if (/^(#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s|```)/.test(t)) break
      para.push(lines[i])
      i++
    }
    blocks.push(
      <p key={key++} style={{ margin: 0 }}>
        {para.flatMap((pl, pi) => {
          const nodes = renderInline(pl, `${key}_${pi}_`, mentions)
          return pi === 0 ? nodes : [<br key={`${key}_br${pi}`} />, ...nodes]
        })}
      </p>,
    )
  }

  return blocks
}
