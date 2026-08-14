import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { renderMarkdown } from './markdown.jsx'

// Renders markdown nodes to a DOM text/html snapshot for assertions.
function html(text) {
  const { container } = render(<div>{renderMarkdown(text)}</div>)
  return container.innerHTML
}

describe('renderMarkdown (Feature 7 — markdown in post + comment bodies)', () => {
  it('returns null for empty input', () => {
    expect(renderMarkdown(null)).toBeNull()
    expect(renderMarkdown(undefined)).toBeNull()
    expect(renderMarkdown('')).toBeNull()
  })

  it('renders bold and italic', () => {
    expect(html('**bold** and *italic*')).toContain('<strong>bold</strong>')
    expect(html('**bold** and *italic*')).toContain('<em>italic</em>')
  })

  it('renders inline code', () => {
    expect(html('run `npm test`')).toContain('<code')
    expect(html('run `npm test`')).toContain('npm test')
  })

  it('renders links with http hrefs and escapes the URL', () => {
    const out = html('see [docs](https://example.com/a?b=1)')
    expect(out).toContain('href="https://example.com/a?b=1"')
    expect(out).toContain('>docs</a>')
  })

  it('renders mailto and relative links', () => {
    expect(html('[mail](mailto:a@b.com)')).toContain('href="mailto:a@b.com"')
    expect(html('[me](/u/abc)')).toContain('href="/u/abc"')
  })

  it('never emits javascript: links', () => {
    const out = html('[bad](javascript:alert(1))')
    expect(out).not.toContain('href="javascript')
    expect(out).not.toContain('<a ')
  })

  it('escapes HTML instead of injecting it', () => {
    const out = html('<script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('renders headings', () => {
    expect(html('# Big')).toContain('Big')
    expect(html('## Sub')).toContain('Sub')
  })

  it('renders unordered lists', () => {
    const out = html('- one\n- two')
    expect(out).toContain('<ul')
    expect(out).toContain('<li')
    expect(out).toContain('>one</li>')
    expect(out).toContain('>two</li>')
  })

  it('renders ordered lists', () => {
    const out = html('1. first\n2. second')
    expect(out).toContain('<ol')
    expect(out).toContain('<li')
    expect(out).toContain('>first</li>')
    expect(out).toContain('>second</li>')
  })

  it('renders blockquotes', () => {
    expect(html('> quoted line')).toContain('quoted line')
    expect(html('> quoted')).toContain('<blockquote')
  })

  it('renders code fences', () => {
    const out = html('```\nconst x = 1\n```')
    expect(out).toContain('<code>const x = 1</code>')
  })

  it('keeps internal line breaks as <br/>', () => {
    expect(html('line one\nline two')).toContain('line one<br>')
  })

  it('renders the legacy bracket-marker syntax alongside markdown', () => {
    expect(html('{b}bold{/b}')).toContain('bold')
    expect(html('{h:yellow}hi{/h}')).toContain('hi')
    expect(html('{c:red}red{/c}')).toContain('red')
  })

  it('links @mentions to the profile when a mentions map is provided', () => {
    const out = renderMarkdown('hi @DrAda', { mentions: { drada: 'u9' } })
    const { container } = render(<MemoryRouter><div>{out}</div></MemoryRouter>)
    const link = container.querySelector('a')
    expect(link).not.toBeNull()
    expect(link.getAttribute('href')).toBe('/u/u9')
    expect(link.textContent).toBe('@DrAda')
  })

  it('leaves @mentions as plain text when the user is unknown', () => {
    const out = renderMarkdown('hi @ghost', { mentions: { drada: 'u9' } })
    const { container } = render(<MemoryRouter><div>{out}</div></MemoryRouter>)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('@ghost')
  })

  it('keeps @mention text plain when no mentions map is passed', () => {
    expect(html('hi @DrAda')).not.toContain('<a ')
  })
})