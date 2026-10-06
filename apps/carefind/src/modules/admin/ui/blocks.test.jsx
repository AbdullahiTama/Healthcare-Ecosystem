import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DataTable } from '@care-ecosystem/design-system/components/ui'
import { StatusPill } from './StatusPill.jsx'
import { primaryCell, selectionColumn } from './tableHelpers.jsx'
import { DetailDrawer, DetailField } from './DetailDrawer.jsx'
import AdminPageHeader from './AdminPageHeader.jsx'

describe('StatusPill', () => {
  it.each([
    ['approved', 'Approved'], ['rejected', 'Rejected'], ['resolved', 'Resolved'],
    ['flagged', 'Flagged'], ['pending', 'Pending'], ['reserved', 'Reserved'],
  ])('labels %s as %s', (status, label) => {
    render(<StatusPill status={status} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('falls back to the raw status, or a dash when there is none', () => {
    const { rerender } = render(<StatusPill status="weird_state" />)
    expect(screen.getByText('weird_state')).toBeInTheDocument()
    rerender(<StatusPill status={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('table helpers', () => {
  const rows = [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bayo' }]

  function Table({ onOpen }) {
    const [selected, setSelected] = useState(new Set())
    const toggle = (id) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
    const toggleAll = () => setSelected(prev => (prev.size === rows.length ? new Set() : new Set(rows.map(r => r.id))))
    const columns = [
      selectionColumn({ rows, selectedIds: selected, onToggle: toggle, onToggleAll: toggleAll, rowLabel: r => r.name }),
      { key: 'name', label: 'Name', render: r => primaryCell({ title: r.name, sub: `id ${r.id}`, onOpen: () => onOpen(r), openLabel: `Open ${r.name}` }) },
    ]
    return <><span>selected:{selected.size}</span><DataTable rows={rows} columns={columns} /></>
  }

  it('opens a record from a real button, reachable by keyboard', () => {
    const onOpen = vi.fn()
    render(<Table onOpen={onOpen} />)
    const open = screen.getByRole('button', { name: 'Open Ada' })
    expect(open.tagName).toBe('BUTTON')
    fireEvent.click(open)
    expect(onOpen).toHaveBeenCalledWith(rows[0])
    expect(screen.getByText('id a')).toBeInTheDocument()
  })

  it('selects one row, all rows, and none', () => {
    render(<Table onOpen={() => {}} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ada' }))
    expect(screen.getByText('selected:1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(screen.getByText('selected:2')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Bayo' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(screen.getByText('selected:0')).toBeInTheDocument()
  })

  it('selecting a row does not open it', () => {
    const onRowClick = vi.fn()
    const columns = [selectionColumn({ rows, selectedIds: new Set(), onToggle: () => {}, onToggleAll: () => {}, rowLabel: r => r.name })]
    render(<DataTable rows={rows} columns={columns} onRowClick={onRowClick} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ada' }))
    expect(onRowClick).not.toHaveBeenCalled()
  })
})

describe('DetailDrawer', () => {
  function Host() {
    const [open, setOpen] = useState(false)
    return (
      <div>
        <button onClick={() => setOpen(true)}>opener</button>
        <DetailDrawer open={open} onClose={() => setOpen(false)} title="Dr. Amina Bello" footer={<button>Approve</button>}>
          <DetailField label="Profession">Pharmacist</DetailField>
          <DetailField label="Workplace">{null}</DetailField>
        </DetailDrawer>
      </div>
    )
  }

  it('is closed until opened, then shows the title, fields and footer', () => {
    render(<Host />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('opener'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Dr. Amina Bello')).toBeInTheDocument()
    expect(within(dialog).getByText('Profession')).toBeInTheDocument()
    expect(within(dialog).getByText('Pharmacist')).toBeInTheDocument()
    expect(within(dialog).getByText('—')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the control that opened it', () => {
    render(<Host />)
    const opener = screen.getByText('opener')
    opener.focus()
    fireEvent.click(opener)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(opener)
  })

  it('closes from its close button', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('opener'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('AdminPageHeader', () => {
  it('renders the title as the page heading', () => {
    render(<AdminPageHeader title="Verifications" subtitle="12 pending" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Verifications' })).toBeInTheDocument()
    expect(screen.getByText('12 pending')).toBeInTheDocument()
  })
})
