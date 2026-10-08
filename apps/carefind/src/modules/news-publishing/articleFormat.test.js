import { describe, it, expect, vi } from 'vitest'
import {
  wrapSelection, wrapBold, wrapItalic, wrapHighlight, renderArticleHtml,
  findMalformedHighlights, stripMalformedHighlights, htmlToArticleMarkers,
} from './articleFormat.js'

describe('wrapSelection', () => {
  function makeEditor(text) {
    const setText = vi.fn()
    const textareaRef = {
      current: { selectionStart: 0, selectionEnd: 0 },
    }
    return { setText, textareaRef }
  }

  it('wraps the selected text with the given markers', () => {
    const { setText, textareaRef } = makeEditor('')
    textareaRef.current.selectionStart = 0
    textareaRef.current.selectionEnd = 5
    wrapSelection(textareaRef, 'hello world', setText, '**', '**')
    expect(setText).toHaveBeenCalledWith('**hello** world')
  })

  it('inserts the placeholder "text" when nothing is selected', () => {
    const { setText, textareaRef } = makeEditor('')
    wrapSelection(textareaRef, 'abc', setText, '*', '*')
    expect(setText).toHaveBeenCalledWith('*text*abc')
  })

  it('does nothing when the textarea is missing', () => {
    const setText = vi.fn()
    wrapSelection({ current: null }, 'abc', setText, '**', '**')
    expect(setText).not.toHaveBeenCalled()
  })

  it('wrapBold, wrapItalic and wrapHighlight use the right markers', () => {
    const { setText, textareaRef } = makeEditor('')
    textareaRef.current.selectionStart = 0
    textareaRef.current.selectionEnd = 5
    wrapBold(textareaRef, 'hello world', setText)
    expect(setText).toHaveBeenCalledWith('**hello** world')
    wrapItalic(textareaRef, 'hello world', setText)
    expect(setText).toHaveBeenCalledWith('*hello* world')
    wrapHighlight(textareaRef, 'hello world', setText, '#FFD54F')
    expect(setText).toHaveBeenCalledWith('==#FFD54F|hello== world')
  })
})

describe('renderArticleHtml', () => {
  it('converts bold, italic and highlight markup to html', () => {
    const html = renderArticleHtml('**strong** and *em* and ==#FFFF00|mark==')
    expect(html).toContain('<strong>strong</strong>')
    expect(html).toContain('<em>em</em>')
    expect(html).toContain('<mark style="background:#FFFF00;color:#1f2937;padding:1px 4px;border-radius:4px;">mark</mark>')
  })

  it('wraps paragraphs in <p> tags', () => {
    expect(renderArticleHtml('one\n\ntwo')).toBe('<p>one</p><p>two</p>')
  })

  it('never lets raw user html through — escaping runs first', () => {
    const html = renderArticleHtml('<script>alert("x")</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes markup inside highlighted segments', () => {
    const html = renderArticleHtml('==#00FF00|<b>hi</b>==')
    expect(html).not.toContain('<b>hi</b>')
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;')
  })

  it('supports highlight without a color', () => {
    expect(renderArticleHtml('==plain==')).toContain('<mark>plain</mark>')
  })

  it('renders the legacy bracket-marker vocabulary so articles and text posts share one dialect', () => {
    const html = renderArticleHtml('{h:yellow}glow{/h} and {c:red}red{/c} and {b}bold{/b} and {i}it{/i} and {s}strike{/s} and {u}under{/u}')
    expect(html).toContain('<mark')
    expect(html).toContain('glow')
    expect(html).toContain('color:#dc2626')
    expect(html).toContain('red')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>it</em>')
    expect(html).toContain('text-decoration:line-through')
    expect(html).toContain('text-decoration:underline')
  })

  it('still escapes html inside bracket markers', () => {
    const html = renderArticleHtml('{h:yellow}<b>bad</b>{/h}')
    expect(html).not.toContain('<b>bad</b>')
    expect(html).toContain('&lt;b&gt;bad&lt;/b&gt;')
  })

  it('never throws on null, undefined or non-string content', () => {
    expect(renderArticleHtml(null)).toBe('<p></p>')
    expect(renderArticleHtml(undefined)).toBe('<p></p>')
    expect(renderArticleHtml('')).toBe('<p></p>')
    expect(() => renderArticleHtml({ id: 'x', type: 'text' })).not.toThrow()
    expect(() => renderArticleHtml(['a', 'b'])).not.toThrow()
  })

  it('coerces non-string content to a safe rendered paragraph', () => {
    expect(() => renderArticleHtml({ id: 'x', content: '**hi**' })).not.toThrow()
    expect(renderArticleHtml(42)).toBe('<p>42</p>')
  })
})
describe('malformed highlight markers (issue #3)', () => {
  // The exact content the broken colour button wrote into production, taken
  // from posts.content of the 2026-08-21 "wound" article.
  const CORRUPTED = '**==color|Why does a wound sometimes itch when it starts healing ?\n**==color|\nHave you ever had a small cut'

  it('finds every literal ==color| marker', () => {
    const found = findMalformedHighlights(CORRUPTED)
    expect(found).toHaveLength(2)
    expect(found[0].token).toBe('==color|')
  })

  it('also catches the ==undefined| marker an unset theme token produced', () => {
    expect(findMalformedHighlights('a ==undefined|b==undefined| c')).toHaveLength(2)
  })

  it('reports nothing for well-formed markup', () => {
    expect(findMalformedHighlights('==#fde68a|highlighted== and ==plain== and **bold**')).toEqual([])
    expect(findMalformedHighlights('')).toEqual([])
    expect(findMalformedHighlights(null)).toEqual([])
  })

  it('strips the markers but keeps every word they wrapped', () => {
    const cleaned = stripMalformedHighlights(CORRUPTED)
    expect(cleaned).not.toContain('==color|')
    expect(cleaned).toContain('Why does a wound sometimes itch when it starts healing ?')
    expect(cleaned).toContain('Have you ever had a small cut')
    expect(cleaned.startsWith('**')).toBe(true)
  })

  it('leaves valid colour and plain highlights untouched', () => {
    const valid = 'x ==#fde68a|kept== y ==plain== z'
    expect(stripMalformedHighlights(valid)).toBe(valid)
  })

  it('a stripped article renders with no marker characters visible', () => {
    const html = renderArticleHtml(stripMalformedHighlights(CORRUPTED))
    expect(html).not.toContain('color|')
    expect(html).not.toContain('==')
  })

  it('a correctly applied colour round-trips markup -> html', () => {
    const setText = vi.fn()
    const textareaRef = { current: { selectionStart: 0, selectionEnd: 5 } }
    wrapHighlight(textareaRef, 'hello world', setText, '#fde68a')
    const markup = setText.mock.calls[0][0]
    expect(markup).toBe('==#fde68a|hello== world')
    expect(findMalformedHighlights(markup)).toEqual([])
    expect(renderArticleHtml(markup)).toContain('<mark style="background:#fde68a;color:#1f2937;padding:1px 4px;border-radius:4px;">hello</mark>')
  })
})

describe('htmlToArticleMarkers', () => {
  it('converts bold markup', () => {
    expect(htmlToArticleMarkers('<p><strong>hello</strong> world</p>')).toBe('**hello** world')
  })

  it('converts italic markup', () => {
    expect(htmlToArticleMarkers('<p><em>hello</em> world</p>')).toBe('*hello* world')
  })

  it('converts highlight with colour', () => {
    expect(htmlToArticleMarkers('<p><mark style="background:#fde68a">hello</mark> world</p>')).toBe('==#fde68a|hello== world')
  })

  it('converts highlight without colour', () => {
    expect(htmlToArticleMarkers('<p><mark>hello</mark> world</p>')).toBe('==hello== world')
  })

  it('converts multiple paragraphs', () => {
    expect(htmlToArticleMarkers('<p>one</p><p>two</p>')).toBe('one\n\ntwo')
  })

  it('converts <br> to newline', () => {
    expect(htmlToArticleMarkers('<p>line1<br>line2</p>')).toBe('line1\nline2')
  })

  it('handles <b> and <i> tags', () => {
    expect(htmlToArticleMarkers('<p><b>bold</b> and <i>italic</i></p>')).toBe('**bold** and *italic*')
  })

  it('handles nested formatting', () => {
    expect(htmlToArticleMarkers('<p><strong><em>nested</em></strong></p>')).toBe('**nested**')
  })

  it('strips unknown tags', () => {
    expect(htmlToArticleMarkers('<p><span style="color:red">hello</span></p>')).toBe('hello')
  })

  it('returns empty string for empty/null input', () => {
    expect(htmlToArticleMarkers('')).toBe('')
    expect(htmlToArticleMarkers(null)).toBe('')
    expect(htmlToArticleMarkers(undefined)).toBe('')
  })

  it('round-trips through renderArticleHtml for bold', () => {
    const original = '**hello** world'
    const html = renderArticleHtml(original)
    const markers = htmlToArticleMarkers(html)
    expect(markers).toBe(original)
  })

  it('round-trips through renderArticleHtml for italic', () => {
    const original = '*hello* world'
    const html = renderArticleHtml(original)
    const markers = htmlToArticleMarkers(html)
    expect(markers).toBe(original)
  })

  it('round-trips through renderArticleHtml for colour highlight', () => {
    const original = '==#fde68a|hello== world'
    const html = renderArticleHtml(original)
    const markers = htmlToArticleMarkers(html)
    expect(markers).toBe(original)
  })

  it('round-trips through renderArticleHtml for multi-paragraph', () => {
    const original = 'one\n\ntwo'
    const html = renderArticleHtml(original)
    const markers = htmlToArticleMarkers(html)
    expect(markers).toBe(original)
  })

  it('round-trips through renderArticleHtml for combined formatting', () => {
    const original = '**bold** and *italic* and ==#a7f3d0|highlighted=='
    const html = renderArticleHtml(original)
    const markers = htmlToArticleMarkers(html)
    expect(markers).toBe(original)
  })
})
