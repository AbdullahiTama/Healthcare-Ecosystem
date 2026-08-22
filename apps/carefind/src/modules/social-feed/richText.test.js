import { describe, it, expect } from 'vitest'
import { stripMarkdown, stripMarkers, previewText } from './richText.jsx'

describe('stripMarkdown (Feature 7 — markdown out of plain-text previews)', () => {
  it('turns **bold** into bold', () => {
    expect(stripMarkdown('**bold**')).toBe('bold')
    expect(stripMarkdown('a **b** c')).toBe('a b c')
  })

  it('turns *italic* into italic', () => {
    expect(stripMarkdown('*it*')).toBe('it')
    expect(stripMarkdown('*a* and *b*')).toBe('a and b')
  })

  it('turns `code` into code', () => {
    expect(stripMarkdown('`code`')).toBe('code')
    expect(stripMarkdown('run `npm test`')).toBe('run npm test')
  })

  it('strips leading ATX heading marks', () => {
    expect(stripMarkdown('# Heading')).toBe('Heading')
    expect(stripMarkdown('## Sub')).toBe('Sub')
    expect(stripMarkdown('line one\n# Second line')).toBe('line one\nSecond line')
  })

  it('keeps plain text unchanged', () => {
    expect(stripMarkdown('plain text')).toBe('plain text')
    expect(stripMarkdown('')).toBe('')
    expect(stripMarkdown(null)).toBe('')
  })

  it('handles bold nested inside italic', () => {
    expect(stripMarkdown('*a **b** c*')).toBe('a b c')
  })

  it('still strips the legacy bracket markers', () => {
    expect(stripMarkdown('{b}bold{/b}')).toBe('bold')
    expect(stripMarkdown('{h:yellow}hi{/h}')).toBe('hi')
  })
})

describe('previewText', () => {
  it('strips bracket markers from plain text', () => {
    expect(previewText('{b}Hello{/b} world')).toBe('Hello world')
  })

  it('reads text out of a JSON block array without dumping raw JSON', () => {
    const body = JSON.stringify([{ id: 'a', type: 'text', content: 'Never drink water during these situations.' }])
    expect(previewText(body)).toBe('Never drink water during these situations.')
  })

  it('keeps valid \\n escapes inside a JSON block as line breaks, not raw text', () => {
    const body = JSON.stringify([{ id: 'a', type: 'text', content: 'Line one.\\nLine two.' }])
    const out = previewText(body)
    expect(out).not.toContain('\\n')
    expect(out).toContain('Line one.')
    expect(out).toContain('Line two.')
  })

  it('recovers block text from malformed JSON instead of printing the array', () => {
    const broken = '[{"id":"a","type":"text","content":"First point.\nSecond point."}]'
    const out = previewText(broken)
    expect(out).not.toContain('"id"')
    expect(out).toContain('First point.')
    expect(out).toContain('Second point.')
  })
})