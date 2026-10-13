import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

const hook = vi.hoisted(() => ({ value: null, search: vi.fn(), exportCSV: vi.fn() }))
vi.mock('../hooks/useDrugReviews', () => ({ useDrugReviews: () => ({ ...hook.value, search: hook.search }) }))
vi.mock('../ui', async (orig) => ({ ...(await orig()), exportCSV: (...a) => hook.exportCSV(...a) }))

import DrugIntelSection from './DrugIntelSection.jsx'

const MARKUP = '<img src=x onerror=alert(1)>'
const ago = (d) => new Date(Date.now() - d * 86400_000).toISOString()
const review = (id, rating, extra = {}) => ({
  id, rating, comment: `Comment ${id}`, created_at: ago(1), product_id: 'p1', user_id: { secret: true }, ...extra,
})
const reviews = [review('r1', 5), review('r2', 4), review('r3', 3), review('r4', 1), review('r5', 2)]
const ok = (extra = {}) => ({ status: 'ok', term: 'para', product: { id: 'p1', name: 'Paracetamol' }, matches: 1, reviews, ...extra })
const setHook = (v) => { hook.value = { result: null, searching: false, ...v } }
const box = () => screen.getByRole('textbox', { name: 'Medication name' })

beforeEach(() => {
  hook.search.mockReset()
  hook.exportCSV.mockReset()
  setHook({})
})

describe('DrugIntelSection', () => {
  it('shows the legacy prompt before any search', () => {
    render(<DrugIntelSection />)
    expect(screen.getByRole('heading', { level: 1, name: 'Drug Intelligence' })).toBeInTheDocument()
    expect(screen.getByText('Search for a medication to view user reviews and sentiment analysis')).toBeInTheDocument()
  })

  it('searches on the button and on form submit (Enter), once each', () => {
    render(<DrugIntelSection />)
    fireEvent.change(box(), { target: { value: '  para ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(hook.search).toHaveBeenCalledTimes(1)
    expect(hook.search).toHaveBeenCalledWith('para')
    fireEvent.submit(box().closest('form'))
    expect(hook.search).toHaveBeenCalledTimes(2)
  })

  it('does not search from typing or key presses alone', () => {
    render(<DrugIntelSection />)
    fireEvent.change(box(), { target: { value: 'para' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(hook.search).not.toHaveBeenCalled()
  })

  it('disables Search when the box is blank and ignores a blank submit', () => {
    render(<DrugIntelSection />)
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
    fireEvent.change(box(), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
    fireEvent.submit(box().closest('form'))
    expect(hook.search).not.toHaveBeenCalled()
  })

  it('disables Search while searching and does not submit then', () => {
    setHook({ searching: true })
    render(<DrugIntelSection />)
    fireEvent.change(box(), { target: { value: 'para' } })
    expect(screen.getByRole('button', { name: 'Searching…' })).toBeDisabled()
    fireEvent.submit(box().closest('form'))
    expect(hook.search).not.toHaveBeenCalled()
  })

  it('says Searching, not the empty prompt, during the first search', () => {
    setHook({ searching: true })
    render(<DrugIntelSection />)
    expect(screen.getByRole('status')).toHaveTextContent('Searching…')
    expect(screen.queryByText(/Search for a medication to view/)).not.toBeInTheDocument()
  })

  it('keeps the previous result during a new search and says it is searching', () => {
    setHook({ result: ok(), searching: true })
    render(<DrugIntelSection />)
    expect(screen.getByRole('status')).toHaveTextContent('Searching…')
    expect(screen.getByRole('heading', { name: 'Reviews for Paracetamol' })).toBeInTheDocument()
    expect(screen.queryByText(/Search for a medication to view/)).not.toBeInTheDocument()
  })

  it('says it could not search, and Retry repeats the failed term', () => {
    setHook({ result: { status: 'error', term: 'ibu' } })
    render(<DrugIntelSection />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't search")
    fireEvent.change(box(), { target: { value: 'something else' } })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(hook.search).toHaveBeenCalledWith('ibu')
    expect(screen.queryByText(/No medication matches/)).not.toBeInTheDocument()
  })

  it('says no medication matches the term', () => {
    setHook({ result: { status: 'ok', term: 'zzz', product: null, matches: 0, reviews: [] } })
    render(<DrugIntelSection />)
    expect(screen.getByText('No medication matches')).toBeInTheDocument()
    expect(screen.getByText(/zzz/)).toBeInTheDocument()
  })

  it('says a matched product has no reviews yet', () => {
    setHook({ result: ok({ reviews: [] }) })
    render(<DrugIntelSection />)
    expect(screen.getByRole('heading', { name: 'Reviews for Paracetamol' })).toBeInTheDocument()
    expect(screen.getByText('No reviews yet')).toBeInTheDocument()
    expect(screen.queryByText(/No reviews match/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  })

  it('names the product, average and counts for a single match', () => {
    setHook({ result: ok() })
    render(<DrugIntelSection />)
    expect(screen.getByRole('heading', { name: 'Reviews for Paracetamol' })).toBeInTheDocument()
    expect(screen.queryByText(/combined/)).not.toBeInTheDocument()
    expect(screen.getByText(/5 reviews/)).toBeInTheDocument()
    expect(screen.getByText(/Avg:/)).toHaveTextContent('3.0')
  })

  it('says reviews are combined, and names the term, when several products match', () => {
    setHook({ result: ok({ matches: 3 }) })
    render(<DrugIntelSection />)
    expect(screen.getByRole('heading', { name: 'Reviews for 3 products matching “para”' })).toBeInTheDocument()
    expect(screen.getByText('Reviews from all 3 matching products are combined.')).toBeInTheDocument()
    expect(screen.queryByText(/first of/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Paracetamol/ })).not.toBeInTheDocument()
  })

  it('names the CSV after the term when several products match', () => {
    setHook({ result: ok({ matches: 2 }) })
    render(<DrugIntelSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(hook.exportCSV.mock.calls[0][1]).toBe('para_filtered_reviews.csv')
  })

  it('resets filters for a new term but keeps them when the same term is searched again', () => {
    setHook({ result: ok() })
    render(<DrugIntelSection />)
    fireEvent.click(screen.getByRole('button', { name: '5 Stars' }))
    expect(screen.queryByText('Comment r2')).not.toBeInTheDocument()
    fireEvent.change(box(), { target: { value: 'para' } })
    fireEvent.submit(box().closest('form'))
    expect(screen.queryByText('Comment r2')).not.toBeInTheDocument()
    fireEvent.change(box(), { target: { value: 'ibuprofen' } })
    fireEvent.submit(box().closest('form'))
    expect(screen.getByText('Comment r2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('counts sentiment: positive 4-5, neutral the rest, negative 1-2', () => {
    setHook({ result: ok() })
    render(<DrugIntelSection />)
    const strip = screen.getByLabelText('Review sentiment')
    const cell = (label) => within(strip).getByText(label).closest('div')
    expect(cell('Positive')).toHaveTextContent('2')
    expect(cell('Neutral')).toHaveTextContent('1')
    expect(cell('Negative')).toHaveTextContent('2')
  })

  it('filters by rating and recomputes counts and average from the filtered reviews', () => {
    setHook({ result: ok() })
    render(<DrugIntelSection />)
    fireEvent.click(screen.getByRole('button', { name: '5 Stars' }))
    expect(screen.getByText('Comment r1')).toBeInTheDocument()
    expect(screen.queryByText('Comment r2')).not.toBeInTheDocument()
    expect(screen.getByText(/1 reviews/)).toBeInTheDocument()
    expect(screen.getByText(/Avg:/)).toHaveTextContent('5.0')
    const strip = screen.getByLabelText('Review sentiment')
    expect(within(strip).getByText('Positive').closest('div')).toHaveTextContent('1')
    expect(within(strip).getByText('Negative').closest('div')).toHaveTextContent('0')
  })

  it('filters by date range, inclusive of the whole end day', () => {
    const day = '2026-03-10'
    setHook({ result: ok({ reviews: [
      review('d1', 5, { created_at: '2026-03-09T10:00:00' }),
      review('d2', 5, { created_at: '2026-03-10T23:00:00' }),
      review('d3', 5, { created_at: '2026-03-11T00:00:01' }),
    ] }) })
    render(<DrugIntelSection />)
    fireEvent.change(screen.getByLabelText('From'), { target: { value: day } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: day } })
    expect(screen.queryByText('Comment d1')).not.toBeInTheDocument()
    expect(screen.getByText('Comment d2')).toBeInTheDocument()
    expect(screen.queryByText('Comment d3')).not.toBeInTheDocument()
  })

  it('says no reviews match the filters, never "No reviews yet", and Clear filters restores them', () => {
    setHook({ result: ok({ reviews: [review('r1', 5)] }) })
    render(<DrugIntelSection />)
    fireEvent.click(screen.getByRole('button', { name: '1 Star' }))
    expect(screen.getByText('No reviews match these filters')).toBeInTheDocument()
    expect(screen.queryByText('No reviews yet')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('Comment r1')).toBeInTheDocument()
    expect(screen.queryByText('No reviews match these filters')).not.toBeInTheDocument()
  })

  it('exports the filtered reviews as flat records under the product name', () => {
    setHook({ result: ok() })
    render(<DrugIntelSection />)
    fireEvent.click(screen.getByRole('button', { name: '5 Stars' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(hook.exportCSV).toHaveBeenCalledTimes(1)
    const [rows, filename] = hook.exportCSV.mock.calls[0]
    expect(filename).toBe('Paracetamol_filtered_reviews.csv')
    expect(rows).toEqual([{ id: 'r1', rating: 5, comment: 'Comment r1', created_at: reviews[0].created_at }])
  })

  it('renders review comments and product names as inert text', () => {
    setHook({ result: ok({ product: { id: 'p1', name: MARKUP }, reviews: [review('m1', 5, { comment: MARKUP })] }) })
    const { container } = render(<DrugIntelSection />)
    expect(screen.getAllByText(MARKUP).length).toBeGreaterThan(0)
    expect(container.querySelector('img')).toBeNull()
  })

  it('keeps the five-star row on each review, labelled by rating', () => {
    setHook({ result: ok({ reviews: [review('r1', 3)] }) })
    const { container } = render(<DrugIntelSection />)
    expect(screen.getByRole('img', { name: '3 out of 5 stars' })).toBeInTheDocument()
    expect(container.querySelectorAll('.adm-star')).toHaveLength(5)
    expect(container.querySelectorAll('.adm-star--on')).toHaveLength(3)
  })

  it.each([['null', null], ['undefined', undefined], ['a non-numeric string', 'abc']])(
    'does not count a review whose rating is %s as Negative or let it spoil the average', (_, bad) => {
      setHook({ result: ok({ reviews: [review('r1', 5), review('r2', 3), review('bad', bad)] }) })
      const { container } = render(<DrugIntelSection />)
      const strip = screen.getByLabelText('Review sentiment')
      const cell = (label) => within(strip).getByText(label).closest('div')
      expect(cell('Positive')).toHaveTextContent('1')
      expect(cell('Neutral')).toHaveTextContent('1')
      expect(cell('Negative')).toHaveTextContent('0')
      expect(screen.getByText(/Avg:/)).toHaveTextContent('4.0')
      expect(screen.getByText(/Avg:/)).not.toHaveTextContent('NaN')
      // The unrated review is still listed, with an empty star row.
      expect(screen.getByText('Comment bad')).toBeInTheDocument()
      expect(container.querySelectorAll('.adm-star--on')).toHaveLength(5 + 3)
    })
})
