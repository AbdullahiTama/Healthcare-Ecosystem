import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ArticleEditor from './ArticleEditor.jsx'

// Feature 3 regression suite. newsArticle.test.jsx mocks ArticleEditor, so it
// can never catch the blank-page crash that shipped here: renderArticleHtml
// used to call .split() on whatever b.content held, which threw a TypeError
// on non-string content and (with no ErrorBoundary) unmounted the whole app.
// These tests render the REAL editor in read-only mode against the malformed
// shapes that historically reached it.

describe('ArticleEditor read-only rendering (Feature 3 regression)', () => {
  it('renders a valid JSON block string', () => {
    render(<ArticleEditor value='[{"id":"a","type":"text","content":"**Hello** world"}]' readOnly />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText('Hello').tagName).toBe('STRONG')
  })

  it('renders legacy plain text', () => {
    render(<ArticleEditor value="just plain text" readOnly />)
    expect(screen.getByText(/just plain text/)).toBeInTheDocument()
  })

  it('renders a drawing block without crashing', () => {
    expect(() => render(<ArticleEditor value='[{"id":"a","type":"drawing","strokes":[]}]' readOnly />)).not.toThrow()
  })

  it('does not crash when a text block has object content (the historic crash)', () => {
    const body = JSON.stringify([{ id: 'a', type: 'text', content: { text: 'leaky object' } }])
    expect(() => render(<ArticleEditor value={body} readOnly />)).not.toThrow()
  })

  it('does not crash when a text block content is null or missing', () => {
    expect(() => render(<ArticleEditor value='[{"id":"a","type":"text"}]' readOnly />)).not.toThrow()
    expect(() => render(<ArticleEditor value='[{"id":"a","type":"text","content":null}]' readOnly />)).not.toThrow()
    expect(() => render(<ArticleEditor value={null} readOnly />)).not.toThrow()
  })

  it('renders a JSON array value (already-parsed object) without crashing', () => {
    const arr = [{ id: 'a', type: 'text', content: 'from array' }]
    expect(() => render(<ArticleEditor value={arr} readOnly />)).not.toThrow()
  })
})

describe('colour formatting (issue #3)', () => {
  const CORRUPTED = JSON.stringify([{
    id: 'a', type: 'text',
    content: '**==color|Why does a wound itch?\n**==color|\nBecause new skin forms.',
  }])

  it('renders an already-corrupted article with no marker characters visible', () => {
    const { container } = render(<ArticleEditor value={CORRUPTED} readOnly />)
    expect(container.textContent).not.toContain('==color|')
    expect(container.textContent).not.toContain('color|')
    expect(container.textContent).toContain('Why does a wound itch?')
    expect(container.textContent).toContain('Because new skin forms.')
  })

  it('repairs a corrupted article on load so it can be edited and reposted', () => {
    let emitted = null
    render(<ArticleEditor value={CORRUPTED} onChange={(v) => { emitted = v }} />)
    // The initial onChange fires with the repaired content
    expect(emitted).not.toBeNull()
    expect(emitted).not.toContain('==color|')
    const blocks = JSON.parse(emitted)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].content).toContain('Why does a wound itch?')
    expect(blocks[0].content).toContain('Because new skin forms.')
  })

  it('offers six real colour swatches, none of them undefined', () => {
    render(<ArticleEditor value='[{"id":"a","type":"text","content":"x"}]' onChange={() => {}} />)
    const swatches = screen.getAllByRole('button', { name: /^Highlight in / })
    expect(swatches).toHaveLength(6)
    swatches.forEach((s) => {
      expect(s.style.background).not.toBe('')
      expect(s.getAttribute('aria-label')).not.toContain('undefined')
    })
  })
})

// WYSIWYG: the editing surface now renders formatted text directly — there is
// no separate preview pane. contentEditable is seeded from stored markers via
// renderArticleHtml, and the toolbar applies formatting via execCommand.
describe('ArticleEditor WYSIWYG contentEditable', () => {
  beforeEach(() => {
    // Mock execCommand for JSDOM (not natively supported)
    document.execCommand = vi.fn()
  })

  it('renders a contentEditable div with article content', () => {
    render(<ArticleEditor value='[{"id":"a","type":"text","content":"**Hello** world"}]' onChange={() => {}} />)
    const editor = screen.getByTestId('article-editor')
    expect(editor).toBeInTheDocument()
    expect(editor.getAttribute('contenteditable')).toBe('true')
    expect(editor.innerHTML).toContain('<strong>')
    expect(editor.textContent).toContain('Hello')
  })

  it('does not show a separate preview pane', () => {
    render(<ArticleEditor value='[{"id":"a","type":"text","content":"**Bold** text"}]' onChange={() => {}} />)
    expect(screen.queryByTestId('article-preview')).not.toBeInTheDocument()
  })

  it('bold button calls execCommand', () => {
    render(<ArticleEditor value='[{"id":"a","type":"text","content":"hello"}]' onChange={() => {}} />)
    const boldBtn = screen.getByRole('button', { name: 'B' })
    fireEvent.click(boldBtn)
    expect(document.execCommand).toHaveBeenCalledWith('bold', false, null)
  })

  it('italic button calls execCommand', () => {
    render(<ArticleEditor value='[{"id":"a","type":"text","content":"hello"}]' onChange={() => {}} />)
    const italicBtn = screen.getByRole('button', { name: 'I' })
    fireEvent.click(italicBtn)
    expect(document.execCommand).toHaveBeenCalledWith('italic', false, null)
  })

  it('highlight button calls execCommand with hiliteColor', () => {
    render(<ArticleEditor value='[{"id":"a","type":"text","content":"hello"}]' onChange={() => {}} />)
    const yellowBtn = screen.getByLabelText('Highlight in yellow')
    fireEvent.click(yellowBtn)
    expect(document.execCommand).toHaveBeenCalledWith('hiliteColor', false, '#fde68a')
  })

  it('seeds editor HTML from stored markers on mount', () => {
    render(<ArticleEditor value='[{"id":"a","type":"text","content":"**bold** and *italic*"}]' onChange={() => {}} />)
    const editor = screen.getByTestId('article-editor')
    expect(editor.innerHTML).toContain('<strong>bold</strong>')
    expect(editor.innerHTML).toContain('<em>italic</em>')
  })

  it('emits markers on blur after editing', () => {
    let emitted = null
    render(<ArticleEditor value='[{"id":"a","type":"text","content":"hello"}]' onChange={(v) => { emitted = v }} />)
    const editor = screen.getByTestId('article-editor')
    // Simulate user typing by changing innerHTML directly
    editor.innerHTML = '<p><strong>hello world</strong></p>'
    fireEvent.blur(editor)
    const blocks = JSON.parse(emitted)
    expect(blocks[0].content).toBe('**hello world**')
  })

  it('never renders a preview in read-only mode (the article body is already rendered)', () => {
    render(<ArticleEditor value='[{"id":"a","type":"text","content":"**published**"}]' readOnly />)
    expect(screen.queryByTestId('article-preview')).not.toBeInTheDocument()
    expect(screen.queryByTestId('article-editor')).not.toBeInTheDocument()
  })
})
