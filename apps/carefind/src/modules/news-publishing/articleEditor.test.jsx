import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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