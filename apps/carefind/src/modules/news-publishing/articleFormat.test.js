import { describe, it, expect, vi } from 'vitest'
import { wrapSelection, wrapBold, wrapItalic, wrapHighlight, renderArticleHtml } from './articleFormat.js'

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
})