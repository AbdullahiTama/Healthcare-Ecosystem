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
})