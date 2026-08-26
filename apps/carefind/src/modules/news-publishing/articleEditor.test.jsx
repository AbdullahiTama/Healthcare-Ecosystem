import { describe, it, expect } from 'vitest'
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
    expect(emitted).not.toBeNull()
    expect(emitted).not.toContain('==color|')
    const blocks = JSON.parse(emitted)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].content).toContain('Why does a wound itch?')
    expect(blocks[0].content).toContain('Because new skin forms.')
  })

  it('applies a colour as a valid highlight, not literal characters', () => {
    let emitted = null
    render(<ArticleEditor value='[{"id":"a","type":"text","content":"hello world"}]' onChange={(v) => { emitted = v }} />)
    const textarea = screen.getByPlaceholderText('Write here...')
    fireEvent.click(textarea)
    textarea.setSelectionRange(0, 5)
    fireEvent.click(screen.getByLabelText('Highlight in yellow'))
    const blocks = JSON.parse(emitted)
    expect(blocks[0].content).toBe('==#fde68a|hello== world')
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

// Issue #8 — WYSIWYG. While writing, the author used to see only the raw
// markers (** and ==#hex|) with no idea how the article would publish. The
// editor now renders a live preview through the SAME renderer the published
// article uses, so the pane shows real bold/italic/colour as they type.
describe('ArticleEditor live WYSIWYG preview (issue #8)', () => {
  it('shows rendered formatting — not markers — while editing', () => {
    render(<ArticleEditor value='[{"id":"a","type":"text","content":"**Bold** and *italic* prose"}]' onChange={() => {}} />)
    const preview = screen.getByTestId('article-preview')
    expect(preview.querySelector('strong')).not.toBeNull()
    expect(preview.querySelector('strong').textContent).toBe('Bold')
    expect(preview.querySelector('em')).not.toBeNull()
    expect(preview.textContent).not.toContain('**')
  })

  it('renders a colour highlight as an actual mark in the preview', () => {
    render(
      <ArticleEditor
        value='[{"id":"a","type":"text","content":"before ==#fde68a|highlighted== after"}]'
        onChange={() => {}}
      />
    )
    const preview = screen.getByTestId('article-preview')
    const mark = preview.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark.textContent).toBe('highlighted')
    expect(preview.textContent).not.toContain('==')
  })

  it('updates on every keystroke', () => {
    render(<ArticleEditor value='[{"id":"a","type":"text","content":""}]' onChange={() => {}} />)
    // No content → no preview pane at all.
    expect(screen.queryByTestId('article-preview')).not.toBeInTheDocument()
    const textarea = screen.getByPlaceholderText('Write here...')
    fireEvent.change(textarea, { target: { value: 'now **bold**' } })
    const preview = screen.getByTestId('article-preview')
    expect(preview.querySelector('strong')).not.toBeNull()
    expect(preview.textContent).toContain('now bold')
  })

  it('never renders a preview in read-only mode (the article body is already rendered)', () => {
    render(<ArticleEditor value='[{"id":"a","type":"text","content":"**published**"}]' readOnly />)
    expect(screen.queryByTestId('article-preview')).not.toBeInTheDocument()
  })
})
