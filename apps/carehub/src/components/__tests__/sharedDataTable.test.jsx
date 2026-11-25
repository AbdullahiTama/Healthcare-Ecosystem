import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DataTable } from '@care-ecosystem/design-system/components/ui'

const COLUMNS = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'qty', label: 'Qty', sortable: true, align: 'right' },
]

const ROWS = [
  { id: 1, name: 'Bandages', qty: 3 },
  { id: 2, name: 'Saline', qty: 12 },
  { id: 3, name: 'Tape', qty: 8 },
]

describe('design-system DataTable', () => {
  let host
  let root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
  })

  it('renders a table with sortable aria-sort headers and injects the row-hover rule once', async () => {
    await act(async () => { root.render(<DataTable rows={ROWS} columns={COLUMNS} />) })
    const rows = host.querySelectorAll('tbody tr')
    expect(rows.length).toBe(3)
    expect(rows[0].textContent).toContain('Bandages')
    const nameHeader = [...host.querySelectorAll('th')].find((t) => t.textContent.includes('Name'))
    expect(nameHeader.getAttribute('aria-sort')).toBe('none')
    const tags = Array.from(document.querySelectorAll('style#ds-data-row-styles'))
    expect(tags.length).toBe(1)
    expect(tags[0].textContent).toContain('.ds-data-row:hover td')
  })

  it('sorts ascending then descending when a sortable header is clicked', async () => {
    await act(async () => { root.render(<DataTable rows={ROWS} columns={COLUMNS} />) })
    const nameHeader = [...host.querySelectorAll('th')].find((t) => t.textContent.includes('Name'))
    await act(async () => { nameHeader.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    let cells = [...host.querySelectorAll('tbody tr')].map((r) => r.textContent.trim())
    expect(cells[0]).toContain('Bandages')
    expect(nameHeader.getAttribute('aria-sort')).toBe('ascending')
    await act(async () => { nameHeader.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    cells = [...host.querySelectorAll('tbody tr')].map((r) => r.textContent.trim())
    expect(cells[0]).toContain('Tape')
    expect(nameHeader.getAttribute('aria-sort')).toBe('descending')
  })

  it('paginates with controlled page props and a "first to last of total" footer', async () => {
    let page = 0
    const setPage = (p) => { page = p }
    await act(async () => { root.render(<DataTable rows={ROWS} columns={COLUMNS} page={page} setPage={setPage} pageSize={2} />) })
    expect(host.querySelectorAll('tbody tr').length).toBe(2)
    expect(host.textContent).toContain('1 to 2 of 3')
    const next = host.querySelector('button[aria-label="Next page"]')
    await act(async () => { next.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(page).toBe(1)
  })

  describe('at phone width', () => {
    let width
    beforeEach(() => { width = window.innerWidth; window.innerWidth = 375 })
    afterEach(() => { window.innerWidth = width })

    it('shows Previous / Next under the card list (it had none, so only the first page was reachable)', async () => {
      let page = 0
      const setPage = (p) => { page = p }
      await act(async () => { root.render(<DataTable rows={ROWS} columns={COLUMNS} page={page} setPage={setPage} pageSize={2} />) })
      expect(host.querySelectorAll('table').length).toBe(0)
      expect(host.textContent).toContain('1 to 2 of 3')
      expect(host.textContent).toContain('Bandages')
      expect(host.textContent).not.toContain('Tape')
      const next = host.querySelector('button[aria-label="Next page"]')
      const prev = host.querySelector('button[aria-label="Previous page"]')
      expect(prev.disabled).toBe(true)
      await act(async () => { next.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(page).toBe(1)
      await act(async () => { root.render(<DataTable rows={ROWS} columns={COLUMNS} page={page} setPage={setPage} pageSize={2} />) })
      expect(host.textContent).toContain('3 to 3 of 3')
      expect(host.textContent).toContain('Tape')
      expect(host.querySelector('button[aria-label="Next page"]').disabled).toBe(true)
      await act(async () => { host.querySelector('button[aria-label="Previous page"]').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(page).toBe(0)
    })

    it('gives the page buttons a finger-sized target', async () => {
      await act(async () => { root.render(<DataTable rows={ROWS} columns={COLUMNS} page={0} setPage={() => {}} pageSize={2} />) })
      expect(host.querySelector('button[aria-label="Next page"]').style.minHeight).toBe('40px')
    })
  })

  it('keeps a page that still has rows after a delete, and shows the last page when it no longer exists', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, name: 'Item ' + (i + 1), qty: i }))
    let page = 2
    const setPage = (p) => { page = p }
    await act(async () => { root.render(<DataTable rows={many} columns={COLUMNS} page={page} setPage={setPage} pageSize={3} />) })
    expect(host.textContent).toContain('7 to 7 of 7')
    // The only row on page 3 is deleted: page 3 no longer exists, page 2 is shown and Previous goes to page 1.
    await act(async () => { root.render(<DataTable rows={many.slice(0, 6)} columns={COLUMNS} page={page} setPage={setPage} pageSize={3} />) })
    expect(host.textContent).toContain('4 to 6 of 6')
    await act(async () => { host.querySelector('button[aria-label="Previous page"]').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(page).toBe(0)
  })

  it('renders skeleton rows while loading and the empty state when there are no rows', async () => {
    await act(async () => { root.render(<DataTable rows={ROWS} columns={COLUMNS} loading />) })
    expect(host.querySelectorAll('table').length).toBe(0)
    expect(host.querySelectorAll('div[style*="ds-pulse"]').length).toBeGreaterThan(0)
    await act(async () => { root.render(<DataTable rows={[]} columns={COLUMNS} />) })
    expect(host.textContent).toContain('Nothing here yet')
  })

  it('renders an error state with retry', async () => {
    const onRetry = () => { retried = true }
    let retried = false
    await act(async () => { root.render(<DataTable rows={ROWS} columns={COLUMNS} error="Load failed" onRetry={onRetry} />) })
    expect(host.textContent).toContain('Load failed')
    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent.toLowerCase().includes('retry'))
    await act(async () => { retry.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(retried).toBe(true)
  })

  it('renders the cards variant with per-row actions and a sort chip bar', async () => {
    await act(async () => {
      root.render(<DataTable rows={ROWS} columns={COLUMNS} variant="cards" actions={(row) => <button>Edit</button>} />)
    })
    expect(host.textContent).toContain('Bandages')
    expect(host.querySelectorAll('button').length).toBe(5)
    expect([...host.querySelectorAll('button')].filter((b) => b.textContent === 'Edit').length).toBe(3)
  })
})